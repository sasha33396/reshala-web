import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'ssh2'
import { SocksClient } from 'socks'
import type { Server } from '@reshala-web/shared'

type HostFingerprints = Record<string, string>

export function resolveSshKeyPath(keyPath: string): string {
  const keysDir = process.env.SSH_KEYS_DIR
  if (!keysDir || !keyPath) return keyPath

  const resolvedKeysDir = path.resolve(keysDir)
  const resolvedKeyPath = path.resolve(keyPath)
  if (resolvedKeyPath === resolvedKeysDir || resolvedKeyPath.startsWith(`${resolvedKeysDir}${path.sep}`)) {
    return resolvedKeyPath
  }

  const normalized = keyPath.replace(/\\/g, '/')
  if (normalized.includes('/.ssh/')) {
    return path.join(resolvedKeysDir, path.basename(normalized))
  }

  return keyPath
}

function fingerprintStorePath(): string {
  if (process.env.SSH_HOST_FINGERPRINTS_PATH) return process.env.SSH_HOST_FINGERPRINTS_PATH
  const keysDir = process.env.SSH_KEYS_DIR ?? path.join(process.env.HOME ?? '/root', '.ssh')
  return path.join(keysDir, '.reshala_host_fingerprints.json')
}

function readFingerprints(filePath: string): HostFingerprints {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HostFingerprints
  } catch {
    return {}
  }
}

function verifyOrTrustFingerprint(server: Server, fingerprint: string): boolean {
  const filePath = fingerprintStorePath()
  const hostId = `${server.ip}:${server.port}`
  const fingerprints = readFingerprints(filePath)
  const expected = fingerprints[hostId]
  if (expected) return expected === fingerprint

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fingerprints[hostId] = fingerprint
  const tempPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(fingerprints, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tempPath, filePath)
  return true
}

function baseConfig(server: Server) {
  return {
    username: server.user,
    privateKey: fs.readFileSync(resolveSshKeyPath(server.keyPath)),
    readyTimeout: 15000,
    hostHash: 'sha256',
    hostVerifier: (fingerprint: string) => verifyOrTrustFingerprint(server, fingerprint),
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

export async function createProxiedSocket(host: string, port: number): Promise<any | null> {
  const proxy = getSocksProxy()
  if (!proxy) return null
  const { socket } = await SocksClient.createConnection({
    proxy,
    command: 'connect',
    destination: { host, port },
  })
  return socket
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
