import { Module } from '@nestjs/common'
import { AlertsService } from './alerts.service'
import { AlertsController } from './alerts.controller'
import { FleetModule } from '../fleet/fleet.module'
import { MetricsModule } from '../metrics/metrics.module'

@Module({
  imports: [FleetModule, MetricsModule],
  providers: [AlertsService],
  controllers: [AlertsController],
  exports: [AlertsService],
})
export class AlertsModule {}
