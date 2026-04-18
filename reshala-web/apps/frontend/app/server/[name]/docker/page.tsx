'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchDockerContainers, dockerControl, dockerPrune } from '@/lib/api'
import { createDockerSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import type { DockerContainer } from '@reshala-web/shared'

interface Props {
  params: { name: string }
}

export default function DockerPage({ params }: Props) {
  const { name } = params
  const qc = useQueryClient()

  const { data: containers = [], isLoading, error } = useQuery({
    queryKey: ['docker', name],
    queryFn: () => fetchDockerContainers(name),
    refetchInterval: 15_000,
  })

  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [pruning, setPruning] = useState<string | null>(null)
  const [pruneResult, setPruneResult] = useState<string | null>(null)
  const [logsContainer, setLogsContainer] = useState<DockerContainer | null>(null)

  async function control(id: string, action: 'start' | 'stop' | 'restart') {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await dockerControl(name, id, action)
      await qc.invalidateQueries({ queryKey: ['docker', name] })
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  async function prune(type: 'images' | 'system') {
    if (!confirm(type === 'system' ? 'Remove ALL unused Docker data (images, containers, volumes, networks)?' : 'Remove unused images?')) return
    setPruning(type)
    setPruneResult(null)
    try {
      const res = await dockerPrune(name, type)
      setPruneResult(typeof res === 'string' ? res : JSON.stringify(res))
    } finally {
      setPruning(null)
      qc.invalidateQueries({ queryKey: ['docker', name] })
    }
  }

  const running = containers.filter((c) => c.state === 'running').length
  const total = containers.length

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <Link href={`/server/${name}`} className="text-muted-foreground hover:text-foreground text-sm">
          ← {name}
        </Link>
        <h1 className="font-bold text-lg">Docker</h1>
        {!isLoading && (
          <span className="text-xs text-muted-foreground">{running}/{total} running</span>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => prune('images')}
            disabled={pruning !== null}
          >
            {pruning === 'images' ? 'Pruning…' : 'Prune images'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => prune('system')}
            disabled={pruning !== null}
            className="text-red-400 border-red-400/40 hover:bg-red-400/10"
          >
            {pruning === 'system' ? 'Pruning…' : 'Prune all'}
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-screen-xl mx-auto space-y-4">
        {pruneResult && (
          <div className="rounded-lg border border-border bg-black p-3 font-mono text-xs text-green-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {pruneResult}
            <button onClick={() => setPruneResult(null)} className="block mt-2 text-muted-foreground hover:text-foreground">
              [close]
            </button>
          </div>
        )}

        {isLoading && (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-muted rounded animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-400">
            Failed to connect: {(error as Error).message}
          </div>
        )}

        {!isLoading && containers.length === 0 && !error && (
          <p className="text-muted-foreground text-sm">No containers found.</p>
        )}

        <div className="space-y-2">
          {containers.map((c) => (
            <ContainerRow
              key={c.id}
              container={c}
              busy={!!busy[c.id]}
              onControl={(action) => control(c.id, action)}
              onLogs={() => setLogsContainer(c)}
            />
          ))}
        </div>
      </div>

      {logsContainer && (
        <LogsPanel
          serverName={name}
          container={logsContainer}
          onClose={() => setLogsContainer(null)}
        />
      )}
    </main>
  )
}

function ContainerRow({
  container: c,
  busy,
  onControl,
  onLogs,
}: {
  container: DockerContainer
  busy: boolean
  onControl: (a: 'start' | 'stop' | 'restart') => void
  onLogs: () => void
}) {
  const isRunning = c.state === 'running'

  const stateBadge = {
    running: 'bg-green-500/20 text-green-400 border-green-500/30',
    exited: 'bg-red-500/20 text-red-400 border-red-500/30',
    paused: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    restarting: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    created: 'bg-muted text-muted-foreground border-border',
    dead: 'bg-red-500/20 text-red-400 border-red-500/30',
    removing: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  }[c.state] ?? 'bg-muted text-muted-foreground border-border'

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-4 flex-wrap">
      <span className={`text-xs px-2 py-0.5 rounded border font-mono ${stateBadge}`}>
        {c.state}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{c.name}</p>
        <p className="text-xs text-muted-foreground truncate">{c.image}</p>
      </div>
      {c.ports && (
        <p className="text-xs text-muted-foreground font-mono hidden md:block truncate max-w-48">
          {c.ports}
        </p>
      )}
      <p className="text-xs text-muted-foreground hidden lg:block">{c.status}</p>

      <div className="flex gap-1.5 flex-shrink-0">
        <button
          onClick={onLogs}
          disabled={busy}
          className="px-2.5 py-1 text-xs rounded border border-border hover:border-primary/50 transition-colors disabled:opacity-50"
        >
          Logs
        </button>
        {!isRunning && (
          <button
            onClick={() => onControl('start')}
            disabled={busy}
            className="px-2.5 py-1 text-xs rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
          >
            {busy ? '…' : 'Start'}
          </button>
        )}
        {isRunning && (
          <button
            onClick={() => onControl('restart')}
            disabled={busy}
            className="px-2.5 py-1 text-xs rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
          >
            {busy ? '…' : 'Restart'}
          </button>
        )}
        {isRunning && (
          <button
            onClick={() => onControl('stop')}
            disabled={busy}
            className="px-2.5 py-1 text-xs rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {busy ? '…' : 'Stop'}
          </button>
        )}
      </div>
    </div>
  )
}

function LogsPanel({
  serverName,
  container,
  onClose,
}: {
  serverName: string
  container: DockerContainer
  onClose: () => void
}) {
  const [lines, setLines] = useState<{ type: string; data: string }[]>([])
  const [connected, setConnected] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const socketRef = useRef<ReturnType<typeof createDockerSocket> | null>(null)

  useEffect(() => {
    const socket = createDockerSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('logs', { serverName, containerId: container.id, tail: 200 })
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
  }, [serverName, container.id])

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm p-4">
      <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-bold text-white">
            {container.name}
            <span className="text-muted-foreground font-normal ml-2 text-sm">{container.image}</span>
          </h2>
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
