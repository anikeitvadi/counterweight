import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 45_000 },
  retries: 1,
  use: { baseURL: 'http://localhost:5181', viewport: { width: 1100, height: 900 } },
  webServer: { command: 'npx vite --port 5181 --strictPort', url: 'http://localhost:5181', reuseExistingServer: true, timeout: 60_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
