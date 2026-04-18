import { Module } from '@nestjs/common'
import { MetricsService } from './metrics.service'
import { MetricsController, InternalController } from './metrics.controller'
import { FleetModule } from '../fleet/fleet.module'

@Module({
  imports: [FleetModule],
  providers: [MetricsService],
  controllers: [MetricsController, InternalController],
  exports: [MetricsService],
})
export class MetricsModule {}
