import { Module } from '@nestjs/common'
import { FleetModule } from './fleet/fleet.module'
import { PluginsModule } from './plugins/plugins.module'
import { TerminalModule } from './terminal/terminal.module'
import { MetricsModule } from './metrics/metrics.module'
import { AuthModule } from './auth/auth.module'

@Module({
  imports: [AuthModule, FleetModule, PluginsModule, TerminalModule, MetricsModule],
})
export class AppModule {}
