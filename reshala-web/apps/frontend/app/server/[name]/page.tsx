'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchServer, fetchMetrics, provisionServer } from '@/lib/api'
import { MetricsChart } from '@/components/metrics-chart'
import { PluginRunner } from '@/components/plugin-runner'
import { StatusIndicator } from '@/components/status-indicator'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface Props {
  params: { name: string }
}

export default function ServerPage({ params }: Props) {
  const { name } = params
  const [provisioning, setProvisioning] = useState(false)
  const [provisionResult, setProvisionResult] = useState<string | null>(null)

  async function handleProvision() {
    setProvisioning(true)
    setProvisionResult(null)
    try {
      const res = await provisionServer(name)
      setProvisionResult(res.ok ? 'Key deployed successfully' : `Failed: ${res.error}`)
    } catch (e: any) {
      setProvisionResult(`Error: ${e?.message}`)
    } finally {
      setProvisioning(false)
    }
  }

  const { data: server } = useQuery({
    queryKey: ['server', name],
    queryFn: () => fetchServer(name),
  })

  const { data: metrics } = useQuery({
    queryKey: ['metrics', name],
    queryFn: () => fetchMetrics(name),
    refetchInterval: 30_000,
    enabled: !!server,
  })

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">
          ← Fleet
        </Link>
        <h1 className="font-bold text-lg">{name}</h1>
        {metrics && (
          <StatusIndicator online={metrics.cpu !== undefined} size="md" />
        )}
      </header>

      <div className="p-6 max-w-screen-xl mx-auto space-y-6">
        {/* Quick stats */}
        {metrics && metrics.cpu !== undefined && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="CPU" value={`${metrics.cpu.toFixed(1)}%`} />
            <StatCard label="RAM" value={`${metrics.ram.toFixed(1)}%`} />
            <StatCard label="Disk" value={`${metrics.disk.toFixed(1)}%`} />
            <StatCard label="Uptime" value={formatUptime(metrics.uptime)} />
          </div>
        )}

        {metrics?.speedtestDown !== undefined && (
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Speedtest ↓" value={`${metrics.speedtestDown?.toFixed(1)} Mbps`} />
            <StatCard label="Speedtest ↑" value={`${metrics.speedtestUp?.toFixed(1)} Mbps`} />
          </div>
        )}

        {/* Charts */}
        <Card>
          <CardHeader>
            <CardTitle>Metrics (last 30 min)</CardTitle>
          </CardHeader>
          <CardContent>
            <MetricsChart serverName={name} />
          </CardContent>
        </Card>

        {/* Plugins */}
        <Card>
          <CardHeader>
            <CardTitle>Plugins</CardTitle>
          </CardHeader>
          <CardContent>
            <PluginRunner serverName={name} />
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3 flex-wrap items-center">
            <Link href={`/server/${name}/terminal`}>
              <Button variant="outline">SSH Terminal</Button>
            </Link>
            <Link href={`/server/${name}/docker`}>
              <Button variant="outline">Docker</Button>
            </Link>
            <Link href={`/server/${name}/security`}>
              <Button variant="outline">Security</Button>
            </Link>
            <Link href={`/server/${name}/remnawave`}>
              <Button variant="outline">Remnawave</Button>
            </Link>
            <Link href={`/wizard/node-setup?server=${name}`}>
              <Button variant="outline">Setup Node</Button>
            </Link>
            <Button variant="outline" onClick={handleProvision} disabled={provisioning}>
              {provisioning ? 'Provisioning…' : 'Provision SSH Key'}
            </Button>
            {provisionResult && (
              <span className={`text-sm ${provisionResult.startsWith('Key') ? 'text-green-500' : 'text-red-500'}`}>
                {provisionResult}
              </span>
            )}
          </CardContent>
        </Card>

        {/* Server info */}
        {server && (
          <Card>
            <CardHeader>
              <CardTitle>Connection info</CardTitle>
            </CardHeader>
            <CardContent className="text-sm font-mono space-y-1 text-muted-foreground">
              <p>IP: {server.ip}</p>
              <p>Port: {server.port}</p>
              <p>User: {server.user}</p>
              <p>Key: {server.keyPath}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  )
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${Math.floor((s % 3600) / 60)}m`
}
