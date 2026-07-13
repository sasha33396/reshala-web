import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  HttpCode,
  UseGuards,
  Req,
} from '@nestjs/common'
import { IsString } from 'class-validator'
import { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'

class LoginDto {
  @IsString()
  password!: string
}

const COOKIE_TTL_MS = 24 * 60 * 60 * 1000

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const forwarded = req.headers['x-forwarded-for']
    const clientId = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || req.ip
    const token = await this.authService.login(dto.password, clientId)
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_TTL_MS,
    })
    return { ok: true }
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token')
    return { ok: true }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me() {
    return { authenticated: true }
  }
}
