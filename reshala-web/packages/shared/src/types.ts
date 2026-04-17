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
  envVars?: Record<string, string>
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
