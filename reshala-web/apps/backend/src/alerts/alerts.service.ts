import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { FleetService } from '../fleet/fleet.service'
import { MetricsService } from '../metrics/metrics.service'

export interface AlertsConfig {
  enabled: boolean
  telegramBotToken: string
  telegramChatId: string
  checkIntervalMinutes: number
  cooldownMinutes: number
  thresholds: {
    cpuPercent: number
    ramPercent: number
    diskPercent: number
    offlineCheck: boolean
  }
}

export interface AlertRecord {
  id: string
  serverName: string
  metric: string
  value: number
  threshold: number
  message: string
  firedAt: string
}

const DEFAULT_CONFIG: AlertsConfig = {
  enabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  checkIntervalMinutes: 5,
  cooldownMinutes: 30,
  thresholds: {
    cpuPercent: 90,
    ramPercent: 90,
    diskPercent: 90,
    offlineCheck: true,
  },
}

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsService.name)
  private timer: NodeJS.Timeout | null = null
  private history: AlertRecord[] = []
  // key: `${serverName}:${metric}` → timestamp of last alert
  private lastFired = new Map<string, number>()

  constructor(
    private readonly fleet: FleetService,
    private readonly metrics: MetricsService,
  ) {}

  private get dataDir(): string {
    return process.env.DATA_DIR ?? '/app/data'
  }

  private get configPath(): string {
    return path.join(this.dataDir, 'alerts.json')
  }

  private get historyPath(): string {
    return path.join(this.dataDir, 'alerts_history.json')
  }

  onModuleInit() {
    this.ensureDataDir()
    this.history = this.loadHistory()
    this.scheduleCheck()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
  }

  getConfig(): AlertsConfig {
    if (!fs.existsSync(this.configPath)) return { ...DEFAULT_CONFIG }
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  saveConfig(config: AlertsConfig): void {
    this.ensureDataDir()
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
    this.scheduleCheck()
  }

  getHistory(): AlertRecord[] {
    return [...this.history].reverse()
  }

  private loadHistory(): AlertRecord[] {
    if (!fs.existsSync(this.historyPath)) return []
    try {
      return JSON.parse(fs.readFileSync(this.historyPath, 'utf-8'))
    } catch {
      return []
    }
  }

  private saveHistory() {
    this.ensureDataDir()
    fs.writeFileSync(this.historyPath, JSON.stringify(this.history.slice(-500), null, 2), 'utf-8')
  }

  private scheduleCheck() {
    if (this.timer) clearInterval(this.timer)
    const config = this.getConfig()
    if (!config.enabled) return
    const intervalMs = config.checkIntervalMinutes * 60 * 1000
    this.timer = setInterval(() => this.runCheck(), intervalMs)
    this.logger.log(`Alerts check scheduled every ${config.checkIntervalMinutes} min`)
  }

  async runCheck(): Promise<{ checked: number; fired: number; errors: string[] }> {
    const config = this.getConfig()
    const servers = this.fleet.getAll()
    let fired = 0
    const errors: string[] = []

    await Promise.all(
      servers.map(async (server) => {
        try {
          const m = await this.metrics.getServerMetrics(server.ip)

          const checks: Array<{ metric: string; value: number; threshold: number; label: string }> = [
            { metric: 'cpu', value: m.cpu, threshold: config.thresholds.cpuPercent, label: 'CPU' },
            { metric: 'ram', value: m.ram, threshold: config.thresholds.ramPercent, label: 'RAM' },
            { metric: 'disk', value: m.disk, threshold: config.thresholds.diskPercent, label: 'Disk' },
          ]

          for (const { metric, value, threshold, label } of checks) {
            if (value < threshold) continue
            const key = `${server.name}:${metric}`
            const now = Date.now()
            const last = this.lastFired.get(key) ?? 0
            if (now - last < config.cooldownMinutes * 60 * 1000) continue

            const msg = `⚠️ [${server.name}] ${label} is ${value.toFixed(1)}% (>${threshold}%)\nIP: ${server.ip}`
            await this.fireAlert(server.name, metric, value, threshold, msg, config)
            this.lastFired.set(key, now)
            fired++
          }

          // Offline check: if all metrics are 0 and we have metrics, consider offline
          if (config.thresholds.offlineCheck && m.cpu === 0 && m.ram === 0 && m.uptime === 0) {
            const key = `${server.name}:offline`
            const now = Date.now()
            const last = this.lastFired.get(key) ?? 0
            if (now - last >= config.cooldownMinutes * 60 * 1000) {
              const msg = `🔴 [${server.name}] appears OFFLINE (no metrics)\nIP: ${server.ip}`
              await this.fireAlert(server.name, 'offline', 0, 0, msg, config)
              this.lastFired.set(key, now)
              fired++
            }
          }
        } catch (e: any) {
          errors.push(`${server.name}: ${e?.message ?? 'unknown'}`)
        }
      }),
    )

    return { checked: servers.length, fired, errors }
  }

  private async fireAlert(
    serverName: string,
    metric: string,
    value: number,
    threshold: number,
    message: string,
    config: AlertsConfig,
  ) {
    const record: AlertRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      serverName,
      metric,
      value,
      threshold,
      message,
      firedAt: new Date().toISOString(),
    }
    this.history.push(record)
    if (this.history.length > 500) this.history = this.history.slice(-500)
    this.saveHistory()

    if (config.telegramBotToken && config.telegramChatId) {
      await this.sendTelegram(config.telegramBotToken, config.telegramChatId, message)
    }
  }

  async sendTestNotification(): Promise<{ ok: boolean; error?: string }> {
    const config = this.getConfig()
    if (!config.telegramBotToken || !config.telegramChatId) {
      return { ok: false, error: 'Telegram not configured' }
    }
    try {
      await this.sendTelegram(
        config.telegramBotToken,
        config.telegramChatId,
        '✅ Reshala Alerts test notification — everything is working!',
      )
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message }
    }
  }

  private async sendTelegram(token: string, chatId: string, text: string): Promise<void> {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }, { timeout: 10000 })
  }

  clearHistory(): void {
    this.history = []
    this.saveHistory()
  }
}
