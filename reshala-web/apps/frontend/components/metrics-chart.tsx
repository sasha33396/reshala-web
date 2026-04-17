'use client'

import { useQuery } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { fetchMetricsHistory } from '@/lib/api'

interface Props {
  serverName: string
}

export function MetricsChart({ serverName }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics-history', serverName],
    queryFn: () => fetchMetricsHistory(serverName, 30),
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return <div className="h-64 bg-muted rounded animate-pulse" />
  }

  if (!data) return null

  const series = data.cpu ?? []
  const chartData = series.map((point, i) => ({
    time: new Date(point.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    cpu: data.cpu?.[i]?.value?.toFixed(1),
    ram: data.ram?.[i]?.value?.toFixed(1),
    disk: data.disk?.[i]?.value?.toFixed(1),
    netIn: ((data.networkIn?.[i]?.value ?? 0) / 1024 / 1024).toFixed(2),
    netOut: ((data.networkOut?.[i]?.value ?? 0) / 1024 / 1024).toFixed(2),
  }))

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-2">CPU / RAM / Disk (%)</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="cpu" stroke="#3b82f6" dot={false} name="CPU" />
            <Line type="monotone" dataKey="ram" stroke="#8b5cf6" dot={false} name="RAM" />
            <Line type="monotone" dataKey="disk" stroke="#f59e0b" dot={false} name="Disk" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="text-sm text-muted-foreground mb-2">Network (MB/s)</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit=" MB/s" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="netIn" stroke="#22c55e" dot={false} name="In" />
            <Line type="monotone" dataKey="netOut" stroke="#ef4444" dot={false} name="Out" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
