/** @type {import('next').NextConfig} */
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001/api'

const nextConfig = {
  transpilePackages: ['@reshala-web/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
