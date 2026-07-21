import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import type { BeforeMount, EditorProps, OnMount } from '@monaco-editor/react'
import type { CanvasElement } from '#/lib/canvas'
import { classifyCode } from '#/components/element-frame'
import { PanelShell } from '#/components/panel-shell'
import { Button } from '#/components/ui/button'

const MonacoEditor = lazy(async () => {
  await import('#/lib/monaco-editor')
  const { Editor } = await import('@monaco-editor/react')
  return { default: Editor }
})

const EDITOR_OPTIONS: NonNullable<EditorProps['options']> = {
  automaticLayout: true,
  ariaLabel: 'Element code',
  bracketPairColorization: { enabled: true },
  contextmenu: true,
  cursorBlinking: 'smooth',
  fixedOverflowWidgets: true,
  folding: true,
  fontFamily: "'Spline Sans Mono', ui-monospace, monospace",
  fontSize: 13,
  glyphMargin: false,
  guides: { bracketPairs: true, indentation: true },
  lineHeight: 21,
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  padding: { top: 12, bottom: 12 },
  renderLineHighlight: 'line',
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  tabSize: 2,
  wordWrap: 'on',
}

export function codeEditorLanguage(code: string): 'html' | 'typescript' {
  return classifyCode(code) === 'html' ? 'html' : 'typescript'
}

const configureEditor: BeforeMount = (monaco) => {
  monaco.editor.defineTheme('loora-light', {
    base: 'vs',
    inherit: true,
    rules: [],
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
      'editorIndentGuide.activeBackground1': '#00000026',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#00000014',
    },
  })
}

export function CodeEditorPanel({
  element,
  onApply,
  onDraftChange,
  onClose,
}: {
  element: CanvasElement
  onApply: (code: string) => void
  // Fires on every keystroke with the current draft — callers can debounce it
  // into a live preview while Apply stays the explicit persist step.
  onDraftChange?: (code: string) => void
  onClose?: () => void
}) {
  const [draft, setDraft] = useState(element.code)
  const applyRef = useRef(onApply)
  applyRef.current = onApply
  const draftChangeRef = useRef(onDraftChange)
  draftChangeRef.current = onDraftChange

  const dirty = draft !== element.code
  const language = useMemo(() => codeEditorLanguage(element.code), [element.code])
  const modelPath = `file:///loora/${element.id}.${language === 'html' ? 'html' : 'tsx'}`

  const handleMount = useCallback<OnMount>((editor, monaco) => {
    editor.addAction({
      id: 'loora.apply-element-code',
      label: 'Apply element code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => applyRef.current(editor.getValue()),
    })
    requestAnimationFrame(() => {
      editor.layout()
      editor.focus()
    })
  }, [])

  return (
    <PanelShell
      title="Code"
      description={
        <span className="font-mono">
          {element.name} · {element.w}×{element.h}
        </span>
      }
      onClose={onClose}
      actions={
        <Button size="xs" disabled={!dirty} onClick={() => onApply(draft)}>
          Apply
        </Button>
      }
      bodyClassName="gap-2 p-3"
    >
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-background ring-ring/24 focus-within:border-ring focus-within:ring-2">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center font-mono text-xs text-muted-foreground">
              Loading editor…
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            language={language}
            path={modelPath}
            theme="loora-light"
            value={draft}
            beforeMount={configureEditor}
            onMount={handleMount}
            onChange={(value) => {
              const next = value ?? ''
              setDraft(next)
              draftChangeRef.current?.(next)
            }}
            options={EDITOR_OPTIONS}
            loading={
              <div className="grid h-full place-items-center font-mono text-xs text-muted-foreground">
                Loading editor…
              </div>
            }
          />
        </Suspense>
      </div>

      <p className="text-[11px] text-muted-foreground">
        HTML/CSS/JS or JSX defining function App — Tailwind and React are available. ⌘⏎ applies.
      </p>
    </PanelShell>
  )
}
