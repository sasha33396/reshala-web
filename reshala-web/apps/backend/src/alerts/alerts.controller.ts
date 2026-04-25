import { Controller, Get, Put, Post, Delete, Body, UseGuards } from '@nestjs/common'
import { AlertsService, AlertsConfig } from './alerts.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('config')
  getConfig() {
    return this.alerts.getConfig()
  }

  @Put('config')
  saveConfig(@Body() body: AlertsConfig) {
    this.alerts.saveConfig(body)
    return { ok: true }
  }

  @Post('test')
  sendTest() {
    return this.alerts.sendTestNotification()
  }

  @Post('check')
  runCheck() {
    return this.alerts.runCheck()
  }

  @Get('history')
  getHistory() {
    return this.alerts.getHistory()
  }

  @Delete('history')
  clearHistory() {
    this.alerts.clearHistory()
    return { ok: true }
  }
}
