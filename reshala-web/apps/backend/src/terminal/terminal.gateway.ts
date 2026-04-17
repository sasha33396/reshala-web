import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { Socket } from 'socket.io'
import { Client } from 'ssh2'
import { FleetService } from '../fleet/fleet.service'
import { AuthService } from '../auth/auth.service'
import { sshConnectConfig } from '../common/ssh.utils'

@WebSocketGateway({ namespace: '/terminal', cors: { origin: true, credentials: true } })
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TerminalGateway.name)
  private readonly connections = new Map<string, Client>()

  constructor(
    private readonly fleetService: FleetService,
    private readonly authService: AuthService,
  ) {}

  handleConnection(client: Socket) {
    const token = this.extractToken(client)
    if (!token || !this.authService.verifyToken(token)) {
      client.emit('error', 'Unauthorized')
      client.disconnect(true)
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Terminal client disconnected: ${client.id}`)
    const conn = this.connections.get(client.id)
    if (conn) {
      conn.end()
      this.connections.delete(client.id)
    }
  }

  @SubscribeMessage('connect-ssh')
  handleConnect(client: Socket, payload: { serverName: string }) {
    const server = this.fleetService.getByName(payload.serverName)
    if (!server) {
      client.emit('error', `Server "${payload.serverName}" not found`)
      return
    }

    const existing = this.connections.get(client.id)
    if (existing) {
      existing.end()
      this.connections.delete(client.id)
    }

    const conn = new Client()
    this.connections.set(client.id, conn)

    conn.on('ready', () => {
      this.logger.log(`Terminal SSH ready: ${server.name} (${client.id})`)
      conn.shell((err, stream) => {
        if (err) {
          client.emit('error', err.message)
          return
        }

        stream.on('data', (data: Buffer) => client.emit('data', data.toString()))
        stream.stderr.on('data', (data: Buffer) => client.emit('data', data.toString()))
        stream.on('close', () => {
          client.emit('close')
          conn.end()
          this.connections.delete(client.id)
        })

        client.on('input', (data: string) => {
          if (stream.writable) stream.write(data)
        })
        client.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
          stream.setWindow(rows, cols, 0, 0)
        })
      })
    })

    conn.on('error', (err) => {
      this.logger.error(`Terminal SSH error [${server.name}]: ${err.message}`)
      client.emit('error', err.message)
      this.connections.delete(client.id)
    })

    try {
      conn.connect(sshConnectConfig(server))
    } catch (err: any) {
      client.emit('error', err.message)
      this.connections.delete(client.id)
    }
  }

  private extractToken(client: Socket): string | null {
    const cookie = client.handshake.headers.cookie ?? ''
    const match = cookie.split(';').find((c) => c.trim().startsWith('access_token='))
    if (match) return match.split('=').slice(1).join('=')
    return (client.handshake.auth as Record<string, string>)?.token ?? null
  }
}
