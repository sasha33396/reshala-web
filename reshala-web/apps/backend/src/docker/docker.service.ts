import { Injectable, Logger } from '@nestjs/common'
import { Observable } from 'rxjs'
import { Client } from 'ssh2'
import * as fs from 'fs'
import type { Server, DockerContainer, PluginOutputLine } from '@reshala-web/shared'

@Injectable()
export class DockerService {
  private readonly logger = new Logger(DockerService.name)

  private connectConfig(server: Server) {
    return {
      host: server.ip,
      port: server.port,
      username: server.user,
      privateKey: fs.readFileSync(server.keyPath),
      readyTimeout: 8000,
      hostVerifier: () => true,
    }
  }

  private exec(server: Server, cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client()
      let out = ''
      const t = setTimeout(() => { conn.destroy(); reject(new Error('SSH timeout')) }, 12000)

      conn.on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) { clearTimeout(t); conn.end(); return reject(err) }
          stream.on('data', (c: Buffer) => { out += c.toString() })
          stream.stderr.on('data', (c: Buffer) => { out += c.toString() })
          stream.on('close', () => { clearTimeout(t); conn.end(); resolve(out) })
        })
      })
      conn.on('error', (e) => { clearTimeout(t); reject(e) })
      conn.connect(this.connectConfig(server))
    })
  }

  async listContainers(server: Server): Promise<DockerContainer[]> {
    const fmt = [
      '{"id":"{{.ID}}"',
      '"name":"{{.Names}}"',
      '"image":"{{.Image}}"',
      '"status":"{{.Status}}"',
      '"state":"{{.State}}"',
      '"ports":"{{.Ports}}"',
      '"created":"{{.CreatedAt}}"}',
    ].join(',')
    const out = await this.exec(server, `docker ps -a --format '${fmt}'`)
    return out
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) as DockerContainer } catch { return null } })
      .filter(Boolean) as DockerContainer[]
  }

  async control(server: Server, action: 'start' | 'stop' | 'restart', id: string): Promise<string> {
    return this.exec(server, `docker ${action} ${id} 2>&1`)
  }

  async prune(server: Server, type: 'images' | 'system'): Promise<string> {
    const cmd = type === 'images' ? 'docker image prune -f' : 'docker system prune -af'
    return this.exec(server, cmd)
  }

  streamLogs(server: Server, id: string, tail = 100): Observable<PluginOutputLine> {
    return new Observable((observer) => {
      const conn = new Client()
      const t = setTimeout(() => { conn.destroy(); observer.error(new Error('SSH timeout')) }, 10000)

      conn.on('ready', () => {
        clearTimeout(t)
        conn.exec(`docker logs --follow --tail ${tail} ${id} 2>&1`, (err, stream) => {
          if (err) return observer.error(err)
          stream.on('data', (c: Buffer) => {
            for (const line of c.toString().split('\n').filter(Boolean))
              observer.next({ type: 'stdout', data: line })
          })
          stream.stderr.on('data', (c: Buffer) => {
            for (const line of c.toString().split('\n').filter(Boolean))
              observer.next({ type: 'stderr', data: line })
          })
          stream.on('close', () => { conn.end(); observer.complete() })
        })
      })
      conn.on('error', (e) => { clearTimeout(t); observer.error(e) })
      conn.connect(this.connectConfig(server))
      return () => conn.end()
    })
  }
}
