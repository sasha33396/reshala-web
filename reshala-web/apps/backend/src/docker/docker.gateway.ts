import { WebSocketGateway, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { Socket } from 'socket.io'
import { DockerService } from './docker.service'
import { FleetService } from '../fleet/fleet.service'
import { AuthService } from '../auth/auth.service'

@WebSocketGateway({ namespace: '/docker', cors: { origin: true, credentials: true } })
export class DockerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DockerGateway.name)

  constructor(
    private readonly dockerService: DockerService,
    private readonly fleetService: FleetService,
    private readonly authService: AuthService,
  ) {}

  handleConnection(client: Socket) {
    const token = this.extractToken(client)
    if (!token || !this.authService.verifyToken(token)) {
      client.emit('error', 'Unauthorized')
      client.disconnect(true)
      return
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Docker client disconnected: ${client.id}`)
  }

  @SubscribeMessage('logs')
  handleLogs(client: Socket, payload: { serverName: string; containerId: string; tail?: number }) {
    const server = this.fleetService.getByName(payload.serverName)
    if (!server) { client.emit('error', 'Server not found'); return }

    const sub = this.dockerService
      .streamLogs(server, payload.containerId, payload.tail ?? 100)
      .subscribe({
        next: (line) => client.emit('log', line),
        complete: () => client.emit('log-end'),
        error: (err: Error) => client.emit('log-error', err.message),
      })

    client.once('stop-logs', () => sub.unsubscribe())
    client.once('disconnect', () => sub.unsubscribe())
  }

  private extractToken(client: Socket): string | null {
    const cookie = client.handshake.headers.cookie ?? ''
    const match = cookie.split(';').find((c) => c.trim().startsWith('access_token='))
    if (match) return match.split('=').slice(1).join('=')
    return (client.handshake.auth as Record<string, string>)?.token ?? null
  }
}
