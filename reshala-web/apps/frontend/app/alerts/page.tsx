'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  fetchAlertsConfig, saveAlertsConfig, sendTestAlert,
  runAlertCheck, fetchAlertHistory, clearAlertHistory,
} from '@/lib/api'
import { useT, LangToggle } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const METRIC_COLORS: Record<string, string> = {
  cpu: 'bg-orange-900/40 text-orange-300',
  ram: 'bg-blue-900/40 text-blue-300',
  disk: 'bg-yellow-900/40 text-yellow-300',
  offline: 'bg-red-900/40 text-red-300',
}

export default function AlertsPage() {
  const qc = useQueryClient()
  const { t } = useT()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const { data: config, isLoading } = useQuery({
    queryKey: ['alerts-config'],
    queryFn: fetchAlertsConfig,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['alerts-history'],
    queryFn: fetchAlertHistory,
    refetchInterval: 30_000,
  })

  const [form, setForm] = useState<any>(null)
  const effectiveForm = form ?? config

  function setField(path: string, value: any) {
    setForm((prev: any) => {
      const base = prev ?? config ?? {}
      const updated = JSON.parse(JSON.stringify(base))
      const keys = path.split('.')
      let cur = updated
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]]
      cur[keys[keys.length - 1]] = value
      return updated
    })
  }

  async function handleSave() {
    if (!effectiveForm) return
    setSaving(true)
    setMsg(null)
    try {
      await saveAlertsConfig(effectiveForm)
      qc.invalidateQueries({ queryKey: ['alerts-config'] })
      setMsg({ text: t('common.saved'), ok: true })
    } catch (e: any) {
      setMsg({ text: e?.message ?? t('common.error'), ok: false })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!effectiveForm) return
    setTesting(true)
    setMsg(null)
    try {
      await saveAlertsConfig(effectiveForm)
      qc.invalidateQueries({ queryKey: ['alerts-config'] })
      const res = await sendTestAlert()
      setMsg({ text: res.ok ? 'Тестовое уведомление отправлено' : `Ошибка: ${res.error}`, ok: res.ok })
    } catch (e: any) {
      setMsg({ text: e?.message ?? t('common.error'), ok: false })
    } finally {
      setTesting(false)
    }
  }

  async function handleCheck() {
    setChecking(true)
    setMsg(null)
    try {
      const res = await runAlertCheck()
      setMsg({ text: `${t('alerts.checkDone')}: ${res.checked} ${t('alerts.serversChecked')}, ${res.fired} ${t('alerts.alertsFired')}`, ok: true })
      qc.invalidateQueries({ queryKey: ['alerts-history'] })
    } catch (e: any) {
      setMsg({ text: e?.message ?? t('common.error'), ok: false })
    } finally {
      setChecking(false)
    }
  }

  async function handleClear() {
    await clearAlertHistory()
    qc.invalidateQueries({ queryKey: ['alerts-history'] })
  }

  if (isLoading || !effectiveForm) {
    return (
      <main className="min-h-screen bg-background">
        <header className="border-b border-border px-6 py-3 flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">← Fleet</Link>
          <h1 className="font-bold text-lg">{t('alerts.title')}</h1>
        </header>
        <div className="p-6 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </main>
    )
  }

  const f = effectiveForm

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">← Fleet</Link>
          <h1 className="font-bold text-lg">{t('alerts.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <LangToggle />
          <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking}>
            {checking ? t('alerts.checking') : t('alerts.runCheck')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t('alerts.saving') : t('alerts.saveConfig')}
          </Button>
        </div>
      </header>

      <div className="p-6 max-w-screen-lg mx-auto space-y-6">
        {msg && (
          <div className={`text-sm px-4 py-2 rounded-lg border ${msg.ok ? 'border-green-600 text-green-400 bg-green-950/30' : 'border-red-600 text-red-400 bg-red-950/30'}`}>
            {msg.text}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>{t('alerts.status')}</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary"
                checked={f.enabled}
                onChange={(e) => setField('enabled', e.target.checked)}
              />
              <span className="text-sm font-medium">{t('alerts.enableAuto')}</span>
            </label>
            <span className="text-xs text-muted-foreground">
              {t('alerts.checkEvery')} {f.checkIntervalMinutes} {t('alerts.cooldown')} {f.cooldownMinutes} {t('alerts.min')}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('alerts.thresholds')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">{t('alerts.cpuAt')}</label>
                <Input type="number" min={50} max={100} value={f.thresholds.cpuPercent}
                  onChange={(e) => setField('thresholds.cpuPercent', parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('alerts.ramAt')}</label>
                <Input type="number" min={50} max={100} value={f.thresholds.ramPercent}
                  onChange={(e) => setField('thresholds.ramPercent', parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('alerts.diskAt')}</label>
                <Input type="number" min={50} max={100} value={f.thresholds.diskPercent}
                  onChange={(e) => setField('thresholds.diskPercent', parseInt(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">{t('alerts.interval')}</label>
                <Input type="number" min={1} max={60} value={f.checkIntervalMinutes}
                  onChange={(e) => setField('checkIntervalMinutes', parseInt(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('alerts.cooldownMin')}</label>
                <Input type="number" min={5} max={1440} value={f.cooldownMinutes}
                  onChange={(e) => setField('cooldownMinutes', parseInt(e.target.value))} />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary"
                checked={f.thresholds.offlineCheck}
                onChange={(e) => setField('thresholds.offlineCheck', e.target.checked)}
              />
              <span className="text-sm">{t('alerts.offlineCheck')}</span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('alerts.telegram')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">{t('alerts.botToken')}</label>
              <Input type="password" placeholder="123456789:AAF..." value={f.telegramBotToken}
                onChange={(e) => setField('telegramBotToken', e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('alerts.chatId')}</label>
              <Input placeholder="-100123456789 или 768263638" value={f.telegramChatId}
                onChange={(e) => setField('telegramChatId', e.target.value)} />
            </div>
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? t('alerts.sending') : t('alerts.sendTest')}
            </Button>
            <p className="text-xs text-muted-foreground">
              Для группы укажи ID вида -100..., для личных сообщений укажи ID админ-пользователя. Пользователь должен сначала открыть бота и нажать Start.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('alerts.historyCount')} ({history.length})</CardTitle>
            {history.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClear} className="text-muted-foreground">
                {t('alerts.clear')}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('alerts.noHistory')}</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {history.map((alert: any) => (
                  <div key={alert.id} className="flex items-start justify-between gap-3 text-sm py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${METRIC_COLORS[alert.metric] ?? 'bg-muted text-muted-foreground'}`}>
                        {alert.metric === 'offline' ? t('alerts.offline') : alert.metric.toUpperCase()}
                      </span>
                      <span className="font-medium truncate">{alert.serverName}</span>
                      <span className="text-muted-foreground">
                        {alert.metric !== 'offline' ? `${alert.value.toFixed(1)}% > ${alert.threshold}%` : ''}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(alert.firedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
