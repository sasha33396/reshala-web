import { Injectable, Logger } from '@nestjs/common'
import type { PanelNode } from '@reshala-web/shared'

@Injectable()
export class RemnawaveService {
  private readonly logger = new Logger(RemnawaveService.name)

  private get baseUrl(): string {
    return (process.env.REMNAWAVE_URL ?? '').replace(/\/$/, '')
  }

  private get apiKey(): string {
    return process.env.REMNAWAVE_API_KEY ?? ''
  }

  get isConfigured(): boolean {
    return !!this.baseUrl && !!this.apiKey
  }

  async getRawNodes(): Promise<any> {
    if (!this.isConfigured) return { error: 'Not configured: REMNAWAVE_URL or REMNAWAVE_API_KEY missing' }
    try {
      const res = await fetch(`${this.baseUrl}/api/nodes`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      const text = await res.text()
      return { status: res.status, url: `${this.baseUrl}/api/nodes`, body: JSON.parse(text) }
    } catch (e: any) {
      return { error: e?.message }
    }
  }

  async getNodes(): Promise<PanelNode[]> {
    if (!this.isConfigured) return []
    try {
      const res = await fetch(`${this.baseUrl}/api/nodes`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        this.logger.warn(`Panel API returned ${res.status}`)
        return []
      }
      const data: any = await res.json()
      const nodes: any[] = Array.isArray(data) ? data : (data?.response ?? [])
      this.logger.log(`Panel nodes fetched: ${nodes.length}`)
      return nodes.map((n: any): PanelNode => ({
        uuid: n.uuid,
        name: n.name,
        address: n.address,
        port: n.port ?? null,
        isConnected: n.isConnected ?? false,
        isDisabled: n.isDisabled ?? false,
        isConnecting: n.isConnecting ?? false,
        usersOnline: n.usersOnline ?? 0,
        trafficUsedBytes: n.trafficUsedBytes ?? null,
        trafficLimitBytes: n.trafficLimitBytes ?? null,
        lastStatusMessage: n.lastStatusMessage ?? null,
        countryCode: n.countryCode ?? '',
      }))
    } catch (e: any) {
      this.logger.warn(`Failed to fetch panel nodes: ${e?.message}`)
      return []
    }
  }
}
