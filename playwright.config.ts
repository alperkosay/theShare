import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run two independent browser contexts ("devices") against
 * the production build and pair them with the copy/paste flow.
 *
 * Real devices exchange mDNS (.local) host candidates. Inside a CI sandbox
 * mDNS resolution is unreliable, so the tests disable the obfuscation and use
 * plain loopback/LAN IPs. Everything else (compact SDP, DTLS, SCTP, the
 * transfer protocol, sinks) runs exactly as in production.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
