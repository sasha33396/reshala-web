'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPlugins } from '@/lib/api'
import { createPluginsSocket } from '@/lib/socket'
import type { Plugin, PluginRunPayload } from '@reshala-web/shared'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

interface OutputLine {
  server: string
  type: 'stdout' | 'stderr' | 'exit'
  data: string
}

interface Props {
  serverName?: string
}

export function PluginRunner({ serverName }: Props) {
  const { data: plugins = [] } = useQuery({ queryKey: ['plugins'], queryFn: fetchPlugins })
  const [selected, setSelected] = useState<Plugin | null>(null)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<OutputLine[]>([])
  const outputRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<ReturnType<typeof createPluginsSocket> | null>(null)

  useEffect(() => {
    return () => { socketRef.current?.disconnect() }
  }, [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  function run() {
    if (!selected || running) return
    const socket = createPluginsSocket()
    socketRef.current = socket
    setOutput([])
    setRunning(true)

    const payload: PluginRunPayload = { pluginId: selected.id, serverName }

    socket.connect()
    socket.emit('run', payload)

    socket.on('output', (line: OutputLine) => setOutput((prev) => [...prev, line]))
    socket.on('server-start', ({ server }: { server: string }) =>
      setOutput((prev) => [...prev, { server, type: 'stdout', data: `\n▶ ${server}` }]),
    )
    socket.on('server-error', ({ server, error }: { server: string; error: string }) =>
      setOutput((prev) => [...prev, { server, type: 'stderr', data: `✗ ${error}` }]),
    )
    socket.on('done', () => {
      setRunning(false)
      socket.disconnect()
    })
    socket.on('error', (msg: string) => {
      setOutput((prev) => [...prev, { server: '', type: 'stderr', data: `Error: ${msg}` }])
      setRunning(false)
    })
  }

  const categories = [...new Set(plugins.filter((p) => !p.hidden).map((p) => p.category))]

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-xs uppercase text-muted-foreground mb-1">{cat}</p>
            <div className="flex flex-wrap gap-2">
              {plugins
                .filter((p) => p.category === cat && !p.hidden)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                      selected?.id === p.id
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
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={!selected || running} size="sm">
          {running ? 'Running…' : 'Run'}
        </Button>
        {selected && <Badge variant="secondary">{selected.title}</Badge>}
        {running && (
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        )}
      </div>

      {output.length > 0 && (
        <div
          ref={outputRef}
          className="bg-black rounded p-3 h-64 overflow-y-auto font-mono text-xs"
        >
          {output.map((line, i) => (
            <div
              key={i}
              className={line.type === 'stderr' ? 'text-red-400' : 'text-green-300'}
            >
              {line.data}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
