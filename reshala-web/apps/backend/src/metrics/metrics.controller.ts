import { Controller, Get, Param, Query, UseGuards, NotFoundException } from '@nestjs/common'
import { MetricsService } from './metrics.service'
import { FleetService } from '../fleet/fleet.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@UseGuards(JwtAuthGuard)
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly fleetService: FleetService,
  ) {}

  @Get('fleet/status')
  async fleetStatus() {
    const servers = this.fleetService.getAll()
    const ips = servers.map((s) => s.ip)
    return this.metricsService.getFleetStatus(ips)
  }

  @Get(':name')
  async serverMetrics(@Param('name') name: string) {
    const server = this.fleetService.getByName(name)
    if (!server) throw new NotFoundException(`Server "${name}" not found`)
    return this.metricsService.getServerMetrics(server.ip)
  }

  @Get(':name/history')
  async serverHistory(
    @Param('name') name: string,
    @Query('minutes') minutes?: string,
  ) {
    const server = this.fleetService.getByName(name)
    if (!server) throw new NotFoundException(`Server "${name}" not found`)
    return this.metricsService.getServerMetricsHistory(server.ip, minutes ? parseInt(minutes) : 30)
  }
}
