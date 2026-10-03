import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/qa/browser-results.json' }]],
  outputDir: 'artifacts/qa/browser',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1366, height: 768 },
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), chromiumSandbox: true },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      VITE_ELISA_DEV_BRIDGE: '1',
      MPLCONFIGDIR: process.env.MPLCONFIGDIR || '/tmp/elisa-qa-matplotlib',
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '/tmp/elisa-qa-cache',
    },
  },
})
