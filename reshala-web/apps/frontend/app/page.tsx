'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { fetchFleet, fetchFleetStatus, logout, addServerByPassword, provisionAll } from '@/lib/api'
import { useT, LangToggle } from '@/lib/i18n'
import { FleetGrid } from '@/components/fleet-grid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function HomePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', ip: '', password: '', user: 'root', port: '22' })
  const [adding, setAdding] = useState(false)
  const [addResult, setAddResult] = useState<string | null>(null)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionResult, setProvisionResult] = useState<{ total: number; ok: number; failed: number } | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    setAddResult(null)
    try {
      const res = await addServerByPassword({
        name: addForm.name,
        ip: addForm.ip,
        password: addForm.password,
        user: addForm.user || 'root',
        port: parseInt(addForm.port) || 22,
      })
      if (res.ok) {
        setAddResult(t('add.success'))
        setAddForm({ name: '', ip: '', password: '', user: 'root', port: '22' })
        queryClient.invalidateQueries({ queryKey: ['fleet'] })
        setTimeout(() => { setShowAdd(false); setAddResult(null) }, 1500)
      } else {
        setAddResult(res.error ?? t('common.error'))
      }
    } catch (e: any) {
      setAddResult(e?.message ?? t('common.error'))
    } finally {
      setAdding(false)
    }
  }

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['fleet'],
    queryFn: fetchFleet,
    refetchInterval: 30_000,
  })

  const { data: statusMap = {} } = useQuery({
    queryKey: ['fleet-status'],
    queryFn: fetchFleetStatus,
    refetchInterval: 30_000,
  })

  const filtered = search.trim()
    ? groups
        .map((g) => ({
          ...g,
          servers: g.servers.filter(
            (s) =>
              s.name.toLowerCase().includes(search.toLowerCase()) ||
              s.ip.includes(search),
          ),
        }))
        .filter((g) => g.servers.length > 0)
    : groups

  const totalOnline = Object.values(statusMap).filter(Boolean).length
  const totalServers = groups.reduce((n, g) => n + g.servers.length, 0)

  async function handleProvisionAll() {
    setProvisioning(true)
    setProvisionResult(null)
    try {
      const res = await provisionAll()
      setProvisionResult(res)
    } finally {
      setProvisioning(false)
    }
  }

  async function handleLogout() {
    await logout()
    router.push('/login')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">{t('fleet.title')}</h1>
          {!isLoading && (
            <span className="text-xs text-muted-foreground">
              {totalOnline}/{totalServers} {t('fleet.online')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="search"
            placeholder={t('fleet.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Button variant="outline" size="sm" onClick={() => { setShowAdd(true); setAddResult(null) }}>
            {t('fleet.addServer')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/analytics')}>
            {t('nav.analytics')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/alerts')}>
            {t('nav.alerts')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/bulk')}>
            {t('nav.bulkOps')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/import')}>
            {t('nav.import')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleProvisionAll}
            disabled={provisioning}
            title="Deploy SSH keys to all servers using stored passwords"
          >
            {provisioning ? '🔑 Provisioning…' : '🔑 Provision All'}
          </Button>
          <LangToggle />
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            {t('nav.logout')}
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-screen-2xl mx-auto">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <FleetGrid groups={filtered} statusMap={statusMap} />
        )}
      </div>

      {provisionResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setProvisionResult(null)}>
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm mx-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg">Provision All — Done</h2>
            <p className="text-sm text-muted-foreground">Total servers: {provisionResult.total}</p>
            <p className="text-sm text-green-400">✓ Keys deployed: {provisionResult.ok}</p>
            {provisionResult.failed > 0 && (
              <p className="text-sm text-yellow-400">⚠ Failed: {provisionResult.failed} (no password or unreachable)</p>
            )}
            <Button onClick={() => setProvisionResult(null)} className="w-full">Close</Button>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{t('add.title')}</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('add.name')}</label>
                <Input placeholder="de-0-myserver" value={addForm.name} onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('add.ip')}</label>
                <Input placeholder="1.2.3.4" value={addForm.ip} onChange={(e) => setAddForm(f => ({ ...f, ip: e.target.value }))} required />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">{t('add.user')}</label>
                  <Input value={addForm.user} onChange={(e) => setAddForm(f => ({ ...f, user: e.target.value }))} />
                </div>
                <div className="w-20">
                  <label className="text-xs text-muted-foreground">{t('add.port')}</label>
                  <Input value={addForm.port} onChange={(e) => setAddForm(f => ({ ...f, port: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('add.password')}</label>
                <Input type="password" placeholder="password" value={addForm.password} onChange={(e) => setAddForm(f => ({ ...f, password: e.target.value }))} required />
              </div>
              {addResult && (
                <p className={`text-sm ${addResult === t('add.success') ? 'text-green-500' : 'text-red-500'}`}>{addResult}</p>
              )}
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={adding} className="flex-1">
                  {adding ? t('add.submitting') : t('add.submit')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>{t('add.cancel')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
