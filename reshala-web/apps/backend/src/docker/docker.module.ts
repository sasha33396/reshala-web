import { Module } from '@nestjs/common'
import { DockerService } from './docker.service'
import { DockerController } from './docker.controller'
import { DockerGateway } from './docker.gateway'
import { FleetModule } from '../fleet/fleet.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [FleetModule, AuthModule],
  providers: [DockerService, DockerGateway],
  controllers: [DockerController],
})
export class DockerModule {}
