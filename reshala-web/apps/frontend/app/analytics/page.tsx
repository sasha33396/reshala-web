'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchFleetAnalytics } from '@/lib/api'
import { useT, LangToggle } from '@/lib/i18n'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function BarMeter({ value, warn = 80, crit = 90 }: { value: number; warn?: number; crit?: number }) {
  const color = value >= crit ? 'bg-red-500' : value >= warn ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs font-mono w-10 text-right">{value.toFixed(1)}%</span>
    </div>
  )
}

function StatBig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

function ServerRow({ rank, name, value, metric }: { rank: number; name: string; value: number; metric: 'cpu' | 'ram' | 'disk' }) {
  const router = useRouter()
  const warn = metric === 'disk' ? 75 : 80
  return (
    <div
      className="flex items-center gap-3 py-2 border-b border-border last:border-0 cursor-pointer hover:bg-muted/40 px-2 rounded"
      onClick={() => router.push(`/server/${name}`)}
    >
      <span className="text-xs text-muted-foreground w-5 text-right">{rank}</span>
      <span className="text-sm font-medium flex-1 truncate">{name}</span>
      <div className="w-40">
        <BarMeter value={value} warn={warn} />
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { t } = useT()
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['fleet-analytics'],
    queryFn: fetchFleetAnalytics,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">← Fleet</Link>
          <h1 className="font-bold text-lg">{t('analytics.title')}</h1>
          {data && (
            <span className="text-xs text-muted-foreground">
              {t('analytics.updated')} {new Date(data.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <LangToggle />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? t('analytics.refreshing') : t('analytics.refresh')}
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-screen-xl mx-auto space-y-6">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : !data ? (
          <p className="text-muted-foreground">{t('analytics.noData')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatBig
                label={t('analytics.total')}
                value={String(data.totalServers)}
                sub={data.serversWithMetrics != null ? `${data.serversWithMetrics} ${t('analytics.withMetrics')}` : undefined}
              />
              <StatBig label={t('analytics.avgCpu')} value={`${data.avgCpu.toFixed(1)}%`}
                sub={data.criticalCpu > 0 ? `${data.criticalCpu} ${t('analytics.needAttention')}` : t('analytics.allGood')} />
              <StatBig label={t('analytics.avgRam')} value={`${data.avgRam.toFixed(1)}%`}
                sub={data.criticalRam > 0 ? `${data.criticalRam} ${t('analytics.needAttention')}` : t('analytics.allGood')} />
              <StatBig label={t('analytics.avgDisk')} value={`${data.avgDisk.toFixed(1)}%`}
                sub={data.criticalDisk > 0 ? `${data.criticalDisk} ${t('analytics.almostFull')}` : t('analytics.allGood')} />
              <StatBig label={t('analytics.cpuCrit')} value={String(data.criticalCpu)} sub={t('analytics.needAttention')} />
              <StatBig label={t('analytics.diskCrit')} value={String(data.criticalDisk)} sub={t('analytics.almostFull')} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">{t('analytics.topCpu')}</CardTitle></CardHeader>
                <CardContent className="p-0 pb-2">
                  {data.topCpu.map((s: any, i: number) => (
                    <ServerRow key={s.name} rank={i + 1} name={s.name} value={s.cpu} metric="cpu" />
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">{t('analytics.topRam')}</CardTitle></CardHeader>
                <CardContent className="p-0 pb-2">
                  {data.topRam.map((s: any, i: number) => (
                    <ServerRow key={s.name} rank={i + 1} name={s.name} value={s.ram} metric="ram" />
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">{t('analytics.topDisk')}</CardTitle></CardHeader>
                <CardContent className="p-0 pb-2">
                  {data.topDisk.map((s: any, i: number) => (
                    <ServerRow key={s.name} rank={i + 1} name={s.name} value={s.disk} metric="disk" />
                  ))}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
