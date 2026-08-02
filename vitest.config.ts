import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./apps/web/src/test/setup.ts'],
    server: {
      deps: {
        inline: ['zod'],
      },
    },
  },
})
