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

type LineTone = 'ok' | 'attention' | 'error' | 'muted'

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

    socket.on('connect', () => {
      setOutput((prev) => [...prev, { server: '', type: 'stdout', data: 'connected, running...' }])
      socket.emit('run', payload)
    })
    socket.on('connect_error', (err) => {
      setOutput((prev) => [...prev, { server: '', type: 'stderr', data: `connect error: ${err.message}` }])
      setRunning(false)
    })
    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setOutput((prev) => [...prev, { server: '', type: 'stderr', data: `disconnected: ${reason}` }])
      }
    })

    socket.connect()

    socket.on('output', (line: OutputLine) => setOutput((prev) => [...prev, line]))
    socket.on('server-start', ({ server }: { server: string }) =>
      setOutput((prev) => [...prev, { server, type: 'stdout', data: `server: ${server}` }]),
    )
    socket.on('server-error', ({ error }: { server: string; error: string }) =>
      setOutput((prev) => [...prev, { server: '', type: 'stderr', data: error }]),
    )
    socket.on('done', () => {
      setRunning(false)
      socket.disconnect()
    })
    socket.on('error', (msg: unknown) => {
      const text = typeof msg === 'string' ? msg : (msg as any)?.message ?? JSON.stringify(msg)
      setOutput((prev) => [...prev, { server: '', type: 'stderr', data: `Error: ${text}` }])
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
          {running ? 'Running...' : 'Run'}
        </Button>
        {selected && <Badge variant="secondary">{selected.title}</Badge>}
        {running && (
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        )}
      </div>

      {output.length > 0 && (
        <div
          ref={outputRef}
          className="bg-black rounded p-3 h-64 overflow-y-auto font-mono text-xs"
        >
          {output.map((line, i) => {
            const text = formatOutputLine(line)
            if (!text) return null
            return (
              <div key={i} className={toneClass(classifyOutputLine(line, text))}>
                {text}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatOutputLine(line: OutputLine): string {
  if (line.type === 'exit') {
    return line.data === '0' ? 'completed successfully' : `completed with errors, exit code ${line.data}`
  }
  return line.data
}

function classifyOutputLine(line: OutputLine, text: string): LineTone {
  const value = text.toLowerCase()
  if (line.type === 'stderr') return 'error'
  if (line.type === 'exit') return line.data === '0' ? 'ok' : 'error'
  if (
    value.includes('error') ||
    value.includes('failed') ||
    value.includes('not found') ||
    value.includes('unavailable') ||
    value.includes('exit code')
  ) return 'error'
  if (
    value.includes('installing') ||
    value.includes('waiting') ||
    value.includes('checking') ||
    value.includes('starting') ||
    value.includes('warning') ||
    value.includes('attention')
  ) return 'attention'
  if (
    value.includes('already installed') ||
    value.includes('completed successfully') ||
    value.includes('download:') ||
    value.includes('upload:') ||
    value.includes('ping:') ||
    value.includes('result:') ||
    value.includes('connected, running') ||
    value.startsWith('server:')
  ) return 'ok'
  return 'muted'
}

function toneClass(tone: LineTone): string {
  return {
    ok: 'text-green-300',
    attention: 'text-yellow-300',
    error: 'text-red-400',
    muted: 'text-slate-300',
  }[tone]
}
