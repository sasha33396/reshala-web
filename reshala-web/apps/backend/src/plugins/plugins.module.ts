import { Module } from '@nestjs/common'
import { ExecutorService } from './executor.service'
import { PluginsService } from './plugins.service'
import { PluginsController } from './plugins.controller'
import { PluginsGateway } from './plugins.gateway'
import { FleetModule } from '../fleet/fleet.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [FleetModule, AuthModule],
  providers: [ExecutorService, PluginsService, PluginsGateway],
  controllers: [PluginsController],
  exports: [ExecutorService, PluginsService],
})
export class PluginsModule {}
