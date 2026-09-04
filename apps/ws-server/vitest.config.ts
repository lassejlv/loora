import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          REALTIME_ALLOWED_ORIGINS: 'https://loora.design',
          REALTIME_INTERNAL_TOKEN: 't'.repeat(32),
          REALTIME_TICKET_SECRET: 's'.repeat(32),
          REALTIME_TICKET_SECRET_PREVIOUS: '',
        },
      },
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['tests/**/*.worker.ts'],
  },
})
