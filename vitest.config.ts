import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // 加载 .env 文件中的环境变量供测试使用
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    test: {
      globals: true,
      environment: 'node',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
      env: {
        DATABASE_URL: env.DATABASE_URL || 'postgresql://postgres:pg123456@localhost:5432/video_redesign',
        JWT_SECRET: env.JWT_SECRET || 'k9X2mP7vQ4wR8tY1nB6cH3jF5gL0sA9dW2xE4zU7iO6pN1qT8rK3yM5bJ0v',
        // 注：REDIS_URL 通过 .env 文件自动加载，不额外注入。
        // 若本机无 Redis，需将 .env 中 REDIS_URL 清空或删除，
        // 依赖 Redis 的集成测试会通过 skipIfNoInfra/skipIfNoRedis 自动跳过。
      },
      testTimeout: 30000,
      hookTimeout: 15000,
      coverage: {
        provider: 'v8',
        include: ['src/lib/**', 'src/types/**'],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
