import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
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
})
