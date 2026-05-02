import { Module } from '@nestjs/common'
import { FleetModule } from './fleet/fleet.module'
import { PluginsModule } from './plugins/plugins.module'
import { TerminalModule } from './terminal/terminal.module'
import { MetricsModule } from './metrics/metrics.module'
import { AuthModule } from './auth/auth.module'
import { DockerModule } from './docker/docker.module'
import { AlertsModule } from './alerts/alerts.module'
import { RemnawaveModule } from './remnawave/remnawave.module'
import { CloudflareNodesModule } from './cloudflare-nodes/cloudflare-nodes.module'
import { HealthController } from './health.controller'

@Module({
  imports: [AuthModule, FleetModule, PluginsModule, TerminalModule, MetricsModule, DockerModule, AlertsModule, RemnawaveModule, CloudflareNodesModule],
  controllers: [HealthController],
})
export class AppModule {}
