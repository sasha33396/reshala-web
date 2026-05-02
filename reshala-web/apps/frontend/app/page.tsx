'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { fetchFleet, fetchFleetStatus, logout, addServerByPassword, provisionAll, fetchProvisionProgress, fetchPanelNodes, fetchPanelHosts, deleteServer, bulkSsh } from '@/lib/api'
import type { PanelNode, PanelHost } from '@reshala-web/shared'
import { useT, LangToggle } from '@/lib/i18n'
import { FleetGrid } from '@/components/fleet-grid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Activity,
  Bell,
  Boxes,
  Layers,
  LogOut,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Upload,
  UserPlus,
} from 'lucide-react'

type ProvisionProgress = {
  running: boolean
  total: number
  done: number
  ok: number
  failed: number
  errors: string[]
}

type SpeedtestState = {
  running?: boolean
  ok?: boolean
  message?: string
}

const SPEEDTEST_COMMAND = `
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v snap >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y snapd
  else
    echo "snap is not installed and apt-get is unavailable"
    exit 1
  fi
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now snapd.socket >/dev/null 2>&1 || true
  systemctl start snapd.service >/dev/null 2>&1 || true
fi
export PATH="$PATH:/snap/bin"
if ! command -v speedtest >/dev/null 2>&1 && [ -x /snap/bin/speedtest ]; then
  ln -sf /snap/bin/speedtest /usr/local/bin/speedtest 2>/dev/null || true
fi
if ! command -v speedtest >/dev/null 2>&1; then
  snap install speedtest
fi
export PATH="$PATH:/snap/bin"
SPEEDTEST_BIN="$(command -v speedtest || true)"
if [ -z "$SPEEDTEST_BIN" ] && [ -x /snap/bin/speedtest ]; then
  SPEEDTEST_BIN=/snap/bin/speedtest
fi
if [ -z "$SPEEDTEST_BIN" ]; then
  echo "speedtest command was not found after snap install"
  exit 1
fi
"$SPEEDTEST_BIN" --accept-license --accept-gdpr -f json
`.trim()

export default function HomePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', ip: '', password: '', user: 'root', port: '22' })
  const [adding, setAdding] = useState(false)
  const [addResult, setAddResult] = useState<string | null>(null)
  const [provisioning, setProvisioning] = useState(false)
  const [progress, setProgress] = useState<ProvisionProgress | null>(null)
  const [provisionResult, setProvisionResult] = useState<ProvisionProgress | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [groupBy, setGroupBy] = useState<'country' | 'provider'>('country')
  const [showUntracked, setShowUntracked] = useState(false)
  const [deletingServer, setDeletingServer] = useState<string | null>(null)
  const [provisionMinimized, setProvisionMinimized] = useState(false)
  const [speedtests, setSpeedtests] = useState<Record<string, SpeedtestState>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startPolling() {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      try {
        const p = await fetchProvisionProgress()
        setProgress(p)
        if (!p.running && p.total > 0) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setProvisioning(false)
          setProvisionResult(p)
          setProgress(null)
          setProvisionMinimized(false)
        }
      } catch {}
    }, 600)
  }

  // Resume bar if backend is still running after page refresh
  useEffect(() => {
    fetchProvisionProgress().then((p) => {
      if (p.running) {
        setProvisioning(true)
        setProgress(p)
        startPolling()
      }
    }).catch(() => {})
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    setAddResult(null)
    try {
      const res = await addServerByPassword({
        name: addForm.name,
        ip: addForm.ip,
        password: addForm.password,
        user: addForm.user || 'root',
        port: parseInt(addForm.port) || 22,
      })
      if (res.ok) {
        setAddResult(t('add.success'))
        setAddForm({ name: '', ip: '', password: '', user: 'root', port: '22' })
        queryClient.invalidateQueries({ queryKey: ['fleet'] })
        setTimeout(() => { setShowAdd(false); setAddResult(null) }, 1500)
      } else {
        setAddResult(res.error ?? t('common.error'))
      }
    } catch (e: any) {
      setAddResult(e?.message ?? t('common.error'))
    } finally {
      setAdding(false)
    }
  }

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['fleet', groupBy],
    queryFn: () => fetchFleet(groupBy),
    refetchInterval: 30_000,
  })

  const { data: statusMap = {} } = useQuery({
    queryKey: ['fleet-status'],
    queryFn: fetchFleetStatus,
    refetchInterval: 30_000,
  })

  const { data: panelNodes = [] } = useQuery({
    queryKey: ['panel-nodes'],
    queryFn: fetchPanelNodes,
    refetchInterval: 60_000,
    retry: false,
  })
  const fleetIpSet = new Set(groups.flatMap((g) => g.servers.map((s) => s.ip)))
  const untracked = (panelNodes as PanelNode[]).filter((n) => !fleetIpSet.has(n.address))

  const panelMap = panelNodes.length > 0
    ? Object.fromEntries(panelNodes.map((n: PanelNode) => [n.address, n]))
    : undefined

  const { data: panelHosts = [] } = useQuery({
    queryKey: ['panel-hosts'],
    queryFn: fetchPanelHosts,
    refetchInterval: 120_000,
    retry: false,
    staleTime: 60_000,
  })
  const hostByIp: Record<string, PanelHost> = (() => {
    if (!panelHosts.length || !panelNodes.length) return {}
    const nodeUuidToHost: Record<string, PanelHost> = {}
    for (const host of panelHosts) {
      for (const nodeUuid of host.nodes) nodeUuidToHost[nodeUuid] = host
    }
    const map: Record<string, PanelHost> = {}
    for (const node of panelNodes as PanelNode[]) {
      const host = nodeUuidToHost[node.uuid]
      if (host) map[node.address] = host
    }
    return map
  })()

  const filtered = search.trim()
    ? groups
        .map((g) => ({
          ...g,
          servers: g.servers.filter(
            (s) =>
              s.name.toLowerCase().includes(search.toLowerCase()) ||
              s.ip.includes(search),
          ),
        }))
        .filter((g) => g.servers.length > 0)
    : groups

  const totalOnline = Object.values(statusMap).filter(Boolean).length
  const totalServers = groups.reduce((n, g) => n + g.servers.length, 0)
  const totalOffline = Math.max(0, totalServers - totalOnline)
  const filteredServers = filtered.reduce((n, g) => n + g.servers.length, 0)
  const panelConnected = (panelNodes as PanelNode[]).filter((n) => n.isConnected).length
  const panelUsers = (panelNodes as PanelNode[]).reduce((sum, n) => sum + (n.usersOnline ?? 0), 0)

  async function handleProvisionAll() {
    setProvisioning(true)
    setProvisionMinimized(false)
    setProvisionResult(null)
    setProgress(null)
    startPolling()
    try {
      const res = await provisionAll()
      // result comes from POST response; polling may have already set provisionResult
      setProvisionResult({ ...res, running: false, done: res.total, errors: res.errors })
    } finally {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      setProvisioning(false)
      setProvisionMinimized(false)
      setProgress(null)
    }
  }

  async function handleDeleteServer(name: string) {
    const ok = window.confirm(`Remove "${name}" from Reshala fleet?`)
    if (!ok) return
    setDeletingServer(name)
    try {
      await deleteServer(name)
      queryClient.invalidateQueries({ queryKey: ['fleet'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-status'] })
    } catch (e: any) {
      window.alert(e?.message ?? 'Failed to delete server')
    } finally {
      setDeletingServer(null)
    }
  }

  async function handleSpeedtest(name: string) {
    setSpeedtests((prev) => ({ ...prev, [name]: { running: true, message: 'Preparing snap speedtest...' } }))
    try {
      const [res] = await bulkSsh([name], SPEEDTEST_COMMAND)
      const message = res?.ok ? summarizeSpeedtest(res.output) : (res?.output || 'Speedtest failed')
      setSpeedtests((prev) => ({ ...prev, [name]: { running: false, ok: Boolean(res?.ok), message } }))
    } catch (e: any) {
      setSpeedtests((prev) => ({
        ...prev,
        [name]: { running: false, ok: false, message: e?.message ?? 'Speedtest failed' },
      }))
    }
  }

  function quickAdd(node: PanelNode) {
    setAddForm({ name: node.name, ip: node.address, password: '', user: 'root', port: '22' })
    setAddResult(null)
    setShowAdd(true)
  }

  async function handleLogout() {
    await logout()
    router.push('/login')
    router.refresh()
  }

  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-5">{t('fleet.title')}</h1>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {filteredServers} shown from {totalServers} servers
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t('fleet.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            <button
              className={`px-3 py-1.5 transition-colors ${groupBy === 'country' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setGroupBy('country')}
            >
              By country
            </button>
            <button
              className={`px-3 py-1.5 transition-colors border-l border-border ${groupBy === 'provider' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setGroupBy('provider')}
            >
              By host
            </button>
          </div>
          <Button variant="default" size="sm" onClick={() => { setShowAdd(true); setAddResult(null) }} className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('fleet.addServer').replace('+ ', '')}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/analytics')} className="gap-2">
            <Activity className="h-4 w-4" />
            <span>{t('nav.analytics')}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/alerts')} className="gap-2">
            <Bell className="h-4 w-4" />
            <span>{t('nav.alerts')}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/bulk')} className="gap-2">
            <Boxes className="h-4 w-4" />
            <span>{t('nav.bulkOps')}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/import')} className="gap-2">
            <Upload className="h-4 w-4" />
            <span>{t('nav.import')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleProvisionAll}
            disabled={provisioning}
            title="Deploy SSH keys to all servers using stored passwords"
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" />
            <span>{provisioning ? 'Provisioning...' : 'Provision All'}</span>
          </Button>
          <LangToggle />
          <Button variant="ghost" size="icon" onClick={handleLogout} title={t('nav.logout')}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-4 py-5 lg:px-6">
        <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatPill label="Online" value={totalOnline} tone="good" />
          <StatPill label="Offline" value={totalOffline} tone={totalOffline > 0 ? 'bad' : 'muted'} />
          <StatPill label="Panel nodes" value={panelConnected} tone="muted" />
          <StatPill label="Users" value={panelUsers} tone="muted" />
        </div>
        {isLoading ? (
          <FleetSkeleton />
        ) : (
          <FleetGrid
            groups={filtered}
            statusMap={statusMap}
            panelMap={panelMap}
            hostByIp={hostByIp}
            deletingServer={deletingServer}
            onDeleteServer={handleDeleteServer}
            speedtests={speedtests}
            onSpeedtest={handleSpeedtest}
          />
        )}

        {untracked.length > 0 && (
          <div className="mt-8">
            <button
              className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground mb-3"
              onClick={() => setShowUntracked((v) => !v)}
            >
              <span>{showUntracked ? '▾' : '▸'}</span>
              <span>Not in fleet</span>
              <span className="ml-1 text-xs font-normal bg-destructive/20 text-destructive px-1.5 py-0.5 rounded-full">
                {untracked.length}
              </span>
            </button>
            {showUntracked && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {untracked.map((node) => (
                  <UntrackedCard key={node.uuid} node={node} onAdd={() => quickAdd(node)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Provision progress overlay */}
      {provisioning && !provisionMinimized && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-8 w-full max-w-md mx-4 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <span className="text-2xl">🔑</span>
              <div>
                <h2 className="font-bold text-lg">Provision All</h2>
                <p className="text-xs text-muted-foreground">Deploying SSH keys to all servers…</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setProvisionMinimized(true)} title="Run in background">
                <Minimize2 className="h-4 w-4" />
              </Button>
            </div>

            {progress && progress.total > 0 ? (
              <>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                    <span>{progress.done} / {progress.total} servers</span>
                    <span className="font-mono font-bold">{pct}%</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-400 font-mono">✓ {progress.ok} ok</span>
                  <span className="text-red-400 font-mono">✗ {progress.failed} failed</span>
                </div>
                {progress.errors.length > 0 && (
                  <div className="max-h-32 overflow-y-auto rounded-lg bg-muted/50 p-3 space-y-1">
                    {progress.errors.slice(-10).map((e, i) => (
                      <p key={i} className="text-xs text-red-400 font-mono break-all">{e}</p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary/40 rounded-full animate-pulse w-full" />
              </div>
            )}
          </div>
        </div>
      )}

      {provisioning && provisionMinimized && (
        <div className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Provision All</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {progress && progress.total > 0
                  ? `${progress.done}/${progress.total} servers, ${progress.ok} ok, ${progress.failed} failed`
                  : 'Starting...'}
              </p>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setProvisionMinimized(false)} title="Show progress">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Provision done modal */}
      {provisionResult && !provisioning && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setProvisionResult(null); setShowErrors(false) }}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg">🔑 Provision All — Done</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-2xl font-bold">{provisionResult.total}</p>
                <p className="text-xs text-muted-foreground mt-1">Total</p>
              </div>
              <div className="rounded-lg bg-green-950/50 border border-green-800/40 p-3">
                <p className="text-2xl font-bold text-green-400">{provisionResult.ok}</p>
                <p className="text-xs text-muted-foreground mt-1">OK</p>
              </div>
              <div className="rounded-lg bg-red-950/50 border border-red-800/40 p-3">
                <p className="text-2xl font-bold text-red-400">{provisionResult.failed}</p>
                <p className="text-xs text-muted-foreground mt-1">Failed</p>
              </div>
            </div>

            {provisionResult.errors.length > 0 && (
              <div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => setShowErrors(!showErrors)}
                >
                  {showErrors ? 'Hide errors' : `Show ${provisionResult.errors.length} errors`}
                </button>
                {showErrors && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 space-y-1">
                    {provisionResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-400 font-mono break-all">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button onClick={() => { setProvisionResult(null); setShowErrors(false) }} className="w-full">
              Close
            </Button>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{t('add.title')}</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('add.name')}</label>
                <Input placeholder="de-0-myserver" value={addForm.name} onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('add.ip')}</label>
                <Input placeholder="1.2.3.4" value={addForm.ip} onChange={(e) => setAddForm(f => ({ ...f, ip: e.target.value }))} required />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">{t('add.user')}</label>
                  <Input value={addForm.user} onChange={(e) => setAddForm(f => ({ ...f, user: e.target.value }))} />
                </div>
                <div className="w-20">
                  <label className="text-xs text-muted-foreground">{t('add.port')}</label>
                  <Input value={addForm.port} onChange={(e) => setAddForm(f => ({ ...f, port: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('add.password')}</label>
                <Input type="password" placeholder="password" value={addForm.password} onChange={(e) => setAddForm(f => ({ ...f, password: e.target.value }))} required />
              </div>
              {addResult && (
                <p className={`text-sm ${addResult === t('add.success') ? 'text-green-500' : 'text-red-500'}`}>{addResult}</p>
              )}
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={adding} className="flex-1">
                  {adding ? t('add.submitting') : t('add.submit')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>{t('add.cancel')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

function StatPill({ label, value, tone }: { label: string; value: number; tone: 'good' | 'bad' | 'muted' }) {
  const toneClass = {
    good: 'border-green-500/25 bg-green-500/10 text-green-500',
    bad: 'border-destructive/30 bg-destructive/10 text-destructive',
    muted: 'border-border bg-card text-foreground',
  }[tone]

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function FleetSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, group) => (
        <div key={group} className="space-y-3">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {Array.from({ length: 5 }).map((__, i) => (
              <div key={i} className="h-36 animate-pulse rounded-lg border border-border bg-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function summarizeSpeedtest(output: string): string {
  const jsonStart = output.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const data = JSON.parse(output.slice(jsonStart))
      const down = typeof data?.download?.bandwidth === 'number'
        ? ((data.download.bandwidth * 8) / 1_000_000).toFixed(1)
        : null
      const up = typeof data?.upload?.bandwidth === 'number'
        ? ((data.upload.bandwidth * 8) / 1_000_000).toFixed(1)
        : null
      const ping = typeof data?.ping?.latency === 'number'
        ? data.ping.latency.toFixed(1)
        : null
      const parts = [
        down ? `down ${down} Mbps` : null,
        up ? `up ${up} Mbps` : null,
        ping ? `ping ${ping} ms` : null,
      ].filter(Boolean)
      if (parts.length) return parts.join(', ')
    } catch {}
  }
  return output.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Speedtest completed'
}

function UntrackedCard({ node, onAdd }: { node: PanelNode; onAdd: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(text)
    setTimeout(() => setCopied(null), 1200)
  }, [])

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2 select-none">
      <div className="flex items-center justify-between">
        <span
          className="font-medium text-sm truncate hover:text-primary transition-colors cursor-pointer"
          title="Click to copy"
          onClick={() => copy(node.name)}
        >
          {copied === node.name ? '✓ copied' : node.name}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${node.isConnected ? 'bg-green-500/20 text-green-400' : 'bg-destructive/20 text-destructive'}`}>
          {node.isConnected ? `👤${node.usersOnline}` : node.isConnecting ? 'connecting…' : 'offline'}
        </span>
      </div>
      <p
        className="text-xs text-muted-foreground font-mono hover:text-primary transition-colors cursor-pointer"
        title="Click to copy"
        onClick={() => copy(node.address)}
      >
        {copied === node.address ? '✓ copied' : node.address}
      </p>
      <p className="text-[10px] text-muted-foreground/60">{node.countryCode}</p>
      <Button size="sm" variant="outline" className="mt-auto text-xs" onClick={onAdd}>
        + Add to fleet
      </Button>
    </div>
  )
}
