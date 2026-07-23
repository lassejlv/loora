import { readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Bun imports .txt as its string content (`with { type: 'text' }`), but Vite's
// default asset pipeline turns the same import into a URL, silently replacing
// the agent prompt with "/assets/agent-prompt-*.txt". Inline the content here
// so both runtimes agree.
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

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    txtAsText(),
    devtools(),
    tailwindcss(),
    tanstackStart({ router: { quoteStyle: "single" }}),
    nitro({ preset: 'bun' }),
    viteReact(),
  ],
})

export default config
