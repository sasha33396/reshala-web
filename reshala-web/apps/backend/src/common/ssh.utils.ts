import * as fs from 'fs'
import type { Server } from '@reshala-web/shared'

export function sshConnectConfig(server: Server) {
  return {
    host: server.ip,
    port: server.port,
    username: server.user,
    privateKey: fs.readFileSync(server.keyPath),
    readyTimeout: 5000,
    hostVerifier: () => true,
  }
}
