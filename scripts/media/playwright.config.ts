import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './scenes',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'list',
  outputDir: '../../.media-tmp/playwright',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: process.env.MEDIA_LANGUAGE === 'ja' ? 'ja-JP' : 'en-US',
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    launchOptions: { args: ['--hide-scrollbars'] },
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
