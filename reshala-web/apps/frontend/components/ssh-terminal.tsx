'use client'

import { useEffect, useRef } from 'react'

interface Props {
  serverName: string
}

export function SshTerminal({ serverName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let disposed = false
    let cleanupFn: (() => void) | null = null

    async function setup() {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      const { io } = await import('socket.io-client')

      if (disposed || !containerRef.current) return

      const term = new Terminal({
        cursorBlink: true,
        theme: { background: '#0d1117', foreground: '#c9d1d9' },
        fontSize: 13,
        fontFamily: 'monospace',
      })
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()

      const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? ''
      const socket = io(`${wsUrl}/terminal`, { withCredentials: true })

      socket.on('connect', () => {
        socket.emit('connect-ssh', { serverName })
      })
      socket.on('data', (chunk: string) => term.write(chunk))
      socket.on('close', () => term.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n'))
      socket.on('error', (msg: string) =>
        term.write(`\r\n\x1b[31m[Error: ${msg}]\x1b[0m\r\n`),
      )

      term.onData((data) => socket.emit('input', data))

      const observer = new ResizeObserver(() => {
        fitAddon.fit()
        socket.emit('resize', { cols: term.cols, rows: term.rows })
      })
      observer.observe(containerRef.current!)

      cleanupFn = () => {
        observer.disconnect()
        socket.disconnect()
        term.dispose()
      }
    }

    setup()

    return () => {
      disposed = true
      cleanupFn?.()
    }
  }, [serverName])

  return (
    <div
      ref={containerRef}
      className="w-full rounded-md overflow-hidden"
      style={{ height: '500px', backgroundColor: '#0d1117' }}
    />
  )
}
