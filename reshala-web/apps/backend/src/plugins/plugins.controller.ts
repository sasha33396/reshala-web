import { Controller, Get, Param, NotFoundException, UseGuards } from '@nestjs/common'
import { PluginsService } from './plugins.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@UseGuards(JwtAuthGuard)
@Controller('plugins')
export class PluginsController {
  constructor(private readonly pluginsService: PluginsService) {}

  @Get()
  getAll() {
    return this.pluginsService.scanPlugins()
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    const plugin = this.pluginsService.getById(id)
    if (!plugin) throw new NotFoundException(`Plugin "${id}" not found`)
    return plugin
  }
}
