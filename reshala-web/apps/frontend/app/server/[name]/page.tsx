'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchServer, fetchMetrics, provisionServer, updateServer, fetchPanelNodes } from '@/lib/api'
import type { PanelNode } from '@reshala-web/shared'
import { useT, LangToggle } from '@/lib/i18n'
import { MetricsChart } from '@/components/metrics-chart'
import { PluginRunner } from '@/components/plugin-runner'
import { StatusIndicator } from '@/components/status-indicator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface Props {
  params: { name: string }
}

export default function ServerPage({ params }: Props) {
  const { name } = params
  const qc = useQueryClient()
  const { t } = useT()
  const [provisioning, setProvisioning] = useState(false)
  const [provisionResult, setProvisionResult] = useState<string | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({ ip: '', port: '', user: '', sudoPass: '' })
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)

  function openEdit(s: any) {
    setEditForm({ ip: s.ip, port: String(s.port), user: s.user, sudoPass: s.sudoPass ?? '' })
    setSaveResult(null)
    setShowEdit(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveResult(null)
    try {
      await updateServer(name, {
        ip: editForm.ip,
        port: parseInt(editForm.port) || 22,
        user: editForm.user,
        sudoPass: editForm.sudoPass || undefined,
      })
      qc.invalidateQueries({ queryKey: ['server', name] })
      qc.invalidateQueries({ queryKey: ['fleet'] })
      setSaveResult(t('edit.saved'))
      setTimeout(() => setShowEdit(false), 800)
    } catch (e: any) {
      setSaveResult(e?.message ?? t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleProvision() {
    setProvisioning(true)
    setProvisionResult(null)
    try {
      const res = await provisionServer(name)
      setProvisionResult(res.ok ? 'Key deployed successfully' : `Failed: ${res.error}`)
    } catch (e: any) {
      setProvisionResult(`Error: ${e?.message}`)
    } finally {
      setProvisioning(false)
    }
  }

  const { data: server } = useQuery({
    queryKey: ['server', name],
    queryFn: () => fetchServer(name),
  })

  const { data: metrics } = useQuery({
    queryKey: ['metrics', name],
    queryFn: () => fetchMetrics(name),
    refetchInterval: 30_000,
    enabled: !!server,
  })

  const { data: panelNodes = [] } = useQuery({
    queryKey: ['panel-nodes'],
    queryFn: fetchPanelNodes,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  })
  const panelNode: PanelNode | undefined = server
    ? panelNodes.find((n: PanelNode) => n.address === server.ip)
    : undefined

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">
            {t('server.back')}
          </Link>
          <h1 className="font-bold text-lg">{name}</h1>
          {metrics && (
            <StatusIndicator online={metrics.cpu !== undefined} size="md" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <LangToggle />
          {server && (
            <Button variant="outline" size="sm" onClick={() => openEdit(server)}>
              {t('server.edit')}
            </Button>
          )}
        </div>
      </header>

      <div className="p-6 max-w-screen-xl mx-auto space-y-6">
        {metrics && metrics.cpu !== undefined && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label={t('server.cpu')} value={`${metrics.cpu.toFixed(1)}%`} />
            <StatCard label={t('server.ram')} value={`${metrics.ram.toFixed(1)}%`} />
            <StatCard label={t('server.disk')} value={`${metrics.disk.toFixed(1)}%`} />
            <StatCard label={t('server.uptime')} value={formatUptime(metrics.uptime)} />
          </div>
        )}

        {metrics?.speedtestDown !== undefined && (
          <div className="grid grid-cols-2 gap-3">
            <StatCard label={t('server.speedDown')} value={`${metrics.speedtestDown?.toFixed(1)} Mbps`} />
            <StatCard label={t('server.speedUp')} value={`${metrics.speedtestUp?.toFixed(1)} Mbps`} />
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('server.metrics')}</CardTitle>
          </CardHeader>
          <CardContent>
            <MetricsChart serverName={name} />
          </CardContent>
        </Card>

        {panelNode && (
          <Card>
            <CardHeader>
              <CardTitle>Remnawave Panel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Status"
                  value={panelNode.isDisabled ? 'Disabled' : panelNode.isConnected ? 'Connected' : panelNode.isConnecting ? 'Connecting…' : 'Disconnected'}
                />
                <StatCard label="Users online" value={String(panelNode.usersOnline)} />
                {!!panelNode.trafficUsedBytes && (
                  <StatCard label="Traffic used" value={formatBytes(panelNode.trafficUsedBytes)} />
                )}
                {!!panelNode.trafficLimitBytes && (
                  <StatCard label="Traffic limit" value={formatBytes(panelNode.trafficLimitBytes)} />
                )}
              </div>
              {panelNode.lastStatusMessage && !panelNode.isConnected && (
                <p className="mt-3 text-xs text-destructive font-mono break-all">{panelNode.lastStatusMessage}</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('server.plugins')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PluginRunner serverName={name} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('server.quickActions')}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3 flex-wrap items-center">
            <Link href={`/server/${name}/terminal`}>
              <Button variant="outline">{t('server.terminal')}</Button>
            </Link>
            <Link href={`/server/${name}/docker`}>
              <Button variant="outline">{t('server.docker')}</Button>
            </Link>
            <Link href={`/server/${name}/security`}>
              <Button variant="outline">{t('server.security')}</Button>
            </Link>
            <Link href={`/server/${name}/remnawave`}>
              <Button variant="outline">{t('server.remnawave')}</Button>
            </Link>
            <Link href={`/wizard/node-setup?server=${name}`}>
              <Button variant="outline">{t('server.setupNode')}</Button>
            </Link>
            <Button variant="outline" onClick={handleProvision} disabled={provisioning}>
              {provisioning ? t('server.provisioning') : t('server.provision')}
            </Button>
            {provisionResult && (
              <span className={`text-sm ${provisionResult.startsWith('Key') ? 'text-green-500' : 'text-red-500'}`}>
                {provisionResult}
              </span>
            )}
          </CardContent>
        </Card>

        {server && (
          <Card>
            <CardHeader>
              <CardTitle>{t('server.connectionInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm font-mono space-y-1 text-muted-foreground">
              <p>IP: {server.ip}</p>
              <p>Port: {server.port}</p>
              <p>User: {server.user}</p>
              <p>Key: {server.keyPath}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {showEdit && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowEdit(false)}>
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{t('edit.title')} {name}</h2>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('edit.ip')}</label>
                <Input
                  value={editForm.ip}
                  onChange={(e) => setEditForm(f => ({ ...f, ip: e.target.value }))}
                  required
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">{t('edit.user')}</label>
                  <Input
                    value={editForm.user}
                    onChange={(e) => setEditForm(f => ({ ...f, user: e.target.value }))}
                  />
                </div>
                <div className="w-24">
                  <label className="text-xs text-muted-foreground">{t('edit.port')}</label>
                  <Input
                    value={editForm.port}
                    onChange={(e) => setEditForm(f => ({ ...f, port: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('edit.password')}</label>
                <Input
                  type="password"
                  placeholder={t('edit.passwordHint')}
                  value={editForm.sudoPass}
                  onChange={(e) => setEditForm(f => ({ ...f, sudoPass: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
              {saveResult && (
                <p className={`text-sm ${saveResult === t('edit.saved') ? 'text-green-500' : 'text-red-500'}`}>{saveResult}</p>
              )}
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={saving} className="flex-1">
                  {saving ? t('edit.saving') : t('edit.save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowEdit(false)}>{t('edit.cancel')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${Math.floor((s % 3600) / 60)}m`
}
