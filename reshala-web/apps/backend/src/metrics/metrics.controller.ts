import { Controller, Get, Param, Query, UseGuards, NotFoundException } from '@nestjs/common'
import { MetricsService } from './metrics.service'
import { FleetService } from '../fleet/fleet.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('internal')
export class InternalController {
  constructor(private readonly fleetService: FleetService) {}

  // Called by Prometheus HTTP SD — no auth, internal Docker network only
  @Get('prometheus-targets')
  prometheusTargets() {
    const servers = this.fleetService.getAll()
    return servers.map((s) => ({
      targets: [`${s.ip}:9100`],
      labels: { name: s.name, country: s.country ?? '' },
    }))
  }
}

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
    return this.metricsService.getFleetStatus(servers.map((s) => ({ ip: s.ip, port: s.port })))
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
