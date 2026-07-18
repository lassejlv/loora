// Embedded Tailwind engine for frame HTML bodies. Agent-authored frames use
// normal Tailwind classes; twind compiles them at runtime, scoped to each
// frame's shadow root (the app's build-time Tailwind never sees this HTML).
import {
  cssom,
  defineConfig,
  extract,
  observe,
  twind,
  virtual,
  type Twind,
} from '@twind/core'
import presetAutoprefix from '@twind/preset-autoprefix'
import presetTailwind from '@twind/preset-tailwind'

const config = defineConfig({
  presets: [presetAutoprefix(), presetTailwind()],
})

// Live rendering: generate CSS into the shadow root and keep watching for
// class changes. Returns a destroy function.
export function mountFrameTailwind(root: ShadowRoot): () => void {
  const target = new CSSStyleSheet()
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, target]
  const tw = observe(twind(config, cssom(target)), root)
  return () => {
    tw.destroy()
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => sheet !== target)
  }
}

// Snapshot rendering: compile the classes in an HTML string to a CSS string
// so the frame body can be rasterized standalone inside <foreignObject>.
let extractTw: Twind<any, string[]> | undefined
export function frameCss(html: string): string {
  extractTw ??= twind(config, virtual())
  extractTw.clear()
  return extract(html, extractTw).css
}
