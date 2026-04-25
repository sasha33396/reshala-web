import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { Client } from 'ssh2'
import type { Server, FleetGroup } from '@reshala-web/shared'
import { createProxiedSocket } from '../common/ssh.utils'

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

  getGrouped(): FleetGroup[] {
    const servers = this.getAll()
    const map = new Map<string, Server[]>()
    for (const server of servers) {
      const country = server.country ?? '🌐 Untagged'
      if (!map.has(country)) map.set(country, [])
      map.get(country)!.push(server)
    }
    return Array.from(map.entries()).map(([country, servers]) => ({ country, servers }))
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

  private async sshExecAndAuthorize(
    host: string,
    port: number,
    authConfig: Record<string, unknown>,
    pubKey: string,
  ): Promise<void> {
    const socksHost = process.env.SOCKS5_HOST
    let sock: any = null
    if (socksHost) {
      try {
        sock = await createProxiedSocket(host, port)
        this.logger.debug(`sshExecAndAuthorize: SOCKS5 socket OK → ${host}:${port}`)
      } catch (e: any) {
        throw new Error(`SOCKS5 proxy cannot reach ${host}:${port} — ${e?.message ?? 'unknown'}`)
      }
    }
    const connectConfig: Record<string, unknown> = sock
      ? { sock, hostVerifier: () => true, readyTimeout: 15000, ...authConfig }
      : { host, port, hostVerifier: () => true, readyTimeout: 12000, ...authConfig }
    delete connectConfig.host_placeholder

    return new Promise((resolve, reject) => {
      const conn = new Client()
      const timer = setTimeout(() => { conn.destroy(); reject(new Error('SSH timeout')) }, 20000)
      const done = (err?: Error) => { clearTimeout(timer); conn.end(); err ? reject(err) : resolve() }

      conn.on('ready', () => {
        const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF ${shellEscapeKey(pubKey)} ~/.ssh/authorized_keys 2>/dev/null || echo ${shellEscapeKey(pubKey)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
        conn.exec(cmd, (err, stream) => {
          if (err) return done(err)
          stream.on('close', () => done())
          stream.on('error', (e: Error) => done(e))
        })
      })
      conn.on('error', (err) => done(err))
      conn.connect(connectConfig as any)
    })
  }

  async deployPublicKey(server: Server): Promise<void> {
    const pubKeyPath = `${server.keyPath}.pub`
    if (!fs.existsSync(pubKeyPath)) throw new Error(`Public key not found: ${pubKeyPath}`)
    const pubKey = fs.readFileSync(pubKeyPath, 'utf-8').trim()

    const base = { username: server.user }

    // Candidate keys: server's own reshala key first (already deployed → works even if password auth disabled),
    // then generic system keys in the container's ~/.ssh/
    const candidateKeys = [
      server.keyPath,
      ...['id_ed25519', 'id_rsa', 'id_ecdsa'].map(k => path.join(this.sshKeysDir, k)),
    ]
    for (const keyFile of candidateKeys) {
      if (!fs.existsSync(keyFile)) continue
      this.logger.debug(`deployPublicKey ${server.name}: trying key ${path.basename(keyFile)}`)
      try {
        await this.sshExecAndAuthorize(server.ip, server.port, { ...base, privateKey: fs.readFileSync(keyFile) }, pubKey)
        this.logger.log(`deployPublicKey ${server.name}: OK via ${path.basename(keyFile)}`)
        return
      } catch (e: any) {
        this.logger.debug(`deployPublicKey ${server.name}: key ${path.basename(keyFile)} failed — ${e?.message}`)
      }
    }

    // Fall back to password auth
    if (!server.sudoPass) throw new Error('No existing key worked and no password set')
    this.logger.debug(`deployPublicKey ${server.name}: trying password auth`)
    await this.sshExecAndAuthorize(server.ip, server.port, { ...base, password: server.sudoPass }, pubKey)
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

  async provisionAll(): Promise<{ total: number; ok: number; failed: number; errors: string[] }> {
    const servers = this.getAll()
    let ok = 0
    let failed = 0
    const errors: string[] = []
    const CONCURRENCY = 20

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
      }
    }

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

    // Deploy SSH keys in parallel (20 concurrent)
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
