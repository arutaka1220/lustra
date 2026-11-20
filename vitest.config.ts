import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()], test: {
  environment: 'jsdom',
  include: ['vitest/**/*.test.ts', 'vitest/**/*.test.tsx'],
  exclude: ['node_modules/**', 'e2e/**', 'test-results/**', 'playwright-report/**', 'dist/**'],
  restoreMocks: true,
  clearMocks: true,
} })
