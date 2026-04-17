import { Module } from '@nestjs/common'
import { TerminalGateway } from './terminal.gateway'
import { FleetModule } from '../fleet/fleet.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [FleetModule, AuthModule],
  providers: [TerminalGateway],
})
export class TerminalModule {}
