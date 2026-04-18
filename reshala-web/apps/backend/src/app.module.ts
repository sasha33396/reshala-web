import { Module } from '@nestjs/common'
import { FleetModule } from './fleet/fleet.module'
import { PluginsModule } from './plugins/plugins.module'
import { TerminalModule } from './terminal/terminal.module'
import { MetricsModule } from './metrics/metrics.module'
import { AuthModule } from './auth/auth.module'
import { DockerModule } from './docker/docker.module'

@Module({
  imports: [AuthModule, FleetModule, PluginsModule, TerminalModule, MetricsModule, DockerModule],
})
export class AppModule {}
