'use client'

import Link from 'next/link'
import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PublicServer, PanelNode, PanelHost } from '@reshala-web/shared'
import { fetchMetrics } from '@/lib/api'
import { StatusIndicator } from './status-indicator'
import { Trash2 } from 'lucide-react'

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
  server: PublicServer
  online: boolean | null
  panelNode?: PanelNode | null
  panelHost?: PanelHost
  deleting?: boolean
  onDelete?: (name: string) => void
}

export function ServerCard({ server, online, panelNode, panelHost, deleting, onDelete }: Props) {
  const { data: metrics } = useQuery({
    queryKey: ['metrics', server.name],
    queryFn: () => fetchMetrics(server.name),
    enabled: online === true,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
  const { copied, copy } = useCopy()
  const noPanel = panelNode === null

  return (
    <Link href={`/server/${server.name}`}>
      <div className={`group h-full cursor-pointer select-none rounded-lg border bg-card p-4 transition-colors hover:border-primary/60 hover:bg-accent/30 ${noPanel ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-border'}`}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <span
            className="min-w-0 truncate pr-2 text-sm font-semibold transition-colors group-hover:text-primary"
            title="Нажми, чтобы скопировать"
            onClick={(e) => { e.preventDefault(); copy(server.name) }}
          >
            {copied === server.name ? 'скопировано' : server.name}
          </span>
          <div className="flex items-center gap-1.5">
            {panelNode !== undefined && (
              <PanelBadge node={panelNode ?? null} online={online} />
            )}
            <StatusIndicator online={online} />
            {onDelete && (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground opacity-70 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-40"
                title="Удалить из флота"
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDelete(server.name)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <p
          className="truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
          title="Нажми, чтобы скопировать"
          onClick={(e) => { e.preventDefault(); copy(server.ip) }}
        >
          {copied === server.ip ? 'скопировано' : server.ip}
        </p>
        {panelHost && (
          <p
            className="mb-3 truncate text-[11px] text-muted-foreground/70 transition-colors hover:text-primary/70"
            title={`${panelHost.remark} — нажми, чтобы скопировать`}
            onClick={(e) => { e.preventDefault(); copy(panelHost.address) }}
          >
            {copied === panelHost.address ? 'скопировано' : `${panelHost.address}:${panelHost.port}`}
          </p>
        )}
        {!panelHost && <p className={`mb-3 text-[11px] ${noPanel ? 'font-medium text-yellow-500' : 'text-muted-foreground/40'}`}>{noPanel ? 'Нет ноды в панели' : 'Нет хоста в панели'}</p>}
        {noPanel && onDelete && (
          <button
            type="button"
            className="mb-3 w-full rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-600 transition-colors hover:bg-yellow-500/20 disabled:pointer-events-none disabled:opacity-50"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onDelete(server.name)
            }}
          >
            {deleting ? 'Удаляем...' : 'Нет в панели - удалить'}
          </button>
        )}

        {online === false ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Офлайн
          </div>
        ) : metrics && (metrics.cpu > 0 || metrics.ram > 0 || metrics.uptime > 0) ? (
          <>
            <MiniBar label="CPU" value={metrics.cpu} />
            <MiniBar label="RAM" value={metrics.ram} />
            <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
              Аптайм {formatUptime(metrics.uptime)}
            </p>
          </>
        ) : metrics ? (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">Нет метрик</p>
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
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-500">нет в панели</span>
  )
  if (node.isDisabled) return (
    <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">выключена</span>
  )
  if (node.isConnecting) return (
    <span className="text-[10px] px-1 rounded bg-yellow-500/20 text-yellow-400">подключается...</span>
  )
  if (!node.isConnected) return (
    <span className="text-[10px] px-1 rounded bg-destructive/20 text-destructive">панель офлайн</span>
  )
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 tabular-nums flex items-center gap-1">
      <span>👤{node.usersOnline}</span>
      <span
        className={`w-1.5 h-1.5 rounded-full ${online === true ? 'bg-green-400' : online === false ? 'bg-red-400' : 'bg-muted-foreground/40'}`}
        title={online === true ? 'SSH доступен' : online === false ? 'Нет SSH-доступа' : 'SSH неизвестен'}
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
