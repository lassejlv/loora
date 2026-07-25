import { useMemo, useState } from 'react'
import { registerCustomTheme } from '@pierre/diffs'
import { MultiFileDiff } from '@pierre/diffs/react'
import { ChevronDownIcon } from '#/components/icons'
import type { CanvasElement } from '#/lib/canvas'
import { diffCanvas, type ElementChange } from '#/lib/canvas-diff'
import { useIsDarkTheme } from '#/lib/theme'
import { cn } from '#/lib/utils'

// Match the Monaco themes and the canvas surfaces so a diff never drops into
// GitHub chrome — and never renders a light slab inside the dark app.
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
    { scope: ['entity.name.tag'], settings: { foreground: '#b45309' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#7c3aed' } },
  ],
}))

registerCustomTheme('loora-dark', async () => ({
  name: 'loora-dark',
  type: 'dark',
  colors: {
    'editor.background': '#15161b',
    'editor.foreground': '#e9eaee',
    'editor.lineHighlightBackground': '#ffffff08',
    'editor.selectionBackground': '#738af440',
    'editor.inactiveSelectionBackground': '#738af422',
    'editorCursor.foreground': '#738af4',
    'editorLineNumber.foreground': '#5b5f6b',
    'editorLineNumber.activeForeground': '#9a9eab',
    'editorIndentGuide.background1': '#ffffff10',
    'editorWidget.background': '#1c1e24',
    'editorWidget.border': '#ffffff14',
    'diffEditor.insertedLineBackground': '#34d39920',
    'diffEditor.insertedTextBackground': '#34d39938',
    'diffEditor.removedLineBackground': '#f8717120',
    'diffEditor.removedTextBackground': '#f8717138',
    'diffEditor.diagonalFill': '#ffffff0a',
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#6f7381' } },
    { scope: ['string'], settings: { foreground: '#5eead4' } },
    { scope: ['constant.numeric', 'constant.language'], settings: { foreground: '#fbbf24' } },
    {
      scope: ['meta.structure.dictionary.json string.quoted.double.json'],
      settings: { foreground: '#93a5f7' },
    },
    { scope: ['keyword', 'storage.type', 'storage.modifier'], settings: { foreground: '#c4b5fd' } },
    { scope: ['punctuation', 'meta.brace'], settings: { foreground: '#8b8f9c' } },
    { scope: ['support.type.property-name', 'variable'], settings: { foreground: '#e9eaee' } },
    { scope: ['entity.name.tag'], settings: { foreground: '#fbbf24' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#c4b5fd' } },
  ],
}))

// Highlighting every hunk up front stalls a large merge; sections past this
// point start collapsed and render their diff on first open.
const AUTO_OPEN_SECTIONS = 6

const KIND_LABEL: Record<ElementChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
}

const KIND_STYLE: Record<ElementChange['kind'], string> = {
  added: 'bg-success/12 text-success-foreground',
  removed: 'bg-destructive/12 text-destructive-foreground',
  changed: 'bg-muted text-muted-foreground',
}

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
  const dark = useIsDarkTheme()
  const diff = useMemo(() => diffCanvas(oldShapes, newShapes), [oldShapes, newShapes])

  return (
    <div
      key={`${oldKey}:${newKey}`}
      className="h-full space-y-3 overflow-auto overscroll-contain bg-background p-4 text-sm"
    >
      {diff.orderChanged ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Layer order changed.
        </p>
      ) : null}

      {diff.changes.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {diff.orderChanged ? 'No element content changed.' : 'No changes.'}
        </p>
      ) : (
        diff.changes.map((change, index) => (
          <ElementDiffSection
            key={`${change.kind}:${change.id}`}
            change={change}
            dark={dark}
            defaultOpen={index < AUTO_OPEN_SECTIONS}
            cacheKey={`${oldKey}:${newKey}:${change.id}`}
          />
        ))
      )}
    </div>
  )
}

function ElementDiffSection({
  change,
  dark,
  defaultOpen,
  cacheKey,
}: {
  change: ElementChange
  dark: boolean
  defaultOpen: boolean
  cacheKey: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const expandable = change.codeChanged
  const filename = `${change.name || 'element'}.${change.lang === 'tsx' ? 'tsx' : 'html'}`

  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="flex items-center gap-2 bg-muted/40 px-3 py-2">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDownIcon
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
                !open && '-rotate-90',
              )}
            />
            <SectionLabel change={change} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 ps-[1.375rem]">
            <SectionLabel change={change} />
          </div>
        )}
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            KIND_STYLE[change.kind],
          )}
        >
          {KIND_LABEL[change.kind]}
        </span>
      </header>

      {change.geometry ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{change.geometry}</p>
      ) : null}

      {expandable && open ? (
        <div className="border-t font-mono text-[12px]">
          <MultiFileDiff
            oldFile={{
              name: filename,
              contents: change.oldCode,
              lang: change.lang,
              cacheKey: `${cacheKey}:old`,
            }}
            newFile={{
              name: filename,
              contents: change.newCode,
              lang: change.lang,
              cacheKey: `${cacheKey}:new`,
            }}
            options={{
              diffStyle: 'unified',
              diffIndicators: 'classic',
              lineDiffType: 'word',
              overflow: 'wrap',
              theme: dark ? 'loora-dark' : 'loora-light',
              themeType: dark ? 'dark' : 'light',
            }}
          />
        </div>
      ) : null}
    </section>
  )
}

function SectionLabel({ change }: { change: ElementChange }) {
  return (
    <>
      <span className="truncate font-medium">{change.name || 'Untitled element'}</span>
      {!change.codeChanged ? (
        <span className="shrink-0 text-xs text-muted-foreground">geometry only</span>
      ) : null}
    </>
  )
}
