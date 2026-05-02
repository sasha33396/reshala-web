import { Module } from '@nestjs/common'
import { FleetModule } from '../fleet/fleet.module'
import { CloudflareNodesController } from './cloudflare-nodes.controller'
import { CloudflareNodesService } from './cloudflare-nodes.service'

@Module({
  imports: [FleetModule],
  providers: [CloudflareNodesService],
  controllers: [CloudflareNodesController],
})
export class CloudflareNodesModule {}
