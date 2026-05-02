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
      <div className="group h-full cursor-pointer select-none rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60 hover:bg-accent/30">
        <div className="mb-2 flex items-start justify-between gap-3">
          <span
            className="min-w-0 truncate pr-2 text-sm font-semibold transition-colors group-hover:text-primary"
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
          className="truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
          title="Click to copy"
          onClick={(e) => { e.preventDefault(); copy(server.ip) }}
        >
          {copied === server.ip ? '✓ copied' : server.ip}
        </p>
        {panelHost && (
          <p
            className="mb-3 truncate text-[11px] text-muted-foreground/70 transition-colors hover:text-primary/70"
            title={`${panelHost.remark} — click to copy`}
            onClick={(e) => { e.preventDefault(); copy(panelHost.address) }}
          >
            {copied === panelHost.address ? '✓ copied' : `${panelHost.address}:${panelHost.port}`}
          </p>
        )}
        {!panelHost && <p className="mb-3 text-[11px] text-muted-foreground/40">No panel host</p>}

        {online === false ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Offline
          </div>
        ) : metrics && (metrics.cpu > 0 || metrics.ram > 0 || metrics.uptime > 0) ? (
          <>
            <MiniBar label="CPU" value={metrics.cpu} />
            <MiniBar label="RAM" value={metrics.ram} />
            <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
              Up {formatUptime(metrics.uptime)}
            </p>
          </>
        ) : metrics ? (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">No metrics</p>
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
    <div className="mb-1.5 flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-8">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
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
