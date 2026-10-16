import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  // Le premier chargement de chaque worker est lent sur les runners Windows de la CI.
  expect: { timeout: 10000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run web:build && npm run web:preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
})
