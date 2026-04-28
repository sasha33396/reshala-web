import type { Server, FleetGroup, Plugin, MetricData } from '@reshala-web/shared'

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Auth
export const login = (password: string) =>
  req<{ ok: boolean }>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) })

export const logout = () =>
  req<{ ok: boolean }>('/auth/logout', { method: 'POST', body: '{}' })

// Fleet
export const fetchFleet = (groupBy?: 'country' | 'provider') =>
  req<FleetGroup[]>(groupBy === 'provider' ? '/fleet?groupBy=provider' : '/fleet')
export const fetchServer = (name: string) => req<Server>(`/fleet/${name}`)
export const createServer = (data: Omit<Server, 'status' | 'country'>) =>
  req<{ ok: boolean }>('/fleet', { method: 'POST', body: JSON.stringify(data) })
export const updateServer = (name: string, data: Partial<Server>) =>
  req<Server>(`/fleet/${name}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteServer = (name: string) =>
  req<{ ok: boolean }>(`/fleet/${name}`, { method: 'DELETE' })
export const provisionServer = (name: string) =>
  req<{ ok: boolean; error?: string }>(`/fleet/${name}/provision`, { method: 'POST' })
export const provisionAll = () =>
  req<{ total: number; ok: number; failed: number; errors: string[] }>('/fleet/provision-all', { method: 'POST', body: '{}' })
export const fetchProvisionProgress = () =>
  req<{ running: boolean; total: number; done: number; ok: number; failed: number; errors: string[] }>('/fleet/provision-progress')
export const addServerByPassword = (data: { name: string; ip: string; password: string; user?: string; port?: number }) =>
  req<{ ok: boolean; error?: string }>('/fleet/add-by-password', { method: 'POST', body: JSON.stringify(data) })
export const bulkSsh = (serverNames: string[], command: string) =>
  req<Array<{ name: string; ok: boolean; output: string }>>('/fleet/bulk-ssh', {
    method: 'POST',
    body: JSON.stringify({ serverNames, command }),
  })
export const readCert = (serverName: string, sniDomain: string) =>
  req<{ crt: string | null; key: string | null; json: string | null }>(
    `/fleet/read-cert?serverName=${encodeURIComponent(serverName)}&sniDomain=${encodeURIComponent(sniDomain)}`,
  )

export async function importFleet(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${BASE}/fleet/import`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ added: number; skipped: number; errors: string[] }>
}

// Plugins
export const fetchPlugins = () => req<Plugin[]>('/plugins')

// Metrics
export const fetchMetrics = (name: string) => req<MetricData>(`/metrics/${name}`)
export const fetchMetricsHistory = (name: string, minutes = 30) =>
  req<Record<string, { ts: number; value: number }[]>>(`/metrics/${name}/history?minutes=${minutes}`)
export const fetchFleetStatus = () => req<Record<string, boolean>>('/metrics/fleet/status')

// Docker
import type { DockerContainer, PanelNode } from '@reshala-web/shared'
export const fetchDockerContainers = (name: string) => req<DockerContainer[]>(`/docker/${name}/containers`)
export const dockerControl = (name: string, id: string, action: 'start' | 'stop' | 'restart') =>
  req<string>(`/docker/${name}/containers/${id}/${action}`, { method: 'POST' })
export const dockerPrune = (name: string, type: 'images' | 'system') =>
  req<string>(`/docker/${name}/prune/${type}`, { method: 'POST' })
export const updateRemnanode = (name: string) =>
  req<{ ok: boolean; output: string }>(`/docker/${name}/remnanode/update`, { method: 'POST' })

// Remnawave Panel
export const fetchPanelNodes = () => req<PanelNode[]>('/remnawave/nodes')
export const fetchPanelStatus = () => req<{ configured: boolean }>('/remnawave/status')

// Analytics
export const fetchFleetAnalytics = () => req<any>('/metrics/fleet/analytics')

// Alerts
export const fetchAlertsConfig = () => req<any>('/alerts/config')
export const saveAlertsConfig = (config: any) =>
  req<{ ok: boolean }>('/alerts/config', { method: 'PUT', body: JSON.stringify(config) })
export const sendTestAlert = () =>
  req<{ ok: boolean; error?: string }>('/alerts/test', { method: 'POST', body: '{}' })
export const runAlertCheck = () =>
  req<{ checked: number; fired: number; errors: string[] }>('/alerts/check', { method: 'POST', body: '{}' })
export const fetchAlertHistory = () => req<any[]>('/alerts/history')
export const clearAlertHistory = () =>
  req<{ ok: boolean }>('/alerts/history', { method: 'DELETE' })
