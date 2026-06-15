import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client-runtime-utils'],
  eslint: {
    // 生产构建时忽略 ESLint（开发时仍通过 IDE/npm run lint 检查）
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 类型检查已在 CI/开发时执行，构建时跳过以加速
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
