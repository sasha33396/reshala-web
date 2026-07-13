const INSECURE_JWT_SECRETS = new Set([
  'changeme',
  'replace-with-openssl-rand-hex-32',
])

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim()
  if (!secret || secret.length < 32 || INSECURE_JWT_SECRETS.has(secret.toLowerCase())) {
    throw new Error('JWT_SECRET must be configured with at least 32 random characters')
  }
  return secret
}

export function validateAuthConfig(): void {
  getJwtSecret()

  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim()
  if (!passwordHash || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    throw new Error('ADMIN_PASSWORD_HASH must be configured with a valid bcrypt hash')
  }
}
