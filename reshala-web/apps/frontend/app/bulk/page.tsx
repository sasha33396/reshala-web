'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchFleet, fetchPlugins } from '@/lib/api'
import { createPluginsSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Plugin, PluginRunPayload } from '@reshala-web/shared'

type ServerStatus = 'pending' | 'running' | 'done' | 'error'
type SelectMode = 'all' | 'country' | 'custom'
type FilterMode = 'all' | ServerStatus

interface ServerState {
  status: ServerStatus
  output: { type: string; data: string }[]
}

export default function BulkPage() {
  const { data: groups = [] } = useQuery({ queryKey: ['fleet'], queryFn: fetchFleet })
  const { data: plugins = [] } = useQuery({ queryKey: ['plugins'], queryFn: fetchPlugins })

  const allServers = groups.flatMap((g) => g.servers)

  const [selectMode, setSelectMode] = useState<SelectMode>('all')
  const [selectedCountry, setSelectedCountry] = useState<string>('')
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set())
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [running, setRunning] = useState(false)
  const [serverStates, setServerStates] = useState<Map<string, ServerState>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('all')
  const socketRef = useRef<ReturnType<typeof createPluginsSocket> | null>(null)

  useEffect(() => () => { socketRef.current?.disconnect() }, [])

  const targetServers = (() => {
    if (selectMode === 'all') return allServers
    if (selectMode === 'country') return allServers.filter((s) => s.country === selectedCountry)
    return allServers.filter((s) => customSelected.has(s.name))
  })()

  function run() {
    if (!selectedPlugin || running || targetServers.length === 0) return

    const initial = new Map<string, ServerState>()
    targetServers.forEach((s) => initial.set(s.name, { status: 'pending', output: [] }))
    setServerStates(initial)
    setExpanded(new Set())
    setFilter('all')
    setRunning(true)

    const socket = createPluginsSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      const payload: PluginRunPayload = {
        pluginId: selectedPlugin.id,
        serverNames: targetServers.map((s) => s.name),
        parallel: true,
        concurrency: 10,
      }
      socket.emit('run', payload)
    })

    socket.on('server-start', ({ server }: { server: string }) =>
      setServerStates((prev) => {
        const next = new Map(prev)
        const cur = next.get(server)
        if (cur) next.set(server, { ...cur, status: 'running' })
        return next
      }),
    )

    socket.on('output', ({ server, type, data }: { server: string; type: string; data: string }) =>
      setServerStates((prev) => {
        const next = new Map(prev)
        const cur = next.get(server)
        if (cur) next.set(server, { ...cur, output: [...cur.output, { type, data }] })
        return next
      }),
    )

    socket.on('server-done', ({ server }: { server: string }) =>
      setServerStates((prev) => {
        const next = new Map(prev)
        const cur = next.get(server)
        if (cur) next.set(server, { ...cur, status: 'done' })
        return next
      }),
    )

    socket.on('server-error', ({ server, error }: { server: string; error: string }) =>
      setServerStates((prev) => {
        const next = new Map(prev)
        const cur = next.get(server)
        if (cur) next.set(server, { ...cur, status: 'error', output: [...cur.output, { type: 'stderr', data: error }] })
        return next
      }),
    )

    socket.on('done', () => { setRunning(false); socket.disconnect() })
    socket.on('error', () => setRunning(false))
    socket.connect()
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  function toggleCustom(name: string) {
    setCustomSelected((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  function selectAllCustom() {
    setCustomSelected(new Set(allServers.map((s) => s.name)))
  }

  function clearCustom() {
    setCustomSelected(new Set())
  }

  const categories = [...new Set(plugins.filter((p) => !p.hidden).map((p) => p.category))]

  const states = Array.from(serverStates.values())
  const counts = {
    pending: states.filter((s) => s.status === 'pending').length,
    running: states.filter((s) => s.status === 'running').length,
    done: states.filter((s) => s.status === 'done').length,
    error: states.filter((s) => s.status === 'error').length,
    total: serverStates.size,
  }
  const finished = counts.done + counts.error
  const progress = counts.total > 0 ? Math.round((finished / counts.total) * 100) : 0

  const displayedStates = Array.from(serverStates.entries()).filter(([, s]) =>
    filter === 'all' || s.status === filter,
  )

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">
          ← Fleet
        </Link>
        <h1 className="font-bold text-lg">Bulk Operations</h1>
      </header>

      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        {/* Plugin selector */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="font-semibold text-sm">1. Select plugin</p>
          {categories.map((cat) => (
            <div key={cat}>
              <p className="text-xs uppercase text-muted-foreground mb-1">{cat}</p>
              <div className="flex flex-wrap gap-2">
                {plugins
                  .filter((p) => p.category === cat && !p.hidden)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPlugin(p)}
                      className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                        selectedPlugin?.id === p.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      {p.title}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </section>

        {/* Server selector */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="font-semibold text-sm">2. Select servers</p>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'country', 'custom'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSelectMode(mode)}
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                  selectMode === mode
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {mode === 'all'
                  ? `All (${allServers.length})`
                  : mode === 'country'
                  ? 'By country'
                  : 'Custom'}
              </button>
            ))}
          </div>

          {selectMode === 'country' && (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <button
                  key={g.country}
                  onClick={() => setSelectedCountry(g.country)}
                  className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                    selectedCountry === g.country
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  {g.country} ({g.servers.length})
                </button>
              ))}
            </div>
          )}

          {selectMode === 'custom' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button onClick={selectAllCustom} className="text-xs text-primary hover:underline">
                  Select all
                </button>
                <button onClick={clearCustom} className="text-xs text-muted-foreground hover:underline">
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 max-h-52 overflow-y-auto pr-1">
                {allServers.map((s) => (
                  <label
                    key={s.name}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={customSelected.has(s.name)}
                      onChange={() => toggleCustom(s.name)}
                      className="w-3 h-3 accent-primary"
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {targetServers.length} server{targetServers.length !== 1 ? 's' : ''} selected
          </p>
        </section>

        {/* Run */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={run}
            disabled={!selectedPlugin || running || targetServers.length === 0}
          >
            {running
              ? `Running… ${finished}/${counts.total}`
              : `Run on ${targetServers.length} server${targetServers.length !== 1 ? 's' : ''}`}
          </Button>
          {selectedPlugin && <Badge variant="secondary">{selectedPlugin.title}</Badge>}
          {running && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
        </div>

        {/* Output */}
        {serverStates.size > 0 && (
          <section className="space-y-3">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground font-mono">{progress}%</span>
                {counts.running > 0 && <span className="text-yellow-400">{counts.running} running</span>}
                {counts.done > 0 && <span className="text-green-400">{counts.done} done</span>}
                {counts.error > 0 && <span className="text-red-400">{counts.error} errors</span>}
                {counts.pending > 0 && <span className="text-muted-foreground">{counts.pending} pending</span>}
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Filter */}
            <div className="flex gap-1.5 flex-wrap">
              {(['all', 'pending', 'running', 'done', 'error'] as const).map((f) => {
                const cnt =
                  f === 'all' ? counts.total : counts[f as keyof typeof counts]
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      filter === f
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {f} {cnt > 0 && `(${cnt})`}
                  </button>
                )
              })}
            </div>

            {/* Cards */}
            <div className="space-y-1">
              {displayedStates.map(([name, state]) => (
                <ServerCard
                  key={name}
                  name={name}
                  state={state}
                  expanded={expanded.has(name)}
                  onToggle={() => toggleExpand(name)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function ServerCard({
  name,
  state,
  expanded,
  onToggle,
}: {
  name: string
  state: ServerState
  expanded: boolean
  onToggle: () => void
}) {
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [state.output.length, expanded])

  const { icon, color } = {
    pending: { icon: '○', color: 'text-muted-foreground' },
    running: { icon: '▶', color: 'text-yellow-400' },
    done: { icon: '✓', color: 'text-green-400' },
    error: { icon: '✗', color: 'text-red-400' },
  }[state.status]

  return (
    <div className="border border-border rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 text-left transition-colors"
      >
        <span className={`font-mono text-sm w-4 ${color}`}>{icon}</span>
        <span className="text-sm font-medium flex-1">{name}</span>
        {state.output.length > 0 && (
          <span className="text-xs text-muted-foreground">{state.output.length} lines</span>
        )}
        <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div
          ref={outputRef}
          className="bg-black px-3 py-2 max-h-52 overflow-y-auto font-mono text-xs border-t border-border"
        >
          {state.output.length === 0 ? (
            <span className="text-muted-foreground">Waiting…</span>
          ) : (
            state.output.map((line, i) => (
              <div key={i} className={line.type === 'stderr' ? 'text-red-400' : 'text-green-300'}>
                {line.data}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
