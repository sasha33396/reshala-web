import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, { count: number; blockedUntil: number }>()

  constructor(private readonly jwtService: JwtService) {}

  async login(password: string, clientId = 'unknown'): Promise<string> {
    const now = Date.now()
    const attempt = this.loginAttempts.get(clientId)
    if (attempt && attempt.blockedUntil > now) {
      throw new UnauthorizedException('Invalid password')
    }

    const hash = process.env.ADMIN_PASSWORD_HASH
    if (!hash) throw new UnauthorizedException('ADMIN_PASSWORD_HASH not configured')
    const valid = await bcrypt.compare(password, hash)
    if (!valid) {
      const count = (attempt?.count ?? 0) + 1
      this.loginAttempts.set(clientId, {
        count: count >= 5 ? 0 : count,
        blockedUntil: count >= 5 ? now + 15 * 60 * 1000 : 0,
      })
      throw new UnauthorizedException('Invalid password')
    }

    this.loginAttempts.delete(clientId)
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
