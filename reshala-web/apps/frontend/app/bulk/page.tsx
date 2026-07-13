'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  bulkSsh,
  controlDockerContainersBulk,
  fetchFleet,
  fetchPlugins,
  scanDockerContainersBulk,
} from '@/lib/api'
import { createPluginsSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type {
  BulkDockerControlResult,
  BulkDockerScanResult,
  DockerContainer,
  FleetGroup,
  Plugin,
  PluginRunPayload,
  PublicServer,
} from '@reshala-web/shared'

type ServerStatus = 'pending' | 'running' | 'done' | 'error'
type SelectMode = 'all' | 'country' | 'custom'
type FilterMode = 'all' | ServerStatus
type Tab = 'docker' | 'plugins' | 'ufw'

interface ServerState {
  status: ServerStatus
  output: { type: string; data: string }[]
}

// ─── Shared server selector ───────────────────────────────────────────────────

function ServerSelector({
  groups,
  allServers,
  selectMode,
  setSelectMode,
  selectedCountry,
  setSelectedCountry,
  customSelected,
  setCustomSelected,
}: {
  groups: FleetGroup[]
  allServers: PublicServer[]
  selectMode: SelectMode
  setSelectMode: (m: SelectMode) => void
  selectedCountry: string
  setSelectedCountry: (c: string) => void
  customSelected: Set<string>
  setCustomSelected: (s: Set<string>) => void
}) {
  const [search, setSearch] = useState('')
  const targetServers =
    selectMode === 'all'
      ? allServers
      : selectMode === 'country'
      ? allServers.filter((s) => s.country === selectedCountry)
      : allServers.filter((s) => customSelected.has(s.name))

  function toggleCustom(name: string) {
    const next = new Set(customSelected)
    next.has(name) ? next.delete(name) : next.add(name)
    setCustomSelected(next)
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="font-semibold text-sm">Выбор серверов</p>
      <div className="flex gap-2 flex-wrap">
        {(['all', 'country', 'custom'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setSelectMode(mode)}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              selectMode === mode ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'
            }`}
          >
            {mode === 'all' ? `Все (${allServers.length})` : mode === 'country' ? 'По странам' : 'Вручную'}
          </button>
        ))}
      </div>

      {selectMode === 'country' && (
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button
              key={g.country}
              onClick={() => setSelectedCountry(g.country)}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                selectedCountry === g.country ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'
              }`}
            >
              {g.country} ({g.servers.length})
            </button>
          ))}
        </div>
      )}

      {selectMode === 'custom' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setCustomSelected(new Set(allServers.map((s) => s.name)))} className="text-xs text-primary hover:underline">
              Выбрать все
            </button>
            <button onClick={() => setCustomSelected(new Set())} className="text-xs text-muted-foreground hover:underline">
              Очистить
            </button>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти сервер..."
              className="h-8 ml-auto w-full sm:w-56"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 max-h-52 overflow-y-auto pr-1">
            {allServers.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.ip.includes(search)).map((s) => (
              <label key={s.name} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={customSelected.has(s.name)}
                  onChange={() => toggleCustom(s.name)}
                  className="w-3 h-3 accent-primary"
                />
                <span className="truncate">{s.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Выбрано серверов:</span>
        <Badge variant={targetServers.length > 0 ? 'default' : 'secondary'}>{targetServers.length}</Badge>
        {selectMode === 'country' && !selectedCountry && <span className="text-yellow-400">Выберите страну</span>}
      </div>
    </section>
  )
}

// ─── Docker tab ───────────────────────────────────────────────────────────────

type DockerAction = 'start' | 'stop' | 'restart'
type DockerStateFilter = 'all' | 'running' | 'stopped'
type DockerGroupMode = 'name' | 'image'

interface DockerInstance {
  key: string
  serverName: string
  container: DockerContainer
}

function containerIsRunning(container: DockerContainer) {
  return container.state.toLowerCase() === 'running'
}

function DockerTab({ groups, allServers }: { groups: FleetGroup[]; allServers: PublicServer[] }) {
  const [selectMode, setSelectMode] = useState<SelectMode>('all')
  const [selectedCountry, setSelectedCountry] = useState('')
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set())
  const [scanResults, setScanResults] = useState<BulkDockerScanResult[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<DockerStateFilter>('all')
  const [groupMode, setGroupMode] = useState<DockerGroupMode>('name')
  const [runningAction, setRunningAction] = useState<DockerAction | null>(null)
  const [actionResults, setActionResults] = useState<BulkDockerControlResult[] | null>(null)
  const [scannedServerNames, setScannedServerNames] = useState<string[]>([])

  const targetServers =
    selectMode === 'all'
      ? allServers
      : selectMode === 'country'
      ? allServers.filter((server) => server.country === selectedCountry)
      : allServers.filter((server) => customSelected.has(server.name))

  const currentScope = targetServers.map((server) => server.name).sort().join('\n')
  const scannedScope = [...scannedServerNames].sort().join('\n')
  const scanIsStale = scanResults !== null && currentScope !== scannedScope

  async function loadContainers(resetSelection = true) {
    if (scanning || targetServers.length === 0) return
    setScanning(true)
    setScanError(null)
    if (resetSelection) {
      setScanResults(null)
      setScannedServerNames([])
      setSelected(new Set())
      setActionResults(null)
      setExpanded(new Set())
    }
    try {
      const serverNames = targetServers.map((server) => server.name)
      setScanResults(await scanDockerContainersBulk(serverNames))
      setScannedServerNames(serverNames)
    } catch (error: any) {
      setScannedServerNames([])
      setScanError(error?.message ?? 'Не удалось получить Docker-контейнеры')
    } finally {
      setScanning(false)
    }
  }

  const successfulScans = scanResults?.filter((result) => result.ok) ?? []
  const failedScans = scanResults?.filter((result) => !result.ok) ?? []
  const allInstances: DockerInstance[] = successfulScans.flatMap((result) =>
    result.containers.map((container) => ({
      key: `${result.serverName}::${container.id}`,
      serverName: result.serverName,
      container,
    })),
  )

  const grouped = new Map<string, DockerInstance[]>()
  for (const instance of allInstances) {
    const key = groupMode === 'name' ? instance.container.name : instance.container.image
    const current = grouped.get(key) ?? []
    current.push(instance)
    grouped.set(key, current)
  }

  const dockerGroups = Array.from(grouped.entries())
    .map(([label, instances]) => ({ label, instances }))
    .filter((group) => {
      const needle = search.trim().toLowerCase()
      const matchesSearch = !needle || group.label.toLowerCase().includes(needle)
        || group.instances.some((instance) => instance.serverName.toLowerCase().includes(needle))
      const matchesState = stateFilter === 'all' || group.instances.some((instance) =>
        stateFilter === 'running' ? containerIsRunning(instance.container) : !containerIsRunning(instance.container),
      )
      return matchesSearch && matchesState
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  function instancesForCurrentFilter(instances: DockerInstance[]) {
    if (stateFilter === 'all') return instances
    return instances.filter((instance) =>
      stateFilter === 'running' ? containerIsRunning(instance.container) : !containerIsRunning(instance.container),
    )
  }

  function toggleInstance(key: string) {
    setSelected((previous) => {
      const next = new Set(previous)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleGroup(instances: DockerInstance[]) {
    const visible = instancesForCurrentFilter(instances)
    const allSelected = visible.length > 0 && visible.every((instance) => selected.has(instance.key))
    setSelected((previous) => {
      const next = new Set(previous)
      visible.forEach((instance) => allSelected ? next.delete(instance.key) : next.add(instance.key))
      return next
    })
  }

  function selectByState(mode: 'all' | 'running' | 'stopped') {
    setSelected(new Set(allInstances
      .filter((instance) => mode === 'all'
        || (mode === 'running' ? containerIsRunning(instance.container) : !containerIsRunning(instance.container)))
      .map((instance) => instance.key)))
  }

  async function runAction(action: DockerAction) {
    if (scanIsStale) return
    const targets = allInstances.filter((instance) => selected.has(instance.key))
    if (targets.length === 0 || runningAction) return
    const actionLabel = action === 'start' ? 'запустить' : action === 'stop' ? 'остановить' : 'перезапустить'
    if (!window.confirm(`${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} ${targets.length} контейнеров?`)) return

    setRunningAction(action)
    setActionResults(null)
    try {
      const results = await controlDockerContainersBulk(action, targets.map((instance) => ({
        serverName: instance.serverName,
        containerId: instance.container.id,
      })))
      setActionResults(results)
      setSelected(new Set())
      await loadContainers(false)
    } catch (error: any) {
      setScanError(error?.message ?? 'Не удалось выполнить массовую Docker-операцию')
    } finally {
      setRunningAction(null)
    }
  }

  const runningCount = allInstances.filter((instance) => containerIsRunning(instance.container)).length
  const stoppedCount = allInstances.length - runningCount
  const actionOk = actionResults?.filter((result) => result.ok).length ?? 0
  const actionFailed = actionResults?.filter((result) => !result.ok).length ?? 0

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-4">
        <p className="font-semibold">Массовое управление Docker</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Сначала выберите серверы и просканируйте их. Затем можно выбрать одинаковые контейнеры на всех нодах
          или отдельные экземпляры и запустить, остановить либо перезапустить их.
        </p>
      </div>

      <ServerSelector
        groups={groups}
        allServers={allServers}
        selectMode={selectMode}
        setSelectMode={setSelectMode}
        selectedCountry={selectedCountry}
        setSelectedCountry={setSelectedCountry}
        customSelected={customSelected}
        setCustomSelected={setCustomSelected}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={() => loadContainers()} disabled={scanning || targetServers.length === 0 || Boolean(runningAction)}>
          {scanning ? `Сканируем ${targetServers.length} серверов...` : `Проверить Docker на ${targetServers.length} серверах`}
        </Button>
        {scanResults && <span className="text-xs text-muted-foreground">Последняя проверка: {scanResults.length} серверов</span>}
        {(scanning || runningAction) && <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />}
      </div>

      {scanError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{scanError}</div>
      )}

      {scanResults && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox label="Серверы доступны" value={successfulScans.length} tone="green" />
            <StatBox label="Ошибки SSH/Docker" value={failedScans.length} tone={failedScans.length ? 'red' : 'muted'} />
            <StatBox label="Работают" value={runningCount} tone="green" />
            <StatBox label="Остановлены" value={stoppedCount} tone={stoppedCount ? 'yellow' : 'muted'} />
          </section>

          <section className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="min-w-52 flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">Поиск контейнера или сервера</label>
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="speedtest-exporter" />
              </div>
              <div className="w-44">
                <label className="mb-1 block text-xs text-muted-foreground">Группировать по</label>
                <Select value={groupMode} onChange={(event) => setGroupMode(event.target.value as DockerGroupMode)}>
                  <option value="name">Имени контейнера</option>
                  <option value="image">Docker image</option>
                </Select>
              </div>
              <div className="w-40">
                <label className="mb-1 block text-xs text-muted-foreground">Состояние</label>
                <Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as DockerStateFilter)}>
                  <option value="all">Все</option>
                  <option value="running">Работают</option>
                  <option value="stopped">Остановлены</option>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Быстрый выбор:</span>
              <button onClick={() => selectByState('all')} className="text-xs text-primary hover:underline">все ({allInstances.length})</button>
              <button onClick={() => selectByState('stopped')} className="text-xs text-yellow-400 hover:underline">остановленные ({stoppedCount})</button>
              <button onClick={() => selectByState('running')} className="text-xs text-green-400 hover:underline">работающие ({runningCount})</button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">очистить</button>
              <Badge variant="secondary" className="ml-auto">Выбрано: {selected.size}</Badge>
            </div>
          </section>

          <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
            <Button onClick={() => runAction('start')} disabled={selected.size === 0 || Boolean(runningAction) || scanIsStale}>
              {runningAction === 'start' ? 'Запускаем...' : '▶ Запустить'}
            </Button>
            <Button variant="outline" onClick={() => runAction('restart')} disabled={selected.size === 0 || Boolean(runningAction) || scanIsStale}>
              {runningAction === 'restart' ? 'Перезапускаем...' : '↻ Перезапустить'}
            </Button>
            <Button variant="destructive" onClick={() => runAction('stop')} disabled={selected.size === 0 || Boolean(runningAction) || scanIsStale}>
              {runningAction === 'stop' ? 'Останавливаем...' : '■ Остановить'}
            </Button>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:block">Действие применяется только к выбранным экземплярам</span>
          </div>

          {scanIsStale && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
              Список серверов изменился. Повторите проверку Docker перед выполнением операции.
            </div>
          )}

          {actionResults && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${actionFailed ? 'border-yellow-500/30 bg-yellow-500/10' : 'border-green-500/30 bg-green-500/10'}`}>
              <p>
                Массовая операция завершена: <span className="text-green-400">{actionOk} успешно</span>
                {actionFailed > 0 && <span className="ml-2 text-red-400">{actionFailed} с ошибкой</span>}
              </p>
              {actionFailed > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-red-300">Показать ошибки</summary>
                  <div className="mt-2 grid gap-1 text-xs">
                    {actionResults.filter((result) => !result.ok).map((result) => (
                      <p key={`${result.serverName}:${result.containerId}`}>
                        <b>{result.serverName}</b> · <span className="font-mono">{result.containerId}</span>: {result.output}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {failedScans.length > 0 && (
            <details className="rounded-lg border border-red-500/25 bg-red-500/5 p-3">
              <summary className="cursor-pointer text-sm text-red-300">Недоступные серверы ({failedScans.length})</summary>
              <div className="mt-2 grid gap-1 text-xs">
                {failedScans.map((result) => <p key={result.serverName}><b>{result.serverName}:</b> {result.error}</p>)}
              </div>
            </details>
          )}

          <section className="space-y-2">
            {dockerGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Контейнеры по текущему фильтру не найдены.
              </div>
            ) : dockerGroups.map((group) => {
              const visibleInstances = instancesForCurrentFilter(group.instances)
              const groupRunning = group.instances.filter((instance) => containerIsRunning(instance.container)).length
              const groupStopped = group.instances.length - groupRunning
              const serversWithContainer = new Set(group.instances.map((instance) => instance.serverName)).size
              const missing = Math.max(0, successfulScans.length - serversWithContainer)
              const allVisibleSelected = visibleInstances.length > 0 && visibleInstances.every((instance) => selected.has(instance.key))
              const isExpanded = expanded.has(group.label)
              return (
                <div key={group.label} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-3 p-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() => toggleGroup(group.instances)}
                      className="h-4 w-4 accent-primary"
                    />
                    <button
                      onClick={() => setExpanded((previous) => {
                        const next = new Set(previous)
                        next.has(group.label) ? next.delete(group.label) : next.add(group.label)
                        return next
                      })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate font-mono text-sm font-semibold">{group.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {groupMode === 'name' ? group.instances[0]?.container.image : `${serversWithContainer} серверов`}
                      </p>
                    </button>
                    <div className="hidden items-center gap-2 text-xs sm:flex">
                      <Badge variant="outline" className="text-green-400">● {groupRunning}</Badge>
                      <Badge variant="outline" className="text-yellow-400">■ {groupStopped}</Badge>
                      {missing > 0 && <Badge variant="secondary">нет на {missing}</Badge>}
                    </div>
                    <button
                      onClick={() => setExpanded((previous) => {
                        const next = new Set(previous)
                        next.has(group.label) ? next.delete(group.label) : next.add(group.label)
                        return next
                      })}
                      className="px-2 text-xs text-muted-foreground"
                    >{isExpanded ? '▲' : '▼'}</button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/10">
                      {visibleInstances.map((instance) => {
                        const running = containerIsRunning(instance.container)
                        return (
                          <label key={instance.key} className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/50 px-4 py-2 last:border-0 hover:bg-muted/30 md:grid-cols-[auto_1fr_1fr_auto]">
                            <input
                              type="checkbox"
                              checked={selected.has(instance.key)}
                              onChange={() => toggleInstance(instance.key)}
                              className="h-3.5 w-3.5 accent-primary"
                            />
                            <span className="truncate text-sm font-medium">{instance.serverName}</span>
                            <span className="hidden truncate font-mono text-xs text-muted-foreground md:block">{instance.container.name}</span>
                            <Badge variant="outline" className={running ? 'text-green-400' : 'text-yellow-400'}>
                              {running ? 'работает' : instance.container.state}
                            </Badge>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: 'green' | 'yellow' | 'red' | 'muted' }) {
  const colors = {
    green: 'border-green-500/25 bg-green-500/5 text-green-400',
    yellow: 'border-yellow-500/25 bg-yellow-500/5 text-yellow-400',
    red: 'border-red-500/25 bg-red-500/5 text-red-400',
    muted: 'border-border bg-card text-foreground',
  }
  return (
    <div className={`rounded-lg border p-3 ${colors[tone]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

// ─── UFW tab ──────────────────────────────────────────────────────────────────

const UFW_PRESETS = [
  { label: 'Разрешить SSH (22)', cmd: 'ufw allow 22/tcp' },
  { label: 'Разрешить HTTP (80)', cmd: 'ufw allow 80/tcp' },
  { label: 'Разрешить HTTPS (443)', cmd: 'ufw allow 443/tcp' },
  { label: 'Разрешить Node Exporter (9100)', cmd: 'ufw allow 9100/tcp' },
  { label: 'Разрешить 8080', cmd: 'ufw allow 8080/tcp' },
  { label: 'Разрешить 3000', cmd: 'ufw allow 3000/tcp' },
  { label: 'UFW Включить', cmd: 'echo y | ufw enable' },
  { label: 'UFW Статус', cmd: 'ufw status verbose' },
  { label: 'UFW Выключить', cmd: 'ufw disable' },
  { label: 'UFW Сбросить', cmd: 'echo y | ufw reset' },
]

type UfwResult = { name: string; ok: boolean; output: string }

function UfwTab({ groups, allServers }: { groups: FleetGroup[]; allServers: PublicServer[] }) {
  const [selectMode, setSelectMode] = useState<SelectMode>('all')
  const [selectedCountry, setSelectedCountry] = useState('')
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set())
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<UfwResult[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'ok' | 'fail'>('all')
  const [expandedServer, setExpandedServer] = useState<string | null>(null)

  const targetServers =
    selectMode === 'all'
      ? allServers
      : selectMode === 'country'
      ? allServers.filter((s) => s.country === selectedCountry)
      : allServers.filter((s) => customSelected.has(s.name))

  async function run() {
    if (!command.trim() || running || targetServers.length === 0) return
    setRunning(true)
    setResults(null)
    setFilter('all')
    setExpandedServer(null)
    try {
      const res = await bulkSsh(targetServers.map((s) => s.name), command.trim())
      setResults(res)
    } finally {
      setRunning(false)
    }
  }

  const displayed = results
    ? results.filter((r) => filter === 'all' || (filter === 'ok' ? r.ok : !r.ok))
    : []

  const okCount = results?.filter((r) => r.ok).length ?? 0
  const failCount = results?.filter((r) => !r.ok).length ?? 0

  return (
    <div className="space-y-5">
      {/* Presets */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="font-semibold text-sm">1. Выбор команды</p>
        <div className="flex flex-wrap gap-2">
          {UFW_PRESETS.map((p) => (
            <button
              key={p.cmd}
              onClick={() => setCommand(p.cmd)}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                command === p.cmd ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Своя команда</p>
          <div className="flex gap-2">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="ufw allow 1234/tcp"
              className="flex-1 text-sm font-mono bg-background border border-border rounded px-3 py-2 focus:outline-none focus:border-primary"
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </div>
        </div>
      </section>

      {/* Server selector */}
      <ServerSelector
        groups={groups}
        allServers={allServers}
        selectMode={selectMode}
        setSelectMode={setSelectMode}
        selectedCountry={selectedCountry}
        setSelectedCountry={setSelectedCountry}
        customSelected={customSelected}
        setCustomSelected={setCustomSelected}
      />

      {/* Run */}
      <div className="flex items-center gap-3">
        <Button
          onClick={run}
          disabled={!command.trim() || running || targetServers.length === 0}
        >
          {running ? `Выполняется на ${targetServers.length} серверах...` : `Запустить на ${targetServers.length} серверах`}
        </Button>
        {command && <Badge variant="secondary" className="font-mono">{command}</Badge>}
        {running && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
      </div>

      {/* Results */}
      {results && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">Результаты: {results.length}</span>
            <span className="text-sm text-green-400">✓ {okCount} успешно</span>
            <span className="text-sm text-red-400">✗ {failCount} с ошибкой</span>
            <div className="flex gap-1.5 ml-auto">
              {(['all', 'ok', 'fail'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  {f === 'all' ? `Все (${results.length})` : f === 'ok' ? `Успешно (${okCount})` : `Ошибки (${failCount})`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            {displayed.map((r) => (
              <div key={r.name} className="border border-border rounded overflow-hidden">
                <button
                  onClick={() => setExpandedServer(expandedServer === r.name ? null : r.name)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 text-left transition-colors"
                >
                  <span className={`font-mono text-sm w-4 ${r.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {r.ok ? '✓' : '✗'}
                  </span>
                  <span className="text-sm font-medium flex-1">{r.name}</span>
                  {r.output && (
                    <span className="text-xs text-muted-foreground truncate max-w-xs hidden md:block">
                      {r.output.split('\n')[0]}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{expandedServer === r.name ? '▲' : '▼'}</span>
                </button>
                {expandedServer === r.name && r.output && (
                  <div className="bg-black px-3 py-2 max-h-48 overflow-y-auto font-mono text-xs border-t border-border whitespace-pre-wrap">
                    <span className={r.ok ? 'text-green-300' : 'text-red-400'}>{r.output}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Plugin tab (original) ────────────────────────────────────────────────────

function PluginsTab({ groups, allServers, plugins }: { groups: FleetGroup[]; allServers: PublicServer[]; plugins: Plugin[] }) {
  const [selectMode, setSelectMode] = useState<SelectMode>('all')
  const [selectedCountry, setSelectedCountry] = useState('')
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set())
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [running, setRunning] = useState(false)
  const [serverStates, setServerStates] = useState<Map<string, ServerState>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('all')
  const socketRef = useRef<ReturnType<typeof createPluginsSocket> | null>(null)

  useEffect(() => () => { socketRef.current?.disconnect() }, [])

  const targetServers =
    selectMode === 'all'
      ? allServers
      : selectMode === 'country'
      ? allServers.filter((s) => s.country === selectedCountry)
      : allServers.filter((s) => customSelected.has(s.name))

  function run() {
    if (!selectedPlugin || running || targetServers.length === 0) return
    const initial = new Map<string, ServerState>()
    targetServers.forEach((s) => initial.set(s.name, { status: 'pending', output: [] }))
    setServerStates(initial)
    setExpanded(new Set())
    setFilter('all')
    setRunning(true)

    const socket = createPluginsSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      const payload: PluginRunPayload = {
        pluginId: selectedPlugin.id,
        serverNames: targetServers.map((s) => s.name),
        parallel: true,
        concurrency: 10,
      }
      socket.emit('run', payload)
    })

    socket.on('server-start', ({ server }: { server: string }) =>
      setServerStates((prev) => { const next = new Map(prev); const cur = next.get(server); if (cur) next.set(server, { ...cur, status: 'running' }); return next }),
    )
    socket.on('output', ({ server, type, data }: { server: string; type: string; data: string }) =>
      setServerStates((prev) => { const next = new Map(prev); const cur = next.get(server); if (cur) next.set(server, { ...cur, output: [...cur.output, { type, data }] }); return next }),
    )
    socket.on('server-done', ({ server }: { server: string }) =>
      setServerStates((prev) => { const next = new Map(prev); const cur = next.get(server); if (cur) next.set(server, { ...cur, status: 'done' }); return next }),
    )
    socket.on('server-error', ({ server, error }: { server: string; error: string }) =>
      setServerStates((prev) => { const next = new Map(prev); const cur = next.get(server); if (cur) next.set(server, { ...cur, status: 'error', output: [...cur.output, { type: 'stderr', data: error }] }); return next }),
    )
    socket.on('done', () => { setRunning(false); socket.disconnect() })
    socket.on('error', () => setRunning(false))
    socket.connect()
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next })
  }

  const categories = [...new Set(plugins.filter((p) => !p.hidden).map((p) => p.category))]
  const states = Array.from(serverStates.values())
  const counts = {
    pending: states.filter((s) => s.status === 'pending').length,
    running: states.filter((s) => s.status === 'running').length,
    done: states.filter((s) => s.status === 'done').length,
    error: states.filter((s) => s.status === 'error').length,
    total: serverStates.size,
  }
  const finished = counts.done + counts.error
  const progress = counts.total > 0 ? Math.round((finished / counts.total) * 100) : 0
  const displayedStates = Array.from(serverStates.entries()).filter(([, s]) => filter === 'all' || s.status === filter)
  const isSpeedtestPlugin = selectedPlugin?.id.includes('speedtest') || selectedPlugin?.title.toLowerCase().includes('speedtest')
  const showSpeedtestWarning = isSpeedtestPlugin && targetServers.length > 5

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="font-semibold text-sm">1. Выбор плагина</p>
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-xs uppercase text-muted-foreground mb-1">{cat}</p>
            <div className="flex flex-wrap gap-2">
              {plugins.filter((p) => p.category === cat && !p.hidden).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlugin(p)}
                  className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                    selectedPlugin?.id === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'
                  }`}
                >
                  {p.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <ServerSelector
        groups={groups}
        allServers={allServers}
        selectMode={selectMode}
        setSelectMode={setSelectMode}
        selectedCountry={selectedCountry}
        setSelectedCountry={setSelectedCountry}
        customSelected={customSelected}
        setCustomSelected={setCustomSelected}
      />

      {showSpeedtestWarning && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          Speedtest создаёт реальную нагрузку на сеть. Не рекомендуется запускать его более чем на 5 серверах одновременно.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={run} disabled={!selectedPlugin || running || targetServers.length === 0}>
          {running ? `Выполняется... ${finished}/${counts.total}` : `Запустить на ${targetServers.length} серверах`}
        </Button>
        {selectedPlugin && <Badge variant="secondary">{selectedPlugin.title}</Badge>}
        {running && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
      </div>

      {serverStates.size > 0 && (
        <section className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted-foreground font-mono">{progress}%</span>
              {counts.running > 0 && <span className="text-yellow-400">{counts.running} выполняется</span>}
              {counts.done > 0 && <span className="text-green-400">{counts.done} готово</span>}
              {counts.error > 0 && <span className="text-red-400">{counts.error} ошибок</span>}
              {counts.pending > 0 && <span className="text-muted-foreground">{counts.pending} в очереди</span>}
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {([
              ['all', 'все'],
              ['pending', 'в очереди'],
              ['running', 'выполняется'],
              ['done', 'готово'],
              ['error', 'ошибки'],
            ] as const).map(([f, label]) => {
              const cnt = f === 'all' ? counts.total : counts[f as keyof typeof counts]
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  {label} {cnt > 0 && `(${cnt})`}
                </button>
              )
            })}
          </div>
          <div className="space-y-1">
            {displayedStates.map(([name, state]) => (
              <PluginServerCard key={name} name={name} state={state} expanded={expanded.has(name)} onToggle={() => toggleExpand(name)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PluginServerCard({ name, state, expanded, onToggle }: { name: string; state: ServerState; expanded: boolean; onToggle: () => void }) {
  const outputRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [state.output.length, expanded])

  const { icon, color } = { pending: { icon: '○', color: 'text-muted-foreground' }, running: { icon: '▶', color: 'text-yellow-400' }, done: { icon: '✓', color: 'text-green-400' }, error: { icon: '✗', color: 'text-red-400' } }[state.status]

  return (
    <div className="border border-border rounded overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 text-left transition-colors">
        <span className={`font-mono text-sm w-4 ${color}`}>{icon}</span>
        <span className="text-sm font-medium flex-1">{name}</span>
        {state.output.length > 0 && <span className="text-xs text-muted-foreground">{state.output.length} строк</span>}
        <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div ref={outputRef} className="bg-black px-3 py-2 max-h-52 overflow-y-auto font-mono text-xs border-t border-border">
          {state.output.length === 0 ? <span className="text-muted-foreground">Ожидаем...</span> : state.output.map((line, i) => (
            <div key={i} className={line.type === 'stderr' ? 'text-red-400' : 'text-green-300'}>{line.data}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BulkPage() {
  const { data: groups = [] } = useQuery({ queryKey: ['fleet'], queryFn: () => fetchFleet() })
  const { data: plugins = [] } = useQuery({ queryKey: ['plugins'], queryFn: fetchPlugins })
  const [tab, setTab] = useState<Tab>('docker')
  const allServers = groups.flatMap((group) => group.servers)

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">← Флот</Link>
          <div className="mr-auto">
            <h1 className="font-bold text-lg">Массовые операции</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Управление выбранными серверами из одного экрана</p>
          </div>
          <div className="flex w-full gap-1 overflow-x-auto sm:w-auto">
          {([['docker', '🐳 Docker'], ['ufw', '🛡 UFW'], ['plugins', '⚡ Плагины']] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-3 py-1.5 text-sm rounded border transition-colors ${
                tab === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {label}
            </button>
          ))}
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
        {tab === 'docker' && <DockerTab groups={groups} allServers={allServers} />}
        {tab === 'ufw' && <UfwTab groups={groups} allServers={allServers} />}
        {tab === 'plugins' && <PluginsTab groups={groups} allServers={allServers} plugins={plugins} />}
      </div>
    </main>
  )
}
