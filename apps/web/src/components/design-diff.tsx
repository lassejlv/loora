import { registerCustomTheme } from '@pierre/diffs'
import { MultiFileDiff } from '@pierre/diffs/react'
import type { CanvasElement } from '#/lib/canvas'

// Match Monaco loora-light + warm paper canvas so version history doesn't
// drop into GitHub chrome.
registerCustomTheme('loora-light', async () => ({
  name: 'loora-light',
  type: 'light',
  colors: {
    'editor.background': '#fafaf8',
    'editor.foreground': '#1a1917',
    'editor.lineHighlightBackground': '#00000005',
    'editor.selectionBackground': '#2440e630',
    'editor.inactiveSelectionBackground': '#2440e618',
    'editorCursor.foreground': '#2440e6',
    'editorLineNumber.foreground': '#aaa7a0',
    'editorLineNumber.activeForeground': '#4f4c46',
    'editorIndentGuide.background1': '#0000000d',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#00000014',
    'diffEditor.insertedLineBackground': '#10b98118',
    'diffEditor.insertedTextBackground': '#10b98128',
    'diffEditor.removedLineBackground': '#ef444418',
    'diffEditor.removedTextBackground': '#ef444428',
    'diffEditor.diagonalFill': '#0000000a',
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#8a8680' } },
    { scope: ['string'], settings: { foreground: '#0f766e' } },
    { scope: ['constant.numeric', 'constant.language'], settings: { foreground: '#b45309' } },
    {
      scope: ['meta.structure.dictionary.json string.quoted.double.json'],
      settings: { foreground: '#2440e6' },
    },
    { scope: ['keyword', 'storage.type', 'storage.modifier'], settings: { foreground: '#7c3aed' } },
    { scope: ['punctuation', 'meta.brace'], settings: { foreground: '#75726b' } },
    { scope: ['support.type.property-name', 'variable'], settings: { foreground: '#1a1917' } },
  ],
}))

export function DesignDiff({
  oldShapes,
  newShapes,
  oldKey,
  newKey,
}: {
  oldShapes: CanvasElement[]
  newShapes: CanvasElement[]
  oldKey: string
  newKey: string
}) {
  return (
    <div
      key={`${oldKey}:${newKey}`}
      className="h-full overflow-auto overscroll-contain bg-[#fafaf8] p-4 font-mono text-[12px] text-[#1a1917]"
    >
      <MultiFileDiff
        oldFile={{
          name: 'design.json',
          contents: JSON.stringify(oldShapes, null, 2),
          lang: 'json',
          cacheKey: oldKey,
        }}
        newFile={{
          name: 'design.json',
          contents: JSON.stringify(newShapes, null, 2),
          lang: 'json',
          cacheKey: newKey,
        }}
        options={{
          diffStyle: 'unified',
          diffIndicators: 'classic',
          lineDiffType: 'word',
          overflow: 'wrap',
          theme: 'loora-light',
          themeType: 'light',
        }}
      />
    </div>
  )
}
