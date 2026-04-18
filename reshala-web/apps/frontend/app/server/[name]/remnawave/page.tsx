'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchDockerContainers, dockerControl, updateRemnanode } from '@/lib/api'
import { createPluginsSocket, createDockerSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PluginRunPayload } from '@reshala-web/shared'

interface Props {
  params: { name: string }
}

export default function RemnawavePage({ params }: Props) {
  const { name } = params
  const qc = useQueryClient()

  const { data: containers = [], isLoading } = useQuery({
    queryKey: ['docker', name],
    queryFn: () => fetchDockerContainers(name),
    refetchInterval: 10_000,
  })

  const remnanode = containers.find((c) => c.name.includes('remnanode') || c.name.includes('remna'))

  const [busy, setBusy] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateOutput, setUpdateOutput] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  // Install form state
  const [showInstall, setShowInstall] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installOutput, setInstallOutput] = useState<{ type: string; data: string }[]>([])
  const [domain, setDomain] = useState('')
  const [nodePort, setNodePort] = useState('2222')
  const [nodeSecret, setNodeSecret] = useState('')
  const [certMode, setCertMode] = useState<'self' | 'acme'>('self')
  const [email, setEmail] = useState('')
  const installOutputRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<ReturnType<typeof createPluginsSocket> | null>(null)

  useEffect(() => {
    if (installOutputRef.current)
      installOutputRef.current.scrollTop = installOutputRef.current.scrollHeight
  }, [installOutput.length])

  async function control(action: 'start' | 'stop' | 'restart') {
    if (!remnanode) return
    setBusy(true)
    try {
      await dockerControl(name, remnanode.id, action)
      await qc.invalidateQueries({ queryKey: ['docker', name] })
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdate() {
    setUpdating(true)
    setUpdateOutput(null)
    try {
      const res = await updateRemnanode(name)
      setUpdateOutput(res.output)
    } catch (e: any) {
      setUpdateOutput(`Error: ${e?.message}`)
    } finally {
      setUpdating(false)
      qc.invalidateQueries({ queryKey: ['docker', name] })
    }
  }

  function runInstall() {
    socketRef.current?.disconnect()
    const socket = createPluginsSocket()
    socketRef.current = socket
    setInstalling(true)
    setInstallOutput([])

    const envVars: Record<string, string> = {
      SELFSTEAL_DOMAIN: domain,
      NODE_PORT: nodePort,
    }
    if (nodeSecret) envVars.NODE_SECRET_KEY = nodeSecret
    if (certMode === 'acme') {
      envVars.CERT_MODE = 'node_acme'
      if (email) envVars.LETSENCRYPT_EMAIL = email
    }

    socket.on('connect', () => {
      const payload: PluginRunPayload = {
        pluginId: 'remnawave_01_install_node',
        serverName: name,
        envVars,
      }
      socket.emit('run', payload)
    })
    socket.on('output', (line: { type: string; data: string }) => {
      setInstallOutput((prev) => [...prev, line])
    })
    socket.on('done', () => {
      setInstalling(false)
      socket.disconnect()
      qc.invalidateQueries({ queryKey: ['docker', name] })
    })
    socket.on('error', () => { setInstalling(false); socket.disconnect() })
    socket.connect()
  }

  useEffect(() => () => { socketRef.current?.disconnect() }, [])

  const isRunning = remnanode?.state === 'running'

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <Link href={`/server/${name}`} className="text-muted-foreground hover:text-foreground text-sm">
          ← {name}
        </Link>
        <h1 className="font-bold text-lg">Remnawave Node</h1>
      </header>

      <div className="p-6 max-w-screen-lg mx-auto space-y-5">

        {/* Node status card */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-4">
          <p className="font-semibold text-sm">Node Status</p>

          {isLoading && (
            <div className="h-10 w-48 bg-muted rounded animate-pulse" />
          )}

          {!isLoading && !remnanode && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">remnanode container not found</span>
              <Button size="sm" variant="outline" onClick={() => setShowInstall(true)}>
                Install Node
              </Button>
            </div>
          )}

          {remnanode && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <StateBadge state={remnanode.state} />
                <div>
                  <p className="text-sm font-medium">{remnanode.name}</p>
                  <p className="text-xs text-muted-foreground">{remnanode.image}</p>
                </div>
                {remnanode.ports && (
                  <p className="text-xs text-muted-foreground font-mono">{remnanode.ports}</p>
                )}
                <p className="text-xs text-muted-foreground">{remnanode.status}</p>
              </div>

              <div className="flex gap-2 flex-wrap">
                {!isRunning && (
                  <Button size="sm" onClick={() => control('start')} disabled={busy}>
                    {busy ? '…' : 'Start'}
                  </Button>
                )}
                {isRunning && (
                  <Button size="sm" variant="outline" onClick={() => control('restart')} disabled={busy}>
                    {busy ? '…' : 'Restart'}
                  </Button>
                )}
                {isRunning && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-400 border-red-400/40 hover:bg-red-400/10"
                    onClick={() => control('stop')}
                    disabled={busy}
                  >
                    {busy ? '…' : 'Stop'}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setShowLogs(true)}>
                  Logs
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUpdate}
                  disabled={updating}
                >
                  {updating ? 'Updating…' : 'Update (pull + up -d)'}
                </Button>
              </div>

              {updateOutput && (
                <div className="bg-black rounded p-2 font-mono text-xs text-green-300 whitespace-pre-wrap max-h-48 overflow-y-auto border border-border">
                  {updateOutput}
                  <button
                    onClick={() => setUpdateOutput(null)}
                    className="block mt-2 text-muted-foreground hover:text-foreground"
                  >
                    [close]
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Install form */}
        {(!remnanode || showInstall) && (
          <section className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">Install Remnawave Node</p>
              {showInstall && remnanode && (
                <button
                  onClick={() => setShowInstall(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Domain (SELFSTEAL_DOMAIN) *</label>
                <Input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="node1.example.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Node Port (default 2222)</label>
                <Input
                  value={nodePort}
                  onChange={(e) => setNodePort(e.target.value)}
                  placeholder="2222"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Node Secret Key (optional)</label>
                <Input
                  type="password"
                  value={nodeSecret}
                  onChange={(e) => setNodeSecret(e.target.value)}
                  placeholder="auto-generated if empty"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Certificate Mode</label>
                <div className="flex gap-3 mt-1.5">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={certMode === 'self'}
                      onChange={() => setCertMode('self')}
                    />
                    Self-signed
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={certMode === 'acme'}
                      onChange={() => setCertMode('acme')}
                    />
                    Let's Encrypt (ACME)
                  </label>
                </div>
              </div>
              {certMode === 'acme' && (
                <div>
                  <label className="text-xs text-muted-foreground">Let's Encrypt Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.com"
                  />
                </div>
              )}
            </div>

            <Button
              onClick={runInstall}
              disabled={installing || !domain}
            >
              {installing ? 'Installing…' : 'Install Node'}
            </Button>

            {installOutput.length > 0 && (
              <div
                ref={installOutputRef}
                className="bg-black rounded p-2 h-48 overflow-y-auto font-mono text-xs border border-border"
              >
                {installOutput.map((l, i) => (
                  <div key={i} className={l.type === 'stderr' ? 'text-red-400' : 'text-green-300'}>
                    {l.data}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {showLogs && remnanode && (
        <LogsPanel
          serverName={name}
          containerId={remnanode.id}
          containerName={remnanode.name}
          onClose={() => setShowLogs(false)}
        />
      )}
    </main>
  )
}

function StateBadge({ state }: { state: string }) {
  const cls = {
    running: 'bg-green-500/20 text-green-400 border-green-500/30',
    exited: 'bg-red-500/20 text-red-400 border-red-500/30',
    paused: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    restarting: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  }[state] ?? 'bg-muted text-muted-foreground border-border'

  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-mono ${cls}`}>
      {state}
    </span>
  )
}

function LogsPanel({
  serverName,
  containerId,
  containerName,
  onClose,
}: {
  serverName: string
  containerId: string
  containerName: string
  onClose: () => void
}) {
  const [lines, setLines] = useState<{ type: string; data: string }[]>([])
  const [connected, setConnected] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const socket = createDockerSocket()

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('logs', { serverName, containerId, tail: 200 })
    })
    socket.on('log', (line: { type: string; data: string }) =>
      setLines((prev) => [...prev.slice(-2000), line]),
    )
    socket.on('log-end', () => setConnected(false))
    socket.on('log-error', (msg: string) => {
      setLines((prev) => [...prev, { type: 'stderr', data: `Error: ${msg}` }])
      setConnected(false)
    })

    socket.connect()
    return () => { socket.emit('stop-logs'); socket.disconnect() }
  }, [serverName, containerId])

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm p-4">
      <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-bold text-white">{containerName}</h2>
          {connected && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
          <button
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-white text-sm border border-border rounded px-3 py-1"
          >
            Close
          </button>
        </div>
        <div
          ref={ref}
          className="flex-1 bg-black border border-border rounded p-3 overflow-y-auto font-mono text-xs"
        >
          {lines.length === 0 ? (
            <span className="text-muted-foreground">Connecting…</span>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={l.type === 'stderr' ? 'text-red-400' : 'text-green-300'}>
                {l.data}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
