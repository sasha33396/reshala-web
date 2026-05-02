export interface Server {
  name: string
  user: string
  ip: string
  port: number
  keyPath: string
  sudoPass?: string
  status?: 'online' | 'offline' | 'checking'
  country?: string
}

export interface Plugin {
  id: string
  title: string
  category: string
  path: string
  hidden: boolean
}

export interface PluginRunPayload {
  pluginId: string
  serverName?: string
  serverNames?: string[]
  envVars?: Record<string, string>
  parallel?: boolean
  concurrency?: number
}

export interface MetricData {
  cpu: number
  ram: number
  disk: number
  uptime: number
  networkIn: number
  networkOut: number
  speedtestDown?: number
  speedtestUp?: number
}

export interface PluginOutputLine {
  type: 'stdout' | 'stderr' | 'exit'
  data: string
}

export interface FleetGroup {
  country: string
  servers: Server[]
}

export interface PanelNode {
  uuid: string
  name: string
  address: string
  port: number | null
  isConnected: boolean
  isDisabled: boolean
  isConnecting: boolean
  usersOnline: number
  trafficUsedBytes: number | null
  trafficLimitBytes: number | null
  lastStatusMessage: string | null
  countryCode: string
}

export interface PanelHost {
  uuid: string
  remark: string
  address: string
  port: number
  nodes: string[]
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
  created: string
}

export interface CloudflareNodeZone {
  domain: string
  name: string
  fqdn: string
  ttl: number
  proxied: boolean
  ips: string[]
}

export interface CloudflareNodeConfig {
  configured: boolean
  checkInterval: number | null
  domains: CloudflareNodeZone[]
}

export interface CloudflareNodeMatch extends CloudflareNodeZone {
  matchedIp: string
}
