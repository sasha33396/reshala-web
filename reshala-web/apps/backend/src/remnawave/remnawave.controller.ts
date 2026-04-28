import { Controller, Get, UseGuards } from '@nestjs/common'
import { RemnawaveService } from './remnawave.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@UseGuards(JwtAuthGuard)
@Controller('remnawave')
export class RemnawaveController {
  constructor(private readonly svc: RemnawaveService) {}

  @Get('nodes')
  getNodes() {
    return this.svc.getNodes()
  }

  @Get('status')
  getStatus() {
    return { configured: this.svc.isConfigured }
  }

  @Get('hosts')
  getHosts() {
    return this.svc.getHosts()
  }
}
