import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'py -m http.server 4173 -d src',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
})
