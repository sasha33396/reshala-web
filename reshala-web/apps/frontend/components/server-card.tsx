'use client'

import Link from 'next/link'
import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Server, PanelNode, PanelHost } from '@reshala-web/shared'
import { fetchMetrics } from '@/lib/api'
import { StatusIndicator } from './status-indicator'

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(text)
    setTimeout(() => setCopied(null), 1200)
  }, [])
  return { copied, copy }
}

interface Props {
  server: Server
  online: boolean | null
  panelNode?: PanelNode | null
  panelHost?: PanelHost
}

export function ServerCard({ server, online, panelNode, panelHost }: Props) {
  const { data: metrics } = useQuery({
    queryKey: ['metrics', server.name],
    queryFn: () => fetchMetrics(server.name),
    enabled: online === true,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
  const { copied, copy } = useCopy()

  return (
    <Link href={`/server/${server.name}`}>
      <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/60 transition-colors cursor-pointer h-full select-none">
        <div className="flex items-center justify-between mb-1">
          <span
            className="font-medium text-sm truncate pr-2 hover:text-primary transition-colors"
            title="Click to copy"
            onClick={(e) => { e.preventDefault(); copy(server.name) }}
          >
            {copied === server.name ? '✓ copied' : server.name}
          </span>
          <div className="flex items-center gap-1.5">
            {panelNode !== undefined && (
              <PanelBadge node={panelNode ?? null} online={online} />
            )}
            <StatusIndicator online={online} />
          </div>
        </div>
        <p
          className="text-xs text-muted-foreground font-mono hover:text-primary transition-colors cursor-pointer"
          title="Click to copy"
          onClick={(e) => { e.preventDefault(); copy(server.ip) }}
        >
          {copied === server.ip ? '✓ copied' : server.ip}
        </p>
        {panelHost && (
          <p
            className="text-[10px] text-muted-foreground/60 mb-2 truncate hover:text-primary/70 transition-colors cursor-pointer"
            title={`${panelHost.remark} — click to copy`}
            onClick={(e) => { e.preventDefault(); copy(panelHost.address) }}
          >
            {copied === panelHost.address ? '✓ copied' : `${panelHost.address}:${panelHost.port}`}
          </p>
        )}
        {!panelHost && <div className="mb-3" />}

        {online === false ? (
          <p className="text-xs text-destructive">Offline</p>
        ) : metrics && (metrics.cpu > 0 || metrics.ram > 0 || metrics.uptime > 0) ? (
          <>
            <MiniBar label="CPU" value={metrics.cpu} />
            <MiniBar label="RAM" value={metrics.ram} />
            <p className="text-xs text-muted-foreground mt-2">
              Up {formatUptime(metrics.uptime)}
            </p>
          </>
        ) : metrics ? (
          <p className="text-xs text-muted-foreground/50 mt-2">No metrics</p>
        ) : (
          <div className="space-y-1.5">
            <div className="h-1.5 w-full rounded bg-muted animate-pulse" />
            <div className="h-1.5 w-3/4 rounded bg-muted animate-pulse" />
          </div>
        )}
      </div>
    </Link>
  )
}

function MiniBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  const color =
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-primary'
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs text-muted-foreground w-8">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
    </div>
  )
}

function PanelBadge({ node, online }: { node: PanelNode | null; online: boolean | null }) {
  if (!node) return (
    <span className="text-[10px] px-1 rounded bg-muted/60 text-muted-foreground/50">no panel</span>
  )
  if (node.isDisabled) return (
    <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">disabled</span>
  )
  if (node.isConnecting) return (
    <span className="text-[10px] px-1 rounded bg-yellow-500/20 text-yellow-400">connecting…</span>
  )
  if (!node.isConnected) return (
    <span className="text-[10px] px-1 rounded bg-destructive/20 text-destructive">panel offline</span>
  )
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 tabular-nums flex items-center gap-1">
      <span>👤{node.usersOnline}</span>
      <span
        className={`w-1.5 h-1.5 rounded-full ${online === true ? 'bg-green-400' : online === false ? 'bg-red-400' : 'bg-muted-foreground/40'}`}
        title={online === true ? 'SSH ok' : online === false ? 'No SSH access' : 'SSH unknown'}
      />
    </span>
  )
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
