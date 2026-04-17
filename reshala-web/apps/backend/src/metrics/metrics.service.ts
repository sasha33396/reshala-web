import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import * as net from 'net'
import type { MetricData } from '@reshala-web/shared'

interface PromResult {
  metric: Record<string, string>
  value: [number, string]
}

interface PromRangeResult {
  metric: Record<string, string>
  values: [number, string][]
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name)

  private get prometheusUrl(): string {
    return process.env.PROMETHEUS_URL ?? 'http://localhost:9090'
  }

  private async query(expr: string): Promise<PromResult[]> {
    try {
      const res = await axios.get(`${this.prometheusUrl}/api/v1/query`, {
        params: { query: expr },
        timeout: 5000,
      })
      return res.data?.data?.result ?? []
    } catch (err: any) {
      this.logger.warn(`Prometheus query failed: ${err.message}`)
      return []
    }
  }

  private async queryRange(
    expr: string,
    startSec: number,
    endSec: number,
    step: string,
  ): Promise<PromRangeResult[]> {
    try {
      const res = await axios.get(`${this.prometheusUrl}/api/v1/query_range`, {
        params: { query: expr, start: startSec, end: endSec, step },
        timeout: 8000,
      })
      return res.data?.data?.result ?? []
    } catch (err: any) {
      this.logger.warn(`Prometheus range query failed: ${err.message}`)
      return []
    }
  }

  private firstValue(results: PromResult[]): number {
    return parseFloat(results[0]?.value?.[1] ?? '0') || 0
  }

  async getServerMetrics(ip: string): Promise<MetricData> {
    const inst = `${ip}:.*`
    const [cpu, ram, disk, uptime, netIn, netOut, spdDown, spdUp] = await Promise.all([
      this.query(
        `100 - avg(rate(node_cpu_seconds_total{mode="idle",instance=~"${inst}"}[5m])) * 100`,
      ),
      this.query(
        `(1 - node_memory_MemAvailable_bytes{instance=~"${inst}"} / node_memory_MemTotal_bytes{instance=~"${inst}"}) * 100`,
      ),
      this.query(
        `(1 - node_filesystem_avail_bytes{mountpoint="/",instance=~"${inst}"} / node_filesystem_size_bytes{mountpoint="/",instance=~"${inst}"}) * 100`,
      ),
      this.query(
        `node_time_seconds{instance=~"${inst}"} - node_boot_time_seconds{instance=~"${inst}"}`,
      ),
      this.query(`rate(node_network_receive_bytes_total{instance=~"${inst}"}[5m])`),
      this.query(`rate(node_network_transmit_bytes_total{instance=~"${inst}"}[5m])`),
      this.query(`speedtest_download_mbps{instance=~"${inst}"}`),
      this.query(`speedtest_upload_mbps{instance=~"${inst}"}`),
    ])

    return {
      cpu: this.firstValue(cpu),
      ram: this.firstValue(ram),
      disk: this.firstValue(disk),
      uptime: this.firstValue(uptime),
      networkIn: this.firstValue(netIn),
      networkOut: this.firstValue(netOut),
      speedtestDown: spdDown.length ? this.firstValue(spdDown) : undefined,
      speedtestUp: spdUp.length ? this.firstValue(spdUp) : undefined,
    }
  }

  async getServerMetricsHistory(
    ip: string,
    minutes = 30,
  ): Promise<Record<string, { ts: number; value: number }[]>> {
    const now = Math.floor(Date.now() / 1000)
    const start = now - minutes * 60
    const step = minutes <= 30 ? '60' : '300'
    const inst = `${ip}:.*`

    const toSeries = (results: PromRangeResult[]) =>
      (results[0]?.values ?? []).map(([ts, val]) => ({ ts, value: parseFloat(val) || 0 }))

    const [cpu, ram, disk, netIn, netOut] = await Promise.all([
      this.queryRange(
        `100 - avg(rate(node_cpu_seconds_total{mode="idle",instance=~"${inst}"}[5m])) * 100`,
        start,
        now,
        step,
      ),
      this.queryRange(
        `(1 - node_memory_MemAvailable_bytes{instance=~"${inst}"} / node_memory_MemTotal_bytes{instance=~"${inst}"}) * 100`,
        start,
        now,
        step,
      ),
      this.queryRange(
        `(1 - node_filesystem_avail_bytes{mountpoint="/",instance=~"${inst}"} / node_filesystem_size_bytes{mountpoint="/",instance=~"${inst}"}) * 100`,
        start,
        now,
        step,
      ),
      this.queryRange(
        `rate(node_network_receive_bytes_total{instance=~"${inst}"}[5m])`,
        start,
        now,
        step,
      ),
      this.queryRange(
        `rate(node_network_transmit_bytes_total{instance=~"${inst}"}[5m])`,
        start,
        now,
        step,
      ),
    ])

    return {
      cpu: toSeries(cpu),
      ram: toSeries(ram),
      disk: toSeries(disk),
      networkIn: toSeries(netIn),
      networkOut: toSeries(netOut),
    }
  }

  async getSpeedtest(ip: string): Promise<{ down: number; up: number } | null> {
    const inst = `${ip}:.*`
    const [down, up] = await Promise.all([
      this.query(`speedtest_download_mbps{instance=~"${inst}"}`),
      this.query(`speedtest_upload_mbps{instance=~"${inst}"}`),
    ])
    if (!down.length && !up.length) return null
    return { down: this.firstValue(down), up: this.firstValue(up) }
  }

  private checkTcp(ip: string, port: number, timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      const done = (result: boolean) => { socket.destroy(); resolve(result) }
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.once('timeout', () => done(false))
      socket.connect(port, ip)
    })
  }

  async getFleetStatus(servers: { ip: string; port?: number }[]): Promise<Record<string, boolean>> {
    if (servers.length === 0) return {}
    const results = await Promise.all(
      servers.map(async ({ ip, port }) => ({
        ip,
        online: await this.checkTcp(ip, port ?? 22),
      })),
    )
    return Object.fromEntries(results.map(({ ip, online }) => [ip, online]))
  }
}
