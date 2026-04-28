import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import { execFile, execSync } from 'child_process'
import { createServer } from 'net'
import { promisify } from 'util'
import { SocksClient } from 'socks'
import type { Server, FleetGroup } from '@reshala-web/shared'

const execFileAsync = promisify(execFile)

const COUNTRY_MAP: Record<string, string> = {
  ru: '🇷🇺 Russia',
  de: '🇩🇪 Germany',
  fl: '🇫🇮 Finland',
  nl: '🇳🇱 Netherlands',
  pl: '🇵🇱 Poland',
  lt: '🇱🇹 Lithuania',
  se: '🇸🇪 Sweden',
  un: '🌐 Untagged',
  auto: '🤖 Auto',
}

function shellEscapeKey(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function parseCountry(name: string): string {
  const prefix = name.split('-')[0].toLowerCase()
  return COUNTRY_MAP[prefix] ?? '🌐 Untagged'
}

function parseProvider(name: string): string {
  const parts = name.split('-')
  let provider = parts[parts.length - 1]
  if (/^\d+$/.test(provider) && parts.length > 1) {
    provider = parts[parts.length - 2]
  }
  provider = provider.replace(/\(.*?\)/g, '')
  return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : '?'
}

function parseServer(line: string): Server | null {
  const parts = line.split('|')
  if (parts.length < 5) return null
  const [name, user, ip, portStr, keyPath, sudoPass] = parts
  const port = parseInt(portStr, 10)
  if (!name || !user || !ip || isNaN(port)) return null
  return {
    name,
    user,
    ip,
    port,
    keyPath,
    sudoPass: sudoPass ?? '',
    country: parseCountry(name),
  }
}

function serializeLine(s: Server): string {
  return `${s.name}|${s.user}|${s.ip}|${s.port}|${s.keyPath}|${s.sudoPass ?? ''}`
}

@Injectable()
export class FleetService {
  private readonly logger = new Logger(FleetService.name)

  private get dbPath(): string {
    return process.env.FLEET_DB_PATH ?? path.join(process.env.HOME ?? '/root', '.reshala_fleet')
  }

  private get sshKeysDir(): string {
    return process.env.SSH_KEYS_DIR ?? path.join(process.env.HOME ?? '/root', '.ssh')
  }

  private readLines(): string[] {
    if (!fs.existsSync(this.dbPath)) return []
    return fs
      .readFileSync(this.dbPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
  }

  private writeLines(lines: string[]): void {
    fs.writeFileSync(this.dbPath, lines.join('\n') + '\n', 'utf-8')
  }

  getAll(): Server[] {
    return this.readLines()
      .map(parseServer)
      .filter((s): s is Server => s !== null)
  }

  getByName(name: string): Server | null {
    return this.getAll().find((s) => s.name === name) ?? null
  }

  getGrouped(groupBy: 'country' | 'provider' = 'country'): FleetGroup[] {
    const servers = this.getAll()
    const map = new Map<string, Server[]>()
    for (const server of servers) {
      const key = groupBy === 'provider'
        ? parseProvider(server.name)
        : (server.country ?? '🌐 Untagged')
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(server)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([country, servers]) => ({ country, servers }))
  }

  add(server: Server): void {
    const existing = this.getByName(server.name)
    if (existing) throw new ConflictException(`Server "${server.name}" already exists`)
    const lines = this.readLines()
    lines.push(serializeLine({ ...server, country: parseCountry(server.name) }))
    this.writeLines(lines)
  }

  update(name: string, data: Partial<Server>): Server {
    const lines = this.readLines()
    let found = false
    const updated = lines.map((line) => {
      const s = parseServer(line)
      if (!s || s.name !== name) return line
      found = true
      return serializeLine({ ...s, ...data, name: s.name })
    })
    if (!found) throw new NotFoundException(`Server "${name}" not found`)
    this.writeLines(updated)
    return this.getByName(name)!
  }

  remove(name: string): void {
    const lines = this.readLines()
    const filtered = lines.filter((line) => {
      const s = parseServer(line)
      return s?.name !== name
    })
    if (filtered.length === lines.length) {
      throw new NotFoundException(`Server "${name}" not found`)
    }
    this.writeLines(filtered)
  }

  generateKeyPair(keyPath: string): void {
    if (fs.existsSync(keyPath)) return
    const dir = path.dirname(keyPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    execSync(`ssh-keygen -t ed25519 -f ${shellEscapeKey(keyPath)} -N "" -C reshala -q`, { stdio: ['ignore', 'ignore', 'pipe'] })
    fs.chmodSync(keyPath, 0o600)
  }

  // ── CLI-based SSH helpers (avoid ssh2 handshake compatibility issues) ──

  private getSocksProxy() {
    const host = process.env.SOCKS5_HOST
    if (!host) return null
    return {
      host,
      port: parseInt(process.env.SOCKS5_PORT ?? '1080'),
      type: 5 as const,
      userId: process.env.SOCKS5_USER || undefined,
      password: process.env.SOCKS5_PASS || undefined,
    }
  }

  /** Creates a local TCP port that tunnels to targetHost:targetPort via SOCKS5. */
  private createSocksForwarder(
    targetHost: string,
    targetPort: number,
  ): Promise<{ localPort: number; close: () => void }> {
    const proxy = this.getSocksProxy()
    if (!proxy) return Promise.reject(new Error('No SOCKS5 proxy configured'))
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.listen(0, '127.0.0.1', () => {
        const { port: localPort } = server.address() as { port: number }
        server.on('connection', async (client) => {
          try {
            const { socket: remote } = await SocksClient.createConnection({
              proxy,
              command: 'connect',
              destination: { host: targetHost, port: targetPort },
            })
            client.pipe(remote)
            remote.pipe(client)
            client.once('close', () => remote.destroy())
            remote.once('close', () => client.destroy())
          } catch {
            client.destroy()
          }
        })
        resolve({ localPort, close: () => server.close() })
      })
      server.once('error', reject)
    })
  }

  private async execSshWithPassword(
    host: string,
    port: number,
    user: string,
    password: string,
    command: string,
  ): Promise<void> {
    await execFileAsync(
      'sshpass',
      ['-e', 'ssh',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=15',
        '-p', String(port),
        `${user}@${host}`,
        command,
      ],
      { timeout: 22000, env: { ...process.env, SSHPASS: password } },
    )
  }

  private async execSshWithKey(
    host: string,
    port: number,
    user: string,
    keyPath: string,
    command: string,
  ): Promise<void> {
    await execFileAsync(
      'ssh',
      ['-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=15',
        '-o', 'BatchMode=yes',
        '-i', keyPath,
        '-p', String(port),
        `${user}@${host}`,
        command,
      ],
      { timeout: 22000 },
    )
  }

  private async execSshCapture(
    host: string,
    port: number,
    user: string,
    keyPath: string,
    command: string,
  ): Promise<string> {
    const { stdout, stderr } = await execFileAsync(
      'ssh',
      ['-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=15',
        '-o', 'BatchMode=yes',
        '-i', keyPath,
        '-p', String(port),
        `${user}@${host}`,
        command,
      ],
      { timeout: 30000 },
    )
    return (stdout + (stderr ? `\n${stderr}` : '')).trim()
  }

  async runSshOnServer(server: Server, command: string): Promise<{ ok: boolean; output: string }> {
    const candidateKeys = [
      server.keyPath,
      ...['id_ed25519', 'id_rsa', 'id_ecdsa'].map((k) => path.join(this.sshKeysDir, k)),
    ]
    for (const keyFile of candidateKeys) {
      if (!fs.existsSync(keyFile)) continue
      try {
        const output = await this.execSshCapture(server.ip, server.port, server.user, keyFile, command)
        return { ok: true, output }
      } catch (e: any) {
        const msg = (e?.stderr?.toString()?.trim() ?? e?.stdout?.toString()?.trim() ?? e?.message ?? '').split('\n')[0]
        if (msg.includes('Permission denied') || msg.includes('authentication failed')) continue
        return { ok: false, output: msg }
      }
    }
    return { ok: false, output: 'No valid key found' }
  }

  async readRemoteCert(
    serverName: string,
    sniDomain: string,
  ): Promise<{ crt: string | null; key: string | null; json: string | null }> {
    const server = this.getByName(serverName)
    if (!server) throw new NotFoundException(`Server "${serverName}" not found`)
    const base = `/var/lib/docker/volumes/xray-sni_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${sniDomain}`
    const readB64 = async (file: string): Promise<string | null> => {
      const r = await this.runSshOnServer(server, `base64 -w0 '${file.replace(/'/g, "'\\''")}'`)
      return r.ok ? r.output.trim() : null
    }
    const [crt, key, json] = await Promise.all([
      readB64(`${base}/${sniDomain}.crt`),
      readB64(`${base}/${sniDomain}.key`),
      readB64(`${base}/${sniDomain}.json`),
    ])
    return { crt, key, json }
  }

  async bulkSshCommand(
    names: string[],
    command: string,
  ): Promise<Array<{ name: string; ok: boolean; output: string }>> {
    const servers = names.map((n) => this.getByName(n)).filter((s): s is Server => s !== null)
    const CONCURRENCY = 20
    const results: Array<{ name: string; ok: boolean; output: string }> = []

    for (let i = 0; i < servers.length; i += CONCURRENCY) {
      const chunk = servers.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(
        chunk.map((s) => this.runSshOnServer(s, command)),
      )
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]
        if (r.status === 'fulfilled') {
          results.push({ name: chunk[j].name, ...r.value })
        } else {
          results.push({ name: chunk[j].name, ok: false, output: r.reason?.message ?? 'unknown' })
        }
      }
    }

    return results
  }

  async deployPublicKey(server: Server): Promise<void> {
    const pubKeyPath = `${server.keyPath}.pub`
    if (!fs.existsSync(pubKeyPath)) throw new Error(`Public key not found: ${pubKeyPath}`)
    const pubKey = fs.readFileSync(pubKeyPath, 'utf-8').trim()

    const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF ${shellEscapeKey(pubKey)} ~/.ssh/authorized_keys 2>/dev/null || echo ${shellEscapeKey(pubKey)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`

    type SshFn = (host: string, port: number) => Promise<void>

    const tryDirect = async (label: string, fn: SshFn): Promise<boolean> => {
      try {
        await fn(server.ip, server.port)
        this.logger.log(`deployPublicKey ${server.name}: OK via ${label} direct`)
        return true
      } catch (e: any) {
        const msg = (e?.stderr?.toString()?.trim() ?? e?.message ?? '').split('\n')[0]
        this.logger.debug(`deployPublicKey ${server.name}: ${label} direct failed — ${msg}`)
        return false
      }
    }

    const trySocks = async (label: string, fn: SshFn): Promise<boolean> => {
      if (!process.env.SOCKS5_HOST) return false
      let forwarder: { localPort: number; close: () => void } | null = null
      try {
        forwarder = await this.createSocksForwarder(server.ip, server.port)
        await fn('127.0.0.1', forwarder.localPort)
        this.logger.log(`deployPublicKey ${server.name}: OK via ${label} SOCKS5`)
        return true
      } catch (e: any) {
        const msg = (e?.stderr?.toString()?.trim() ?? e?.message ?? '').split('\n')[0]
        this.logger.debug(`deployPublicKey ${server.name}: ${label} SOCKS5 failed — ${msg}`)
        return false
      } finally {
        forwarder?.close()
      }
    }

    // Password first — fastest path for initial provisioning (keys not yet deployed)
    if (server.sudoPass) {
      const pwFn: SshFn = (h, p) => this.execSshWithPassword(h, p, server.user, server.sudoPass!, cmd)
      if (await tryDirect('password', pwFn)) return
      if (await trySocks('password', pwFn)) return
    }

    // Key fallback — for servers where password auth is disabled
    const candidateKeys = [
      server.keyPath,
      ...['id_ed25519', 'id_rsa', 'id_ecdsa'].map((k) => path.join(this.sshKeysDir, k)),
    ]
    for (const keyFile of candidateKeys) {
      if (!fs.existsSync(keyFile)) continue
      const keyFn: SshFn = (h, p) => this.execSshWithKey(h, p, server.user, keyFile, cmd)
      if (await tryDirect(`key ${path.basename(keyFile)}`, keyFn)) return
      if (await trySocks(`key ${path.basename(keyFile)}`, keyFn)) return
    }

    throw new Error(server.sudoPass ? 'Wrong password and no valid key worked' : 'No valid key and no password set')
  }

  async provisionServer(name: string): Promise<{ ok: boolean; error?: string }> {
    const server = this.getByName(name)
    if (!server) throw new NotFoundException(`Server "${name}" not found`)
    try {
      this.generateKeyPair(server.keyPath)
      await this.deployPublicKey(server)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'unknown error' }
    }
  }

  async addByPassword(
    name: string,
    ip: string,
    password: string,
    user: string,
    port: number,
  ): Promise<{ ok: boolean; error?: string }> {
    const keyPath = path.join(
      this.sshKeysDir,
      `id_ed25519_reshala_node_${name}_${ip.replace(/\./g, '_')}`,
    )
    try {
      this.add({ name, user, ip, port, keyPath, sudoPass: password })
    } catch (e: any) {
      if (e?.status !== 409) return { ok: false, error: `Failed to add: ${e?.message}` }
    }
    try {
      this.generateKeyPair(keyPath)
      await this.deployPublicKey({ name, user, ip, port, keyPath, sudoPass: password })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: `Added but key deploy failed: ${e?.message}` }
    }
  }

  private _provisionProgress: {
    running: boolean; total: number; done: number; ok: number; failed: number; errors: string[]
  } = { running: false, total: 0, done: 0, ok: 0, failed: 0, errors: [] }

  getProvisionProgress() {
    return { ...this._provisionProgress, errors: [...this._provisionProgress.errors] }
  }

  async provisionAll(): Promise<{ total: number; ok: number; failed: number; errors: string[] }> {
    const servers = this.getAll()
    let ok = 0
    let failed = 0
    const errors: string[] = []
    const CONCURRENCY = 20

    this._provisionProgress = { running: true, total: servers.length, done: 0, ok: 0, failed: 0, errors: [] }
    this.logger.log(`provisionAll: starting for ${servers.length} servers (${CONCURRENCY} concurrent)`)

    for (let i = 0; i < servers.length; i += CONCURRENCY) {
      const chunk = servers.slice(i, i + CONCURRENCY)
      this.logger.log(`provisionAll: batch ${i + 1}–${Math.min(i + CONCURRENCY, servers.length)} / ${servers.length}`)
      const results = await Promise.allSettled(
        chunk.map(async (server) => {
          this.generateKeyPair(server.keyPath)
          await this.deployPublicKey(server)
        }),
      )
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === 'fulfilled') {
          ok++
        } else {
          failed++
          const msg = `${chunk[j].name}: ${(r.reason as any)?.message ?? 'unknown'}`
          errors.push(msg)
          this.logger.warn(`provisionAll FAIL: ${msg}`)
        }
        this._provisionProgress.done++
        this._provisionProgress.ok = ok
        this._provisionProgress.failed = failed
        this._provisionProgress.errors = errors
      }
    }

    this._provisionProgress.running = false
    this.logger.log(`provisionAll: done — ok=${ok} failed=${failed}`)
    return { total: servers.length, ok, failed, errors }
  }

  async importFromText(content: string): Promise<{
    added: number
    skipped: number
    errors: string[]
    provisioned: number
    provisionFailed: number
  }> {
    const errors: string[] = []
    let added = 0
    let skipped = 0
    const toProvision: Server[] = []

    const rows = content.split('\n').filter((l) => l.trim().length > 0)
    for (const row of rows) {
      const parts = row.trim().split('\t')
      if (parts.length < 2) {
        errors.push(`Bad line: ${row}`)
        continue
      }
      const [name, ip, sudoPass] = parts
      if (!name || !ip) {
        errors.push(`Missing name or ip: ${row}`)
        continue
      }
      const keyPath = path.join(
        this.sshKeysDir,
        `id_ed25519_reshala_node_${name}_${ip.replace(/\./g, '_')}`,
      )
      const server: Server = { name, user: 'root', ip, port: 22, keyPath, sudoPass: sudoPass ?? '' }
      try {
        this.add(server)
        added++
        try { this.generateKeyPair(keyPath) } catch (e: any) {
          this.logger.warn(`Key gen failed for ${name}: ${e?.message}`)
        }
        if (sudoPass?.trim()) toProvision.push(server)
      } catch (e: any) {
        if (e?.status === 409) {
          skipped++
        } else {
          errors.push(`${name}: ${e?.message ?? 'unknown error'}`)
        }
      }
    }

    let provisioned = 0
    let provisionFailed = 0
    const CONCURRENCY = 20
    for (let i = 0; i < toProvision.length; i += CONCURRENCY) {
      const chunk = toProvision.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map((s) => this.deployPublicKey(s)),
      )
      for (const r of results) {
        if (r.status === 'fulfilled') provisioned++
        else provisionFailed++
      }
    }

    return { added, skipped, errors, provisioned, provisionFailed }
  }
}
