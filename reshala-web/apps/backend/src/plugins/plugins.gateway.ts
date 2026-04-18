import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { Socket } from 'socket.io'
import { FleetService } from '../fleet/fleet.service'
import { ExecutorService } from './executor.service'
import { PluginsService } from './plugins.service'
import { AuthService } from '../auth/auth.service'
import type { PluginRunPayload } from '@reshala-web/shared'

@WebSocketGateway({ namespace: '/plugins', cors: { origin: true, credentials: true } })
export class PluginsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PluginsGateway.name)

  constructor(
    private readonly fleetService: FleetService,
    private readonly executorService: ExecutorService,
    private readonly pluginsService: PluginsService,
    private readonly authService: AuthService,
  ) {}

  handleConnection(client: Socket) {
    const token = this.extractToken(client)
    if (!token || !this.authService.verifyToken(token)) {
      client.emit('error', 'Unauthorized')
      client.disconnect(true)
      return
    }
    this.logger.log(`Client connected: ${client.id}`)
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`)
  }

  @SubscribeMessage('run')
  async handleRun(client: Socket, payload: PluginRunPayload) {
    const plugin = this.pluginsService.getById(payload.pluginId)
    if (!plugin) {
      client.emit('error', { message: `Plugin "${payload.pluginId}" not found` })
      return
    }

    const allFleet = this.fleetService.getAll()
    const servers = (() => {
      if (payload.serverNames?.length)
        return payload.serverNames.map((n) => this.fleetService.getByName(n)).filter(Boolean) as typeof allFleet
      if (payload.serverName) {
        const s = this.fleetService.getByName(payload.serverName)
        return s ? [s] : []
      }
      return allFleet
    })()

    const runOne = (server: (typeof allFleet)[number]) =>
      new Promise<void>((resolve) => {
        client.emit('server-start', { server: server.name })
        this.executorService
          .runPlugin(plugin.path, server, payload.envVars ?? {})
          .subscribe({
            next: (line) => client.emit('output', { server: server.name, ...line }),
            complete: () => { client.emit('server-done', { server: server.name }); resolve() },
            error: (err: Error) => { client.emit('server-error', { server: server.name, error: err.message }); resolve() },
          })
      })

    if (payload.parallel) {
      const concurrency = payload.concurrency ?? 10
      for (let i = 0; i < servers.length; i += concurrency) {
        await Promise.all(servers.slice(i, i + concurrency).map(runOne))
      }
    } else {
      for (const server of servers) await runOne(server)
    }

    client.emit('done')
  }

  private extractToken(client: Socket): string | null {
    const cookie = client.handshake.headers.cookie ?? ''
    const match = cookie.split(';').find((c) => c.trim().startsWith('access_token='))
    if (match) return match.split('=').slice(1).join('=')
    return (client.handshake.auth as Record<string, string>)?.token ?? null
  }
}
