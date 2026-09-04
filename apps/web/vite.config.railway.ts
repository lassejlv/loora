import { readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Rollback build for the existing Railway/Bun deployment. Keep this isolated
// from the default Vite config so a normal build exercises workerd semantics.
function txtAsText(): Plugin {
  return {
    name: 'loora:txt-as-text',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('.txt')) return null
      const content = await readFile(id.split('?')[0], 'utf8')
      return `export default ${JSON.stringify(content)}`
    },
  }
}

export default defineConfig({
  build: {
    rolldownOptions: {
      external: ['bun'],
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    txtAsText(),
    devtools(),
    tailwindcss(),
    tanstackStart({ router: { quoteStyle: 'single' } }),
    nitro({ preset: 'bun' }),
    viteReact(),
  ],
})
