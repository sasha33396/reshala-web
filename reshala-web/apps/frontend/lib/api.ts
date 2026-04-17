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
export const fetchFleet = () => req<FleetGroup[]>('/fleet')
export const fetchServer = (name: string) => req<Server>(`/fleet/${name}`)
export const createServer = (data: Omit<Server, 'status' | 'country'>) =>
  req<{ ok: boolean }>('/fleet', { method: 'POST', body: JSON.stringify(data) })
export const updateServer = (name: string, data: Partial<Server>) =>
  req<Server>(`/fleet/${name}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteServer = (name: string) =>
  req<{ ok: boolean }>(`/fleet/${name}`, { method: 'DELETE' })

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
