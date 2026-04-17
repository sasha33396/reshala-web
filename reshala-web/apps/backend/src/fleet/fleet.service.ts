import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { Client } from 'ssh2'
import type { Server, FleetGroup } from '@reshala-web/shared'

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

  private sshExecAndAuthorize(
    connectConfig: Record<string, unknown>,
    pubKey: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client()
      const timer = setTimeout(() => { conn.destroy(); reject(new Error('SSH timeout')) }, 12000)
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

    const base = { host: server.ip, port: server.port, username: server.user, hostVerifier: () => true, readyTimeout: 10000 }

    // Try existing system keys first (reshala or default ssh keys)
    const candidateKeys = ['id_ed25519', 'id_rsa', 'id_ecdsa'].map(k => path.join(this.sshKeysDir, k))
    for (const keyFile of candidateKeys) {
      if (!fs.existsSync(keyFile)) continue
      try {
        await this.sshExecAndAuthorize({ ...base, privateKey: fs.readFileSync(keyFile) }, pubKey)
        return
      } catch {
        // try next
      }
    }

    // Fall back to password auth
    if (!server.sudoPass) throw new Error('No existing key worked and no password set')
    await this.sshExecAndAuthorize({ ...base, password: server.sudoPass }, pubKey)
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

  async provisionAll(): Promise<{ total: number; ok: number; failed: number; errors: string[] }> {
    const servers = this.getAll()
    let ok = 0
    let failed = 0
    const errors: string[] = []
    for (const server of servers) {
      try {
        this.generateKeyPair(server.keyPath)
        await this.deployPublicKey(server)
        ok++
      } catch (e: any) {
        failed++
        errors.push(`${server.name}: ${e?.message ?? 'unknown'}`)
      }
    }
    return { total: servers.length, ok, failed, errors }
  }

  importFromText(content: string): { added: number; skipped: number; errors: string[] } {
    const errors: string[] = []
    let added = 0
    let skipped = 0

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
      try {
        this.add({ name, user: 'root', ip, port: 22, keyPath, sudoPass: sudoPass ?? '' })
        added++
      } catch (e: any) {
        if (e?.status === 409) {
          skipped++
        } else {
          errors.push(`${name}: ${e?.message ?? 'unknown error'}`)
          continue
        }
      }
      // Generate key pair if missing (non-blocking, errors logged but don't fail import)
      try {
        this.generateKeyPair(keyPath)
      } catch (e: any) {
        this.logger.warn(`Key gen failed for ${name}: ${e?.message}`)
      }
    }
    return { added, skipped, errors }
  }
}
