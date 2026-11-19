import { defineConfig, devices } from '@playwright/test'

const fileMode = process.env.LUSTRA_E2E_FILE_MODE === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    ...(fileMode ? {} : { baseURL: 'http://127.0.0.1:1420' }),
    launchOptions: fileMode ? { args: ['--allow-file-access-from-files'] } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  ...(fileMode ? {} : {
    webServer: {
      command: 'bun run dev',
      url: 'http://127.0.0.1:1420',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  }),
})
