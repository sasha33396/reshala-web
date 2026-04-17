import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(password: string): Promise<string> {
    const hash = process.env.ADMIN_PASSWORD_HASH
    if (!hash) throw new UnauthorizedException('ADMIN_PASSWORD_HASH not configured')
    const valid = await bcrypt.compare(password, hash)
    if (!valid) throw new UnauthorizedException('Invalid password')
    return this.jwtService.sign({ sub: 'admin' })
  }

  verifyToken(token: string): { sub: string } | null {
    try {
      return this.jwtService.verify<{ sub: string }>(token)
    } catch {
      return null
    }
  }
}
