import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createStandardSchemaV1, parseAsString, useQueryStates } from 'nuqs'
import { authClient } from '@loora/auth/client'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import { CodeEditorPanel } from '#/components/code-editor-panel'
import { classifyCode, ElementFrame, type FrameTextEdit } from '#/components/element-frame'
import { ImagePickerDialog } from '#/components/image-picker-dialog'
import { pickBlockPageElement } from '#/lib/block-page'
import { StyleEditorPanel } from '#/components/style-editor-panel'
import {
  applyTextEdits,
  insertNodeMarkup,
  moveNodeMarkup,
  NEW_SECTION_MARKUP,
  onlyCodeElements,
  removeNodeMarkup,
  replaceClassValue,
  replaceImageSource,
  type CanvasElement,
} from '#/lib/canvas'
import { hasStoredElements, loadElements, saveElements } from '#/lib/docs'

// Fullscreen preview of a single canvas element ("page"), outside the editor.
// The element renders interactive at viewport size, so responsive page code
// reflows like a real site instead of the fixed frame it has on the canvas.
// The Code toggle opens a Monaco pane: typing live-previews into the frame
// (last-good rendering keeps broken drafts harmless), Apply persists to
// localStorage and the server.

const blockPageSearchParams = {
  element: parseAsString,
}

export const Route = createFileRoute('/blockpage/$designId')({
  component: BlockPage,
  ssr: false,
  validateSearch: createStandardSchemaV1(blockPageSearchParams, { partialOutput: true }),
})

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; name: string | null; elements: CanvasElement[] }

type PreviewWidth = 'full' | 'desktop' | 'tablet' | 'phone'

const PREVIEW_WIDTHS: Record<PreviewWidth, number | null> = {
  full: null,
  desktop: 1280,
  tablet: 768,
  phone: 390,
}

const PREVIEW_LABELS: Record<PreviewWidth, string> = {
  full: 'Full',
  desktop: 'Desktop',
  tablet: 'Tablet',
  phone: 'Phone',
}

function BlockPage() {
  const { designId } = Route.useParams()
  const { data: session, isPending } = authClient.useSession()
  const [{ element: elementParam }, setSearch] = useQueryStates(blockPageSearchParams, {
    history: 'replace',
  })
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [renderError, setRenderError] = useState<string | null>(null)
  // Responsive preview: constrain the frame to a device width so page code
  // reflows like it would on that screen. 'full' = the browser viewport.
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>('full')
  // Code editing: draft live-previews into the frame; Apply persists.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const draftTimer = useRef<number | null>(null)
  const savedTimer = useRef<number | null>(null)
  // Inline text editing: click text in the page, type, commit with Enter/blur.
  const [textEditing, setTextEditing] = useState(false)
  // An image clicked in edit mode, waiting for a replacement asset.
  const [imagePickSrc, setImagePickSrc] = useState<string | null>(null)
  // A node right-clicked in edit mode, being styled.
  const [stylePick, setStylePick] = useState<{ tag: string; className: string; node: string } | null>(null)
  const [editNotice, setEditNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | null>(null)
  // Bumped to remount the frame when an inline edit could not be mapped onto
  // the code — the frame DOM has the typed text, the code does not.
  const [frameNonce, setFrameNonce] = useState(0)
  // Public 12h link for the active element; null = not published.
  const [publish, setPublish] = useState<{ id: string; expiresAt: number } | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    // Same-device tabs read the localStorage copy: the editor writes it on
    // every mutation, while the server save lags behind a 1500ms debounce.
    const cacheOwner = localStorage.getItem('loora:cache-user')
    const cacheUsable = !cacheOwner || cacheOwner === userId
    if (cacheUsable && hasStoredElements(designId)) {
      setState({ status: 'ready', name: null, elements: loadElements(designId) })
      return
    }
    let cancelled = false
    orpc.design
      .get({ id: designId })
      .then((doc) => {
        if (cancelled) return
        setState({ status: 'ready', name: doc.name, elements: onlyCodeElements(doc.shapes) })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Failed to load the design.'
        setState({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [userId, designId])

  const elements = state.status === 'ready' ? state.elements : []
  const active = useMemo(
    () => pickBlockPageElement(elements, elementParam),
    [elements, elementParam],
  )

  useEffect(() => {
    const name = state.status === 'ready' ? state.name : null
    document.title = active ? `${active.name || name || 'Page'} — loora` : 'loora'
  }, [active, state])

  // Switching element (or leaving edit mode) drops any unapplied draft.
  const activeId = active?.id ?? null

  // Pick up an existing live link for this element (e.g. published earlier or
  // from another tab) so the button reflects reality.
  useEffect(() => {
    if (!userId || !activeId) return
    let cancelled = false
    setPublish(null)
    setPublishOpen(false)
    orpc.publish
      .list({ designId })
      .then((links) => {
        if (cancelled) return
        const found = links.find((link) => link.elementId === activeId)
        setPublish(found ? { id: found.id, expiresAt: found.expiresAt } : null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId, designId, activeId])
  useEffect(() => {
    setDraft(null)
    setRenderError(null)
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
  }, [activeId, editing])

  useEffect(
    () => () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    },
    [],
  )

  const showEditNotice = (message: string) => {
    setEditNotice(message)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setEditNotice(null), 6000)
  }

  // Live preview: debounce keystrokes so the frame recompiles at most ~3x/s.
  const onDraftChange = (code: string) => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => setDraft(code), 300)
  }

  const applyCode = (code: string) => {
    if (state.status !== 'ready' || !active) return
    const nextElements = state.elements.map((el) => (el.id === active.id ? { ...el, code } : el))
    setState({ ...state, elements: nextElements })
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    setDraft(null)
    // Same cache-ownership rule as the load path: never write another user's cache.
    const cacheOwner = localStorage.getItem('loora:cache-user')
    if (!cacheOwner || cacheOwner === userId) saveElements(designId, nextElements)
    setSaveState('saving')
    void (async () => {
      try {
        // The localStorage load path doesn't know the design name and
        // design.save requires one; resolve it once from the server.
        const name = state.name ?? (await orpc.design.get({ id: designId })).name
        if (state.name === null) {
          setState((s) => (s.status === 'ready' ? { ...s, name } : s))
        }
        await orpc.design.save({ id: designId, name, shapes: nextElements })
        setSaveState('saved')
        if (savedTimer.current) window.clearTimeout(savedTimer.current)
        savedTimer.current = window.setTimeout(() => setSaveState('idle'), 2000)
      } catch (error) {
        console.error('[blockpage] Failed to save code:', error)
        setSaveState('error')
      }
    })()
  }

  // Inline edits arrive as before/after text pairs; anything unmappable
  // reverts the frame and points at the code editor.
  const onTextEdit = (edits: FrameTextEdit[]) => {
    if (state.status !== 'ready' || !active) return
    const result = applyTextEdits(active.code, edits)
    if (!result.ok) {
      setFrameNonce((n) => n + 1)
      showEditNotice('Could not map that edit onto the code (the text may repeat or be generated). Use the Code editor instead.')
      return
    }
    applyCode(result.code)
  }

  const structural = active ? classifyCode(active.code) === 'html' : false

  const onStylePick = (pick: { tag: string; className: string; node: string }) => {
    if (!pick.className && !structural) {
      showEditNotice('That part has no classes to edit — style it via the Code editor or the agent.')
      return
    }
    setStylePick(pick)
  }

  const applyStyle = (prev: string, next: string) => {
    if (state.status !== 'ready' || !active || !stylePick) return
    const result = replaceClassValue(active.code, prev, next)
    if (!result.ok) {
      setStylePick(null)
      showEditNotice('Could not find those classes in the code (they may be generated). Use the Code editor instead.')
      return
    }
    applyCode(result.code)
    const nodeNext = replaceClassValue(stylePick.node, prev, next)
    setStylePick({ ...stylePick, className: next, node: nodeNext.ok ? nodeNext.code : stylePick.node })
  }

  // Structural actions close the panel — the captured markup is stale after.
  const applyStructure = (
    mutate: (code: string, node: string) => ReturnType<typeof removeNodeMarkup>,
  ) => {
    const pick = stylePick
    setStylePick(null)
    if (!pick || state.status !== 'ready' || !active) return
    const result = mutate(active.code, pick.node)
    if (!result.ok) {
      showEditNotice('Could not map that change onto the code. Use the Code editor or ask the agent instead.')
      return
    }
    applyCode(result.code)
  }

  const onNodeMove = (move: { node: string; anchor: string; position: 'before' | 'after' }) => {
    if (state.status !== 'ready' || !active) return
    if (classifyCode(active.code) !== 'html') {
      showEditNotice('Drag-reorder works in HTML blocks — this block is React code; ask the agent to move it.')
      return
    }
    const result = moveNodeMarkup(active.code, move.node, move.anchor, move.position)
    if (!result.ok) {
      showEditNotice('Could not map that move onto the code. Use the Code editor or ask the agent instead.')
      return
    }
    applyCode(result.code)
  }

  const publishPage = async () => {
    if (!active || publishBusy) return
    setPublishBusy(true)
    try {
      const created = await orpc.publish.create({ designId, elementId: active.id })
      setPublish(created)
      setPublishOpen(true)
    } catch {
      showEditNotice('Could not publish the page. Try again.')
    } finally {
      setPublishBusy(false)
    }
  }

  const unpublishPage = async () => {
    if (!publish || publishBusy) return
    setPublishBusy(true)
    try {
      await orpc.publish.delete({ id: publish.id })
      setPublish(null)
      setPublishOpen(false)
    } catch {
      showEditNotice('Could not delete the link. Try again.')
    } finally {
      setPublishBusy(false)
    }
  }

  const copyPublishUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      showEditNotice('Could not copy — select the URL manually.')
    }
  }

  const replaceImage = (assetId: string) => {
    const src = imagePickSrc
    setImagePickSrc(null)
    if (!src || state.status !== 'ready' || !active) return
    const result = replaceImageSource(active.code, src, `/api/asset/${assetId}`)
    if (!result.ok) {
      showEditNotice('Could not find that image in the code — it may be generated. Use the Code editor instead.')
      return
    }
    applyCode(result.code)
  }

  if (isPending || (userId && state.status === 'loading')) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Loading page…</p>
      </main>
    )
  }

  if (!session) {
    return (
      <CenteredNotice message="Sign in to view this page.">
        <Button variant="outline" size="sm" render={<Link to="/" />}>
          Go to loora
        </Button>
      </CenteredNotice>
    )
  }

  if (state.status === 'error') {
    return (
      <CenteredNotice message={state.message}>
        <Button variant="outline" size="sm" render={<Link to="/" search={{ d: designId }} />}>
          Open in editor
        </Button>
      </CenteredNotice>
    )
  }

  if (!active) {
    return (
      <CenteredNotice message="Nothing on this canvas yet.">
        <Button variant="outline" size="sm" render={<Link to="/" search={{ d: designId }} />}>
          Open in editor
        </Button>
      </CenteredNotice>
    )
  }

  const width = PREVIEW_WIDTHS[previewWidth]

  return (
    <main className="fixed inset-0 flex flex-col bg-white sm:flex-row">
      {editing && (
        <div className="flex h-1/2 w-full min-w-0 flex-col border-b sm:h-full sm:w-[min(560px,45vw)] sm:border-r sm:border-b-0">
          <CodeEditorPanel
            key={active.id}
            element={active}
            onApply={applyCode}
            onDraftChange={onDraftChange}
            onClose={() => setEditing(false)}
          />
        </div>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden">
        <div
          className={width ? 'h-full border-x bg-white shadow-sm' : 'h-full w-full'}
          style={width ? { width, maxWidth: '100%' } : undefined}
        >
          <ElementFrame
            key={`${active.id}:${frameNonce}`}
            elementId={active.id}
            code={draft ?? active.code}
            interactive
            textEditable={textEditing}
            onError={setRenderError}
            onTextEdit={onTextEdit}
            onImagePick={setImagePickSrc}
            onStylePick={onStylePick}
            onNodeMove={onNodeMove}
          />
        </div>
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-full border bg-card/85 py-1.5 pr-1.5 pl-3 shadow-sm backdrop-blur transition-opacity hover:opacity-100 sm:opacity-60">
          <div className="flex items-center gap-0.5" role="group" aria-label="Preview width">
            {(Object.keys(PREVIEW_WIDTHS) as PreviewWidth[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={previewWidth === key}
                title={
                  PREVIEW_WIDTHS[key] ? `${PREVIEW_LABELS[key]} · ${PREVIEW_WIDTHS[key]}px` : PREVIEW_LABELS[key]
                }
                className={
                  previewWidth === key
                    ? 'rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium'
                    : 'rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
                }
                onClick={() => setPreviewWidth(key)}
              >
                {PREVIEW_LABELS[key]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={textEditing}
            title="Click text to edit it, click an image to swap it, right-click anything for styles"
            className={
              textEditing
                ? 'rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium'
                : 'rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
            }
            onClick={() => setTextEditing((v) => !v)}
          >
            Edit text
          </button>
          <button
            type="button"
            aria-pressed={editing}
            title="Edit this element's code"
            className={
              editing
                ? 'rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium'
                : 'rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
            }
            onClick={() => setEditing((v) => !v)}
          >
            Code
          </button>
          <button
            type="button"
            aria-pressed={publishOpen}
            title={publish ? 'Live link active — manage it' : 'Create a public link (expires in 12h)'}
            className={
              publish
                ? 'rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium'
                : 'rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
            }
            onClick={() => {
              if (publish) setPublishOpen((v) => !v)
              else void publishPage()
            }}
          >
            {publishBusy ? 'Publishing…' : publish ? 'Live' : 'Publish'}
          </button>
          {saveState !== 'idle' && (
            <span
              className={
                saveState === 'error'
                  ? 'text-[11px] text-destructive-foreground'
                  : 'text-[11px] text-muted-foreground'
              }
              role="status"
            >
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed'}
            </span>
          )}
          {elements.length > 1 ? (
            <select
              aria-label="Element"
              className="max-w-40 truncate bg-transparent text-xs font-medium outline-none"
              value={active.id}
              onChange={(e) => void setSearch({ element: e.target.value })}
            >
              {elements.map((el) => (
                <option key={el.id} value={el.id}>
                  {el.name || el.id}
                </option>
              ))}
            </select>
          ) : (
            <span className="max-w-40 truncate text-xs font-medium">{active.name || 'Page'}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-6 rounded-full px-2.5 text-xs"
            render={<Link to="/" search={{ d: designId }} />}
          >
            Editor
          </Button>
        </div>
        {publish && publishOpen ? (
          <div className="absolute top-14 right-3 z-10 flex w-80 max-w-[calc(100vw-24px)] flex-col gap-2 rounded-xl border bg-card p-3 shadow-md">
            <p className="text-xs font-medium">Live link</p>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={`${window.location.origin}/p/${publish.id}`}
                onFocus={(e) => e.currentTarget.select()}
                className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => void copyPublishUrl(`${window.location.origin}/p/${publish.id}`)}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Anyone with the link can view · expires in{' '}
                {Math.max(1, Math.round((publish.expiresAt - Date.now()) / 3_600_000))}h
              </p>
              <button
                type="button"
                disabled={publishBusy}
                className="text-[11px] font-medium text-destructive-foreground hover:underline disabled:opacity-50"
                onClick={() => void unpublishPage()}
              >
                Delete link
              </button>
            </div>
          </div>
        ) : null}
        {imagePickSrc ? (
          <ImagePickerDialog
            onPick={(asset) => replaceImage(asset.id)}
            onClose={() => setImagePickSrc(null)}
          />
        ) : null}
        {stylePick ? (
          <StyleEditorPanel
            key={stylePick.tag}
            tag={stylePick.tag}
            className={stylePick.className}
            canStructure={!!stylePick.node && structural}
            onApply={applyStyle}
            onAddSection={(position) =>
              applyStructure((code, node) => insertNodeMarkup(code, node, NEW_SECTION_MARKUP, position))
            }
            onDuplicate={() => applyStructure((code, node) => insertNodeMarkup(code, node, node, 'after'))}
            onDelete={() => applyStructure((code, node) => removeNodeMarkup(code, node))}
            onClose={() => setStylePick(null)}
          />
        ) : null}
        {renderError || editNotice ? (
          <div className="absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-4">
            {renderError ? (
              <p
                role="alert"
                className="max-w-xl truncate rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive-foreground shadow-sm"
              >
                {renderError}
              </p>
            ) : null}
            {editNotice ? (
              <p
                role="status"
                className="max-w-xl rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm"
              >
                {editNotice}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  )
}

function CenteredNotice({
  message,
  children,
}: {
  message: string
  children?: React.ReactNode
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-cx-canvas">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-5 py-4 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">{message}</p>
        {children}
      </div>
    </main>
  )
}
