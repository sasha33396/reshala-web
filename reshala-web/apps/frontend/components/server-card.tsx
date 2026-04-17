'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { Server } from '@reshala-web/shared'
import { fetchMetrics } from '@/lib/api'
import { StatusIndicator } from './status-indicator'

interface Props {
  server: Server
  online: boolean | null
}

export function ServerCard({ server, online }: Props) {
  const { data: metrics } = useQuery({
    queryKey: ['metrics', server.name],
    queryFn: () => fetchMetrics(server.name),
    enabled: online === true,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  return (
    <Link href={`/server/${server.name}`}>
      <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/60 transition-colors cursor-pointer h-full">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-sm truncate pr-2">{server.name}</span>
          <StatusIndicator online={online} />
        </div>
        <p className="text-xs text-muted-foreground mb-3 font-mono">{server.ip}</p>

        {metrics && online ? (
          <>
            <MiniBar label="CPU" value={metrics.cpu} />
            <MiniBar label="RAM" value={metrics.ram} />
            <p className="text-xs text-muted-foreground mt-2">
              Up {formatUptime(metrics.uptime)}
            </p>
          </>
        ) : online === false ? (
          <p className="text-xs text-destructive">Offline</p>
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

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
