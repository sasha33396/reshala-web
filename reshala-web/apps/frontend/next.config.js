/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@reshala-web/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
