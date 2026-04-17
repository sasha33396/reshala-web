import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  HttpCode,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common'
import { IsString } from 'class-validator'
import { Response } from 'express'
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
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.authService.login(dto.password)
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
