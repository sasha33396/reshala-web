import { BadRequestException, Injectable, Logger } from '@nestjs/common'

type RawZone = {
  name: string
  ttl?: number
  proxied?: boolean
  ips?: string[]
  nodes?: Array<{ ip: string; address?: string }>
}

type RawDomain = {
  domain: string
  zones?: RawZone[]
}

type RawConfig = {
  check_interval?: number
  remnawave?: { 'check-interval'?: number }
  domains?: RawDomain[]
  [key: string]: unknown
}

@Injectable()
export class CloudflareNodesService {
  private readonly logger = new Logger(CloudflareNodesService.name)

  private get baseUrl(): string {
    return (process.env.CF_NODES_API_URL ?? '').replace(/\/$/, '')
  }

  private get token(): string {
    return process.env.CF_NODES_API_TOKEN ?? ''
  }

  get isConfigured(): boolean {
    return !!this.baseUrl && !!this.token
  }

  async getConfig() {
    if (!this.isConfigured) return { configured: false, checkInterval: null, domains: [] }
    const config = await this.fetchConfig()
    return {
      configured: true,
      checkInterval: config.check_interval ?? config.remnawave?.['check-interval'] ?? null,
      domains: this.flattenDomains(config),
    }
  }

  async getMatchesForIp(ip: string) {
    if (!ip) throw new BadRequestException('ip required')
    const config = await this.getConfig()
    return {
      configured: config.configured,
      matches: config.domains
        .filter((zone) => zone.ips.includes(ip))
        .map((zone) => ({ ...zone, matchedIp: ip })),
      domains: config.domains,
    }
  }

  async addIp(domain: string, zoneName: string, ip: string) {
    this.validateInput(domain, zoneName, ip)
    const config = await this.fetchConfig()
    const domains = this.ensureDomains(config)
    const target = this.findDomainZone(domains, domain, zoneName)

    if (target) {
      const ips = this.zoneIps(target.zone)
      if (!ips.includes(ip)) this.setZoneIps(target.zone, [...ips, ip])
    } else {
      const entry = domains.find((item) => item.domain === domain)
      const zone = { name: zoneName, ttl: 60, proxied: false, nodes: [{ ip }] }
      if (entry) {
        entry.zones = [...(entry.zones ?? []), zone]
      } else {
        domains.push({ domain, zones: [zone] })
      }
    }

    await this.saveConfig(config)
    return this.getMatchesForIp(ip)
  }

  async removeIp(domain: string, zoneName: string, ip: string) {
    this.validateInput(domain, zoneName, ip)
    const config = await this.fetchConfig()
    const target = this.findDomainZone(this.ensureDomains(config), domain, zoneName)
    if (!target) return this.getMatchesForIp(ip)
    this.setZoneIps(target.zone, this.zoneIps(target.zone).filter((item) => item !== ip))
    await this.saveConfig(config)
    return this.getMatchesForIp(ip)
  }

  private async fetchConfig(): Promise<RawConfig> {
    if (!this.isConfigured) throw new BadRequestException('Cloudflare nodes API is not configured')
    const res = await fetch(`${this.baseUrl}/api/config`, {
      headers: { 'X-API-Key': this.token },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      this.logger.warn(`Cloudflare nodes API GET failed: ${res.status} ${text}`)
      throw new BadRequestException(`Cloudflare nodes API returned ${res.status}`)
    }
    return (await res.json()) as RawConfig
  }

  private async saveConfig(config: RawConfig): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.token },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      this.logger.warn(`Cloudflare nodes API PATCH failed: ${res.status} ${text}`)
      throw new BadRequestException(`Cloudflare nodes API save returned ${res.status}: ${this.formatApiError(text)}`)
    }
  }

  private ensureDomains(config: RawConfig): RawDomain[] {
    if (!Array.isArray(config.domains)) config.domains = []
    return config.domains
  }

  private findDomainZone(domains: RawDomain[], domain: string, zoneName: string) {
    for (const entry of domains) {
      if (entry.domain !== domain) continue
      for (const zone of entry.zones ?? []) {
        if (zone.name === zoneName) return { entry, zone }
      }
    }
    return null
  }

  private flattenDomains(config: RawConfig) {
    return this.ensureDomains(config).flatMap((entry) =>
      (entry.zones ?? []).map((zone) => ({
        domain: entry.domain,
        name: zone.name,
        fqdn: zone.name === '@' ? entry.domain : `${zone.name}.${entry.domain}`,
        ttl: zone.ttl ?? 60,
        proxied: zone.proxied ?? false,
        ips: this.zoneIps(zone),
      })),
    )
  }

  private zoneIps(zone: RawZone): string[] {
    if (Array.isArray(zone.ips)) return [...zone.ips]
    if (Array.isArray(zone.nodes)) return zone.nodes.map((node) => node.ip).filter(Boolean)
    return []
  }

  private setZoneIps(zone: RawZone, ips: string[]) {
    const uniqueIps = Array.from(new Set(ips.filter(Boolean)))
    if (Array.isArray(zone.nodes)) {
      const existing = new Map(zone.nodes.map((node) => [node.ip, node]))
      zone.nodes = uniqueIps.map((ip) => existing.get(ip) ?? { ip })
      delete zone.ips
      return
    }
    zone.ips = uniqueIps
  }

  private formatApiError(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return 'empty response'
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed
  }

  private validateInput(domain: string, zoneName: string, ip: string) {
    if (!domain || !zoneName || !ip) throw new BadRequestException('domain, zoneName and ip required')
  }
}
