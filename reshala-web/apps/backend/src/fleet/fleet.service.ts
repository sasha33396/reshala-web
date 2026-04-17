import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
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
        }
      }
    }
    return { added, skipped, errors }
  }
}
