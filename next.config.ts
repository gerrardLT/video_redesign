import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', '@prisma/adapter-pg', '@prisma/client'],
  eslint: {
    // 生产构建时忽略 ESLint（开发时仍通过 IDE/npm run lint 检查）
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 类型检查已在 CI/开发时执行，构建时跳过以加速
    ignoreBuildErrors: true,
  },
  // P0 修复：添加 HTTP 安全响应头
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
