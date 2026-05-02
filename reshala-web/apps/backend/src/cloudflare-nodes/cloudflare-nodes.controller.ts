import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { FleetService } from '../fleet/fleet.service'
import { CloudflareNodesService } from './cloudflare-nodes.service'

@UseGuards(JwtAuthGuard)
@Controller('cloudflare-nodes')
export class CloudflareNodesController {
  constructor(
    private readonly service: CloudflareNodesService,
    private readonly fleetService: FleetService,
  ) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig()
  }

  @Get('server/:name')
  getServerMatches(@Param('name') name: string) {
    const server = this.fleetService.getByName(name)
    if (!server) throw new NotFoundException(`Server "${name}" not found`)
    return this.service.getMatchesForIp(server.ip)
  }

  @Post('server/:name/add')
  addServerIp(@Param('name') name: string, @Body() body: { domain: string; zoneName: string }) {
    const server = this.fleetService.getByName(name)
    if (!server) throw new NotFoundException(`Server "${name}" not found`)
    return this.service.addIp(body.domain, body.zoneName, server.ip)
  }

  @Post('server/:name/remove')
  removeServerIp(@Param('name') name: string, @Body() body: { domain: string; zoneName: string }) {
    const server = this.fleetService.getByName(name)
    if (!server) throw new NotFoundException(`Server "${name}" not found`)
    return this.service.removeIp(body.domain, body.zoneName, server.ip)
  }
}
