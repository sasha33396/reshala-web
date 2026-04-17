import { Injectable, Logger } from '@nestjs/common'
import { Observable } from 'rxjs'
import { Client, SFTPWrapper } from 'ssh2'
import * as fs from 'fs'
import type { Server, PluginOutputLine } from '@reshala-web/shared'

function buildEnvPrefix(envVars: Record<string, string>): string {
  return Object.entries(envVars)
    .map(([k, v]) => `${k}=${shellEscape(v)}`)
    .join(' ')
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function sshConnectConfig(server: Server) {
  return {
    host: server.ip,
    port: server.port,
    username: server.user,
    privateKey: fs.readFileSync(server.keyPath),
    readyTimeout: 5000,
    hostVerifier: () => true,
  }
}

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name)

  runPlugin(
    pluginPath: string,
    server: Server,
    envVars: Record<string, string> = {},
  ): Observable<PluginOutputLine> {
    return new Observable((observer) => {
      const conn = new Client()
      const remotePath = `/tmp/reshala_plugin_${Date.now()}_${Math.floor(Math.random() * 1e6)}.sh`

      const cleanup = (err?: Error) => {
        conn.end()
        if (err) {
          this.logger.error(`[${server.name}] SSH error: ${err.message}`)
          observer.error(err)
        } else {
          observer.complete()
        }
      }

      conn.on('error', (err) => {
        this.logger.error(`[${server.name}] Connection error: ${err.message}`)
        observer.error(err)
      })

      conn.on('ready', () => {
        this.logger.log(`[${server.name}] Connected, uploading plugin to ${remotePath}`)

        conn.sftp((err, sftp: SFTPWrapper) => {
          if (err) return cleanup(err)

          sftp.fastPut(pluginPath, remotePath, (uploadErr) => {
            sftp.end()
            if (uploadErr) return cleanup(uploadErr)

            this.logger.log(`[${server.name}] Plugin uploaded, executing`)

            const envPrefix = buildEnvPrefix(envVars)
            const cmd = `${envPrefix} bash ${remotePath}; rm -f ${remotePath}`

            conn.exec(cmd, (execErr, stream) => {
              if (execErr) return cleanup(execErr)

              stream.on('data', (chunk: Buffer) => {
                for (const line of chunk.toString().split('\n').filter(Boolean)) {
                  observer.next({ type: 'stdout', data: line })
                }
              })

              stream.stderr.on('data', (chunk: Buffer) => {
                for (const line of chunk.toString().split('\n').filter(Boolean)) {
                  observer.next({ type: 'stderr', data: line })
                }
              })

              stream.on('close', (code: number) => {
                this.logger.log(`[${server.name}] Plugin exited with code ${code}`)
                observer.next({ type: 'exit', data: String(code) })
                cleanup()
              })
            })
          })
        })
      })

      conn.connect(sshConnectConfig(server))

      // teardown: called if the Observable is unsubscribed before completion
      return () => conn.end()
    })
  }

  checkOnline(server: Server): Promise<boolean> {
    return new Promise((resolve) => {
      const conn = new Client()
      const timer = setTimeout(() => {
        conn.end()
        resolve(false)
      }, 3000)

      conn.on('ready', () => {
        clearTimeout(timer)
        conn.end()
        resolve(true)
      })

      conn.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })

      try {
        conn.connect(sshConnectConfig(server))
      } catch {
        clearTimeout(timer)
        resolve(false)
      }
    })
  }
}
