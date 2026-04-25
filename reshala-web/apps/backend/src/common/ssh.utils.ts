import * as fs from 'fs'
import { Client } from 'ssh2'
import { SocksClient } from 'socks'
import type { Server } from '@reshala-web/shared'

function baseConfig(server: Server) {
  return {
    username: server.user,
    privateKey: fs.readFileSync(server.keyPath),
    readyTimeout: 15000,
    hostVerifier: () => true,
  }
}

export function sshConnectConfig(server: Server) {
  return {
    host: server.ip,
    port: server.port,
    ...baseConfig(server),
  }
}

function getSocksProxy() {
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

export async function connectSsh(conn: Client, server: Server): Promise<void> {
  const proxy = getSocksProxy()
  if (proxy) {
    const { socket } = await SocksClient.createConnection({
      proxy,
      command: 'connect',
      destination: { host: server.ip, port: server.port },
    })
    conn.connect({ sock: socket, ...baseConfig(server) })
  } else {
    conn.connect(sshConnectConfig(server))
  }
}
