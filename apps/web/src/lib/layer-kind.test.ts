import { describe, expect, test } from 'bun:test'
import { imageTemplate, TEMPLATE_DEFAULTS } from '#/lib/element-templates'
import { layerKind } from '#/lib/layer-kind'

describe('layerKind', () => {
  test('detects insert-tool templates', () => {
    expect(layerKind({ code: TEMPLATE_DEFAULTS.text.code, name: 'Text' })).toBe('text')
    expect(layerKind({ code: TEMPLATE_DEFAULTS.box.code, name: 'Box' })).toBe('box')
    expect(layerKind({ code: TEMPLATE_DEFAULTS.image.code, name: 'Image' })).toBe('image')
    expect(layerKind({ code: imageTemplate('/api/asset/x'), name: 'Photo' })).toBe('image')
  })

  test('detects JSX apps and snippets', () => {
    expect(
      layerKind({ code: 'function App() { return <button>Hi</button> }', name: 'App' }),
    ).toBe('jsx')
    expect(layerKind({ code: '<Card className="p-4" />', name: 'Card' })).toBe('jsx')
  })

  test('falls back to html for markup', () => {
    expect(
      layerKind({
        code: '<section class="grid gap-2"><button>Save</button></section>',
        name: 'Form',
      }),
    ).toBe('html')
  })
})
