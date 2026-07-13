import { Body, Controller, Get, Post, Param, UseGuards, NotFoundException } from '@nestjs/common'
import { DockerService } from './docker.service'
import { FleetService } from '../fleet/fleet.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { BulkDockerControlDto, BulkDockerScanDto } from './dto/bulk-docker.dto'

@UseGuards(JwtAuthGuard)
@Controller('docker')
export class DockerController {
  constructor(
    private readonly dockerService: DockerService,
    private readonly fleetService: FleetService,
  ) {}

  private getServer(name: string) {
    const s = this.fleetService.getByName(name)
    if (!s) throw new NotFoundException(`Server "${name}" not found`)
    return s
  }

  @Post('bulk/containers')
  listContainersBulk(@Body() dto: BulkDockerScanDto) {
    const uniqueNames = [...new Set(dto.serverNames)]
    return this.dockerService.listContainersBulk(uniqueNames.map((name) => this.getServer(name)))
  }

  @Post('bulk/control')
  controlBulk(@Body() dto: BulkDockerControlDto) {
    const uniqueTargets = Array.from(
      new Map(dto.targets.map((target) => [`${target.serverName}:${target.containerId}`, target])).values(),
    )
    return this.dockerService.controlBulk(
      uniqueTargets.map((target) => ({
        server: this.getServer(target.serverName),
        containerId: target.containerId,
      })),
      dto.action,
    )
  }

  @Get(':name/containers')
  listContainers(@Param('name') name: string) {
    return this.dockerService.listContainers(this.getServer(name))
  }

  @Post(':name/containers/:id/:action')
  control(
    @Param('name') name: string,
    @Param('id') id: string,
    @Param('action') action: 'start' | 'stop' | 'restart',
  ) {
    return this.dockerService.control(this.getServer(name), action, id)
  }

  @Post(':name/prune/:type')
  prune(@Param('name') name: string, @Param('type') type: 'images' | 'system') {
    return this.dockerService.prune(this.getServer(name), type)
  }

  @Post(':name/remnanode/update')
  async updateRemnanode(@Param('name') name: string) {
    const out = await this.dockerService.runCmd(
      this.getServer(name),
      'cd /opt/remnanode && docker compose pull && docker compose up -d 2>&1',
    )
    return { ok: true, output: out }
  }
}
