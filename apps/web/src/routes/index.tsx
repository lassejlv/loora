import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryStates } from 'nuqs'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  HandIcon,
  SettingsIcon,
  MessageSquarePlusIcon,
  LayersIcon,
  SparklesIcon,
  MaximizeIcon,
} from '#/components/icons'
import {
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignEndHorizontalIcon,
  AlignEndVerticalIcon,
  AlignHorizontalDistributeCenterIcon,
  AlignStartHorizontalIcon,
  AlignStartVerticalIcon,
  AlignVerticalDistributeCenterIcon,
  BringToFrontIcon,
  ClipboardPasteIcon,
  CodeXmlIcon,
  EllipsisIcon,
  MousePointer2Icon,
  MousePointerClickIcon,
  ImageIcon,
  Redo2Icon,
  ScissorsIcon,
  SendToBackIcon,
  SquareIcon,
  Undo2Icon,
  Trash2Icon,
  TypeIcon,
  GroupIcon,
  UngroupIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { Canvas, type CanvasControls, type Tool } from '#/components/canvas'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubPopup,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '#/components/ui/context-menu'
import {
  deleteDocStorage,
  docId,
  hasStoredElements,
  loadDocs,
  loadElements,
  saveDocs,
  saveElements,
  type DocMeta,
} from '#/lib/docs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { LayersPanel } from '#/components/layers-panel'
import { AssetsPanel, type AssetMeta } from '#/components/assets-panel'
import { SettingsPanel } from '#/components/settings-panel'
import { HistoryPopover } from '#/components/history-panel'
import { CodeEditorPanel } from '#/components/code-editor-panel'
import { deleteHistory } from '@loora/rpc/history'
import { snapshotCanvas } from '#/lib/snapshot'
import { AgentPanel } from '#/components/agent-panel'
import { ExportDialog } from '#/components/export-dialog'
import {
  WelcomeDialog,
  hasSeenWelcome,
  markWelcomeSeen,
} from '#/components/welcome-dialog'
import {
  applyElementPatches,
  elementId,
  reorderElements,
  type CanvasElement,
  type ElementActions,
  type ElementPatch,
} from '#/lib/canvas'
import { alignElements, distributeElements, type AlignEdge } from '#/lib/align'
import { imageTemplate } from '#/lib/element-templates'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { AuthScreen } from '#/components/auth-screen'
import { SubscriptionScreen } from '#/components/subscription-screen'
import { PreviewAccessScreen } from '#/components/preview-access-screen'
import { authClient } from '@loora/auth/client'
import { SidebarProvider } from '#/components/ui/sidebar'
import { orpc } from '#/lib/orpc-client'
import { Drawer, DrawerPopup } from '#/components/ui/drawer'
import { useIsMobile } from '#/hooks/use-media-query'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { fadeUp, uiTransition } from '#/lib/motion'
import {
  bootstrapEditorSearch,
  editorSearchParams,
  editorValidateSearch,
  readUrlDesignId,
  type SettingsTab,
} from '#/lib/url-state'
import {
  cacheShortcuts,
  formatBuiltInChord,
  isEditableTarget,
  loadCachedShortcuts,
  matchShortcut,
  normalizeConfig,
  shouldPreventDefault,
  type BuiltInShortcutId,
  type ShortcutConfig,
} from '#/lib/shortcuts'

export const Route = createFileRoute('/')({
  component: App,
  ssr: false,
  validateSearch: editorValidateSearch,
})

function App() {
  const { data: session, isPending } = authClient.useSession()
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome())

  if (isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-cx-canvas">
        <p className="cx-shimmer text-sm">Opening your canvas…</p>
      </main>
    )
  }

  if (!session) {
    return (
      <>
        <div aria-hidden="true" className="pointer-events-none select-none" inert>
          <Editor preview />
        </div>
        {welcomeOpen ? (
          <WelcomeDialog
            open
            onOpenChange={(open) => {
              if (!open) {
                markWelcomeSeen()
                setWelcomeOpen(false)
              }
            }}
          />
        ) : (
          <AuthScreen />
        )}
      </>
    )
  }

  return (
    <PreviewAccessScreen preview={<Editor preview />}>
      <SubscriptionScreen preview={<Editor preview />}>
        <Editor userId={session.user.id} />
      </SubscriptionScreen>
    </PreviewAccessScreen>
  )
}

function DocSwitcher({
  docs,
  activeId,
  onSwitch,
  onNew,
  onRename,
  onDelete,
}: {
  docs: DocMeta[]
  activeId: string
  onSwitch: (id: string) => void
  onNew: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const active = docs.find((d) => d.id === activeId)

  if (renaming) {
    return (
      <input
        autoFocus
        defaultValue={active?.name}
        className="pointer-events-auto w-40 rounded border bg-card px-1.5 py-0.5 text-sm outline-none"
        onBlur={(e) => {
          const name = e.target.value.trim()
          if (name) onRename(name)
          setRenaming(false)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
      />
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="pointer-events-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {active?.name ?? 'Untitled'}
            <ChevronDownIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="pointer-events-auto w-52">
          {docs.map((d) => (
            <DropdownMenuItem key={d.id} onClick={() => onSwitch(d.id)}>
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              {d.id === activeId && <CheckIcon className="size-3.5" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onNew}>New document</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            Delete document
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogPopup className="max-w-sm" bottomStickOnMobile={false}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              “{active?.name ?? 'Untitled'}” and its chats, history, and canvas will be removed. This
              can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                onDelete()
                setConfirmDelete(false)
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  )
}

const TOOLS: { tool: Tool; icon: ElementType; key: string; label: string }[] = [
  { tool: 'select', icon: MousePointer2Icon, key: 'v', label: 'Select' },
  { tool: 'interact', icon: MousePointerClickIcon, key: 'i', label: 'Interact' },
  { tool: 'comment', icon: MessageSquarePlusIcon, key: 'c', label: 'Comment' },
  { tool: 'text', icon: TypeIcon, key: 't', label: 'Text' },
  { tool: 'box', icon: SquareIcon, key: 'r', label: 'Box' },
  { tool: 'image', icon: ImageIcon, key: 'm', label: 'Image' },
  { tool: 'hand', icon: HandIcon, key: 'h', label: 'Hand' },
]

function Editor({ preview = false, userId }: { preview?: boolean; userId?: string }) {
  const cacheOwner = preview ? null : localStorage.getItem('loora:cache-user')
  const cacheOwnedByAnotherUser = Boolean(userId && cacheOwner && cacheOwner !== userId)
  const [{ docs, activeId }, setDocState] = useState(() => {
    if (preview) return { docs: [{ id: 'preview', name: 'Untitled' }], activeId: 'preview' }
    if (cacheOwnedByAnotherUser) {
      const id = docId()
      return { docs: [{ id, name: 'Untitled' }], activeId: id }
    }
    const loaded = loadDocs()
    const urlD = readUrlDesignId()
    if (urlD && loaded.docs.some((doc) => doc.id === urlD)) {
      return { docs: loaded.docs, activeId: urlD }
    }
    return loaded
  })
  const [shapes, setShapes] = useState<CanvasElement[]>(() =>
    preview || cacheOwnedByAnotherUser ? [] : loadElements(activeId),
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [databaseReady, setDatabaseReady] = useState(false)
  const [loadedDocId, setLoadedDocId] = useState<string | null>(() =>
    preview || (!cacheOwnedByAnotherUser && hasStoredElements(activeId)) ? activeId : null,
  )
  const [docLoading, setDocLoading] = useState(false)
  const [docLoadError, setDocLoadError] = useState<string | null>(null)
  const isMobile = useIsMobile()
  const [urlState, setUrlState] = useQueryStates(editorSearchParams, { history: 'replace' })
  const [previewChrome, setPreviewChrome] = useState({
    agent: true,
    layers: false,
    assets: false,
    history: false,
    code: false,
    settings: null as SettingsTab | null,
  })
  const urlSeeded = useRef(preview)
  // When UI switches docs, activeId updates before the URL; ignore URL→doc until they match.
  const localDesignRef = useRef<string | null>(null)

  const agentOpen = preview ? previewChrome.agent : urlState.agent
  const layersOpen = preview ? previewChrome.layers : urlState.layers
  const assetsOpen = preview ? previewChrome.assets : urlState.assets
  const historyOpen = preview ? previewChrome.history : urlState.history
  const codeOpen = preview ? previewChrome.code : urlState.code
  const settingsTab = preview ? previewChrome.settings : urlState.settings
  const settingsOpen = settingsTab != null

  const toggleLayers = (open: boolean) => {
    if (preview) {
      setPreviewChrome((s) => ({ ...s, layers: open, assets: open ? false : s.assets }))
      return
    }
    void setUrlState(open ? { layers: true, assets: false } : { layers: false })
    localStorage.setItem('loora:layers', open ? '1' : '0')
  }
  const toggleAssets = (open: boolean) => {
    if (preview) {
      setPreviewChrome((s) => ({ ...s, assets: open, layers: open ? false : s.layers }))
      return
    }
    void setUrlState(open ? { assets: true, layers: false } : { assets: false })
    if (open) localStorage.setItem('loora:layers', '0')
  }
  const toggleAgent = (open: boolean) => {
    if (preview) {
      setPreviewChrome((s) => ({ ...s, agent: open }))
      return
    }
    void setUrlState({ agent: open })
    localStorage.setItem('loora:agent', open ? '1' : '0')
  }
  const toggleHistory = (open: boolean) => {
    if (preview) {
      setPreviewChrome((s) => ({ ...s, history: open }))
      return
    }
    void setUrlState({ history: open })
  }
  const toggleCode = (open: boolean) => {
    if (preview) {
      setPreviewChrome((s) => ({ ...s, code: open }))
      return
    }
    void setUrlState({ code: open })
  }
  const setSettingsOpen = (open: boolean) => {
    if (preview) {
      setPreviewChrome((s) => ({ ...s, settings: open ? 'account' : null }))
      return
    }
    if (open) void setUrlState({ settings: settingsTab ?? 'account' })
    else void setUrlState({ settings: null, integration: null })
  }
  const [exportOpen, setExportOpen] = useState(false)
  const [agentWidth, setAgentWidth] = useState(() => {
    if (preview || typeof window === 'undefined') return 340
    const raw = Number(window.localStorage.getItem('loora:agent-width'))
    return Number.isFinite(raw) ? Math.min(640, Math.max(280, Math.round(raw))) : 340
  })
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>(() =>
    preview ? { overrides: {}, custom: [] } : loadCachedShortcuts(),
  )

  useEffect(() => {
    if (preview || urlSeeded.current) return
    urlSeeded.current = true
    const patch = bootstrapEditorSearch(activeId)
    if (Object.keys(patch).length > 0) void setUrlState(patch)
  }, [preview, activeId, setUrlState])

  useEffect(() => {
    if (preview) return
    let cancelled = false
    void orpc.preferences
      .get()
      .then((prefs) => {
        if (cancelled) return
        const next = normalizeConfig(prefs.shortcuts)
        setShortcutConfig(next)
        cacheShortcuts(next)
      })
      .catch((error) => console.error('[preferences] Failed to load shortcuts:', error))
    return () => {
      cancelled = true
    }
  }, [preview])

  const updateShortcutConfig = (next: ShortcutConfig) => {
    const normalized = normalizeConfig(next)
    setShortcutConfig(normalized)
    cacheShortcuts(normalized)
    void orpc.preferences
      .save({
        shortcuts: {
          overrides: normalized.overrides,
          custom: normalized.custom,
        },
      })
      .catch((error) => console.error('[preferences] Failed to save shortcuts:', error))
  }

  const shortcutLabel = (id: BuiltInShortcutId) => formatBuiltInChord(id, shortcutConfig)

  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const documentRequest = useRef(0)
  const documentMutationVersions = useRef(new Map<string, number>())
  const mutationsBlockedRef = useRef(false)
  mutationsBlockedRef.current = !preview && loadedDocId !== activeId
  const canvasControls = useRef<CanvasControls | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  // Bridge: canvas comment pins push messages straight into the agent chat.
  const agentSend = useRef<((text: string) => boolean) | null>(null)

  const fetchDocument = useCallback(async (id: string, cached: boolean) => {
    const request = ++documentRequest.current
    const mutationVersion = documentMutationVersions.current.get(id) ?? 0
    setDocLoading(true)
    setDocLoadError(null)
    if (!cached) setLoadedDocId(null)
    try {
      const remote = await orpc.design.get({ id })
      const changedWhileLoading = (documentMutationVersions.current.get(id) ?? 0) !== mutationVersion
      if (!changedWhileLoading) saveElements(id, remote.shapes)
      if (request !== documentRequest.current || activeIdRef.current !== id) return false
      if (!changedWhileLoading) setShapes(remote.shapes)
      setLoadedDocId(id)
      setDocLoading(false)
      return true
    } catch (error) {
      console.error('[designs] Failed to load design:', error)
      if (request !== documentRequest.current || activeIdRef.current !== id) return false
      if (cached) setLoadedDocId(id)
      setDocLoading(false)
      setDocLoadError(
        cached
          ? 'Could not refresh this document. Your saved local copy is still available.'
          : 'Could not load this document.',
      )
      return false
    }
  }, [])

  useEffect(() => {
    if (preview) return
    let cancelled = false

    const hydrateFromDatabase = async () => {
      try {
        const remote = await orpc.design.list()
        if (cancelled) return

        if (remote.length === 0) {
          await Promise.all(
            docs.map((doc) =>
              orpc.design.save({
                id: doc.id,
                name: doc.name,
                shapes: loadElements(doc.id),
              }),
            ),
          )
          if (!hasStoredElements(activeId)) saveElements(activeId, shapesRef.current)
          saveDocs(docs, activeId)
          setLoadedDocId(activeId)
        } else {
          const remoteDocs = remote.map(({ id, name }) => ({ id, name }))
          const urlD = readUrlDesignId()
          const nextActive =
            (urlD && remote.some((doc) => doc.id === urlD) && urlD) ||
            (remote.some((doc) => doc.id === activeId) ? activeId : remote[0].id)
          const cached = hasStoredElements(nextActive)
          saveDocs(remoteDocs, nextActive)
          activeIdRef.current = nextActive
          setDocState({ docs: remoteDocs, activeId: nextActive })
          if (!preview) {
            localDesignRef.current = nextActive
            void setUrlState({ d: nextActive })
          }
          setShapes(cached ? loadElements(nextActive) : [])
          setLoadedDocId(cached ? nextActive : null)
          setSelectedIds([])
          await fetchDocument(nextActive, cached)
        }

        if (!cancelled) {
          if (userId) localStorage.setItem('loora:cache-user', userId)
          setDatabaseReady(true)
        }
      } catch (error) {
        console.error('[designs] Failed to load designs:', error)
      }
    }

    void hydrateFromDatabase()
    return () => {
      cancelled = true
    }
  }, [preview, userId, fetchDocument])

  // Undo history: mutations within 800ms coalesce into one step
  // (a drag, a typed number, an agent burst each become a single undo).
  // Each step also snapshots the selection so undoing a delete or move
  // restores what was selected at the time.
  interface HistoryEntry {
    shapes: CanvasElement[]
    selection: string[]
  }
  const past = useRef<HistoryEntry[]>([])
  const future = useRef<HistoryEntry[]>([])
  const lastMutation = useRef(0)
  const [, bumpHistory] = useState(0)

  useEffect(() => {
    if (preview || loadedDocId !== activeId || docLoading) return
    saveElements(activeId, shapes)
  }, [shapes, activeId, preview, loadedDocId, docLoading])

  useEffect(() => {
    if (preview || !databaseReady || loadedDocId !== activeId || docLoadError) return
    const active = docs.find((doc) => doc.id === activeId)
    if (!active) return

    const timeout = window.setTimeout(() => {
      void orpc.design
        .save({ id: active.id, name: active.name, shapes })
        .catch((error) => console.error('[designs] Failed to save design:', error))
    }, 1500)

    return () => window.clearTimeout(timeout)
  }, [activeId, databaseReady, docs, preview, shapes, loadedDocId, docLoadError])

  // Dev-only hook for end-to-end tests to seed and inspect canvas state.
  useEffect(() => {
    if (!import.meta.env.DEV || preview) return
    ;(window as unknown as Record<string, unknown>).__loora = {
      setElements: (next: CanvasElement[]) => mutate(() => next),
      getElements: () => shapesRef.current,
      snapshot: () => snapshotCanvas(shapesRef.current),
    }
  })

  const resetHistory = () => {
    past.current = []
    future.current = []
    lastMutation.current = 0
  }

  const flushActiveDoc = () => {
    const active = docs.find((doc) => doc.id === activeId)
    if (databaseReady && active && loadedDocId === activeId && !docLoadError) {
      void orpc.design
        .save({
          id: active.id,
          name: active.name,
          shapes: shapesRef.current,
        })
        .catch((error) => console.error('[designs] Failed to save design:', error))
    }
  }

  const applyDoc = (id: string) => {
    if (id === activeIdRef.current) return
    flushActiveDoc()
    activeIdRef.current = id
    setDocState((s) => {
      saveDocs(s.docs, id)
      return { ...s, activeId: id }
    })
    const cached = hasStoredElements(id)
    setShapes(cached ? loadElements(id) : [])
    setLoadedDocId(cached ? id : null)
    setDocLoadError(null)
    setSelectedIds([])
    resetHistory()
    if (databaseReady) void fetchDocument(id, cached)
  }

  const switchDoc = (id: string) => {
    if (id === activeId) return
    if (!preview) {
      localDesignRef.current = id
      void setUrlState({ d: id })
    }
    applyDoc(id)
  }

  // Browser back/forward: URL design id drives the active doc when it points at a known one.
  useEffect(() => {
    if (preview || !urlState.d) return
    if (urlState.d === activeId) {
      localDesignRef.current = null
      return
    }
    if (localDesignRef.current && localDesignRef.current !== urlState.d) return
    if (!docs.some((doc) => doc.id === urlState.d)) return
    localDesignRef.current = null
    applyDoc(urlState.d)
    // applyDoc closes over latest flush/fetch; only re-run on URL/doc identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, urlState.d, activeId, docs])

  const newDoc = () => {
    flushActiveDoc()
    const doc: DocMeta = { id: docId(), name: `Untitled ${docs.length + 1}` }
    const next = [...docs, doc]
    saveElements(doc.id, [])
    saveDocs(next, doc.id)
    if (!preview) {
      localDesignRef.current = doc.id
      void setUrlState({ d: doc.id })
    }
    activeIdRef.current = doc.id
    setDocState({ docs: next, activeId: doc.id })
    setShapes([])
    setLoadedDocId(doc.id)
    setDocLoading(false)
    setDocLoadError(null)
    setSelectedIds([])
    resetHistory()
  }

  const insertAsset = (a: AssetMeta) => {
    const img = new Image()
    const place = (w: number, h: number) => {
      const k = Math.min(1, 480 / Math.max(w, h))
      const element: CanvasElement = {
        id: elementId(),
        name: a.name || 'Image',
        x: 40,
        y: 40,
        w: Math.max(1, Math.round(w * k)),
        h: Math.max(1, Math.round(h * k)),
        code: imageTemplate(`/api/asset/${a.id}`, a.name),
      }
      mutate((prev) => [...prev, element])
      setSelectedIds([element.id])
    }
    img.onload = () => place(img.naturalWidth || 320, img.naturalHeight || 240)
    img.onerror = () => place(320, 240)
    img.src = `/api/asset/${a.id}`
    toggleAssets(false)
  }

  const renameDoc = (name: string) => {
    const next = docs.map((d) => (d.id === activeId ? { ...d, name } : d))
    saveDocs(next, activeId)
    setDocState({ docs: next, activeId })
  }

  const deleteDoc = () => {
    if (databaseReady) {
      void orpc.design
        .delete({ id: activeId })
        .catch((error) => console.error('[designs] Failed to delete design:', error))
    }
    deleteDocStorage(activeId)
    deleteHistory(activeId)
    let next = docs.filter((d) => d.id !== activeId)
    if (next.length === 0) {
      next = [{ id: docId(), name: 'Untitled' }]
      saveElements(next[0].id, [])
    }
    saveDocs(next, next[0].id)
    const nextId = next[0].id
    if (!preview) {
      localDesignRef.current = nextId
      void setUrlState({ d: nextId })
    }
    activeIdRef.current = nextId
    const cached = hasStoredElements(nextId)
    setDocState({ docs: next, activeId: nextId })
    setShapes(cached ? loadElements(nextId) : [])
    setLoadedDocId(cached ? nextId : null)
    setDocLoadError(null)
    setSelectedIds([])
    resetHistory()
    if (databaseReady) void fetchDocument(nextId, cached)
  }

  const mutate = useCallback((fn: (prev: CanvasElement[]) => CanvasElement[]) => {
    setShapes((prev) => {
      if (mutationsBlockedRef.current) return prev
      const now = Date.now()
      if (now - lastMutation.current > 800) {
        past.current.push({ shapes: prev, selection: selectedIdsRef.current })
        if (past.current.length > 100) past.current.shift()
        future.current = []
      }
      lastMutation.current = now
      const next = fn(prev)
      if (next !== prev) {
        const id = activeIdRef.current
        documentMutationVersions.current.set(
          id,
          (documentMutationVersions.current.get(id) ?? 0) + 1,
        )
      }
      return next
    })
  }, [])

  const undo = useCallback(() => {
    if (mutationsBlockedRef.current) return
    const prev = past.current.pop()
    if (!prev) return
    future.current.push({ shapes: shapesRef.current, selection: selectedIdsRef.current })
    lastMutation.current = 0
    setShapes(prev.shapes)
    const ids = new Set(prev.shapes.map((s) => s.id))
    setSelectedIds(prev.selection.filter((id) => ids.has(id)))
    bumpHistory((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    if (mutationsBlockedRef.current) return
    const next = future.current.pop()
    if (!next) return
    past.current.push({ shapes: shapesRef.current, selection: selectedIdsRef.current })
    lastMutation.current = 0
    setShapes(next.shapes)
    const ids = new Set(next.shapes.map((s) => s.id))
    setSelectedIds(next.selection.filter((id) => ids.has(id)))
    bumpHistory((n) => n + 1)
  }, [])

  const createElement = useCallback(
    (element: Omit<CanvasElement, 'id'> & { id?: string }) => {
      const full: CanvasElement = { ...element, id: element.id ?? elementId() }
      mutate((prev) => [...prev, full])
      return full
    },
    [mutate],
  )

  const createElements = useCallback(
    (batch: Omit<CanvasElement, 'id'>[]) => {
      const full = batch.map((element) => ({ ...element, id: elementId() }))
      mutate((prev) => [...prev, ...full])
      return full
    },
    [mutate],
  )

  const updateElement = useCallback(
    (id: string, patch: Partial<Omit<CanvasElement, 'id'>>) => {
      let updated: CanvasElement | null = null
      mutate((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s
          updated = { ...s, ...patch }
          return updated
        }),
      )
      return updated ?? shapesRef.current.find((s) => s.id === id) ?? null
    },
    [mutate],
  )

  const updateElements = useCallback(
    (patches: ReadonlyMap<string, ElementPatch>) => mutate((prev) => applyElementPatches(prev, patches)),
    [mutate],
  )

  const deleteElement = useCallback(
    (id: string) => {
      const exists = shapesRef.current.some((s) => s.id === id)
      mutate((prev) => prev.filter((s) => s.id !== id))
      setSelectedIds((sel) => sel.filter((i) => i !== id))
      return exists
    },
    [mutate],
  )

  const deleteSelected = useCallback(() => {
    setSelectedIds((sel) => {
      if (sel.length > 0) {
        const selected = new Set(sel)
        mutate((prev) => prev.filter((s) => !selected.has(s.id)))
      }
      return []
    })
  }, [mutate])

  // Copies must not stay grouped with their originals: give each source
  // group a fresh id, preserving grouping within the copied set.
  const remapGroups = (targets: CanvasElement[]) => {
    const map = new Map<string, string>()
    return targets.map((s) => {
      if (!s.groupId) return s
      if (!map.has(s.groupId)) map.set(s.groupId, `g${elementId()}`)
      return { ...s, groupId: map.get(s.groupId) }
    })
  }

  const duplicateSelected = useCallback(() => {
    const selected = new Set(selectedIds)
    const targets = shapesRef.current.filter((s) => selected.has(s.id))
    if (targets.length === 0) return
    const copies = remapGroups(targets).map((s) => ({ ...s, id: elementId(), x: s.x + 16, y: s.y + 16 }))
    mutate((prev) => [...prev, ...copies])
    setSelectedIds(copies.map((c) => c.id))
  }, [mutate, selectedIds])

  // In-memory clipboard; repeated pastes cascade by +16 each.
  const clipboard = useRef<{ elements: CanvasElement[]; pastes: number }>({ elements: [], pastes: 0 })

  const [clipboardReady, setClipboardReady] = useState(false)
  // Snapshot for context-menu enablement (selection may not have re-rendered yet).
  const [contextMenuIds, setContextMenuIds] = useState<string[]>([])
  const contextPointRef = useRef<{ x: number; y: number } | null>(null)

  const copySelected = useCallback(() => {
    const selected = new Set(selectedIdsRef.current)
    const targets = shapesRef.current.filter((s) => selected.has(s.id))
    if (targets.length > 0) {
      clipboard.current = { elements: targets, pastes: 0 }
      setClipboardReady(true)
    }
  }, [])

  const paste = useCallback(() => {
    const { elements: clip } = clipboard.current
    if (clip.length === 0) return
    clipboard.current.pastes += 1
    const offset = 16 * clipboard.current.pastes
    const copies = remapGroups(clip).map((s) => ({ ...s, id: elementId(), x: s.x + offset, y: s.y + offset }))
    mutate((prev) => [...prev, ...copies])
    setSelectedIds(copies.map((c) => c.id))
    setTool('select')
  }, [mutate])

  // Place clipboard so its bounding-box center lands on the context-menu point.
  const pasteHere = useCallback(
    (point: { x: number; y: number }) => {
      const { elements: clip } = clipboard.current
      if (clip.length === 0) return
      clipboard.current.pastes += 1
      const left = Math.min(...clip.map((s) => s.x))
      const top = Math.min(...clip.map((s) => s.y))
      const right = Math.max(...clip.map((s) => s.x + s.w))
      const bottom = Math.max(...clip.map((s) => s.y + s.h))
      const dx = point.x - (left + right) / 2
      const dy = point.y - (top + bottom) / 2
      const copies = remapGroups(clip).map((s) => ({
        ...s,
        id: elementId(),
        x: Math.round(s.x + dx),
        y: Math.round(s.y + dy),
      }))
      mutate((prev) => [...prev, ...copies])
      setSelectedIds(copies.map((c) => c.id))
      setTool('select')
    },
    [mutate],
  )

  const cutSelected = useCallback(() => {
    copySelected()
    deleteSelected()
  }, [copySelected, deleteSelected])

  const groupSelected = useCallback(() => {
    const sel = selectedIdsRef.current
    if (sel.length < 2) return
    const selected = new Set(sel)
    const gid = `g${elementId()}`
    mutate((prev) => prev.map((s) => (selected.has(s.id) ? { ...s, groupId: gid } : s)))
  }, [mutate])

  const ungroupSelected = useCallback(() => {
    const sel = selectedIdsRef.current
    const selected = new Set(sel)
    mutate((prev) => prev.map((s) => (selected.has(s.id) ? { ...s, groupId: undefined } : s)))
  }, [mutate])

  const align = useCallback(
    (edge: AlignEdge) => mutate((prev) => alignElements(prev, selectedIdsRef.current, edge)),
    [mutate],
  )

  const distribute = useCallback(
    (axis: 'x' | 'y') => mutate((prev) => distributeElements(prev, selectedIdsRef.current, axis)),
    [mutate],
  )

  const reorderForAgent = useCallback(
    (orderedIds: string[]) => {
      let order = shapesRef.current.map((s) => s.id)
      mutate((prev) => {
        const next = reorderElements(prev, orderedIds)
        order = next.map((s) => s.id)
        return next
      })
      return order
    },
    [mutate],
  )

  const groupForAgent = useCallback(
    (ids: string[]) => {
      const wanted = new Set(ids)
      const targets = shapesRef.current.filter((s) => wanted.has(s.id))
      if (targets.length < 2) return null
      const gid = `g${elementId()}`
      mutate((prev) => prev.map((s) => (wanted.has(s.id) ? { ...s, groupId: gid } : s)))
      return { groupId: gid, ids: targets.map((t) => t.id) }
    },
    [mutate],
  )

  const ungroupForAgent = useCallback(
    (ids: string[]) => {
      const wanted = new Set(ids)
      const count = shapesRef.current.filter((s) => wanted.has(s.id) && s.groupId).length
      mutate((prev) => prev.map((s) => (wanted.has(s.id) ? { ...s, groupId: undefined } : s)))
      return count
    },
    [mutate],
  )

  const actions = useMemo<ElementActions>(
    () => ({
      createElement,
      createElements,
      updateElement,
      deleteElement,
      reorderElements: reorderForAgent,
      groupElements: groupForAgent,
      ungroupElements: ungroupForAgent,
    }),
    [createElement, createElements, updateElement, deleteElement, reorderForAgent, groupForAgent, ungroupForAgent],
  )

  const reorder = useCallback(
    (dir: 'forward' | 'backward' | 'front' | 'back') => {
      const sel = new Set(selectedIds)
      if (sel.size === 0) return
      mutate((prev) => {
        const arr = [...prev]
        if (dir === 'front' || dir === 'back') {
          const chosen = arr.filter((s) => sel.has(s.id))
          const rest = arr.filter((s) => !sel.has(s.id))
          return dir === 'front' ? [...rest, ...chosen] : [...chosen, ...rest]
        }
        if (dir === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) {
              ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
            }
          }
        } else {
          for (let i = 1; i < arr.length; i++) {
            if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) {
              ;[arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
            }
          }
        }
        return arr
      })
    },
    [mutate, selectedIds],
  )

  useEffect(() => {
    if (preview) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const hit = matchShortcut(e, shortcutConfig)
      if (!hit) return

      if (hit.kind === 'custom') {
        e.preventDefault()
        toggleAgent(true)
        agentSend.current?.(hit.prompt)
        return
      }

      if (shouldPreventDefault(hit.id)) e.preventDefault()

      const nudge = (dx: number, dy: number) => {
        if (mutationsBlockedRef.current || selectedIdsRef.current.length === 0) return
        const step = e.shiftKey ? 10 : 1
        const selected = new Set(selectedIdsRef.current)
        mutate((prev) =>
          prev.map((s) =>
            selected.has(s.id) ? { ...s, x: s.x + dx * step, y: s.y + dy * step } : s,
          ),
        )
      }

      switch (hit.id) {
        case 'undo':
          undo()
          break
        case 'redo':
          redo()
          break
        case 'group':
          groupSelected()
          break
        case 'ungroup':
          ungroupSelected()
          break
        case 'zoomIn':
          canvasControls.current?.zoomIn()
          break
        case 'zoomOut':
          canvasControls.current?.zoomOut()
          break
        case 'zoomReset':
          canvasControls.current?.zoomReset()
          break
        case 'zoomToFit':
          canvasControls.current?.zoomToFit()
          break
        case 'zoomToSelection':
          canvasControls.current?.zoomToSelection()
          break
        case 'selectAll':
          setSelectedIds(shapesRef.current.map((s) => s.id))
          break
        case 'duplicate':
          duplicateSelected()
          break
        case 'copy':
          copySelected()
          break
        case 'paste':
          paste()
          break
        case 'cut':
          cutSelected()
          break
        case 'bringForward':
          reorder('forward')
          break
        case 'bringToFront':
          reorder('front')
          break
        case 'sendBackward':
          reorder('backward')
          break
        case 'sendToBack':
          reorder('back')
          break
        case 'tool.select':
          setTool('select')
          break
        case 'tool.interact':
          setTool('interact')
          break
        case 'tool.comment':
          setTool('comment')
          break
        case 'tool.text':
          setTool('text')
          break
        case 'tool.box':
          setTool('box')
          break
        case 'tool.image':
          setTool('image')
          break
        case 'tool.hand':
          setTool('hand')
          break
        case 'delete':
          deleteSelected()
          break
        case 'escape':
          setSelectedIds([])
          setTool('select')
          break
        case 'nudgeLeft':
          nudge(-1, 0)
          break
        case 'nudgeRight':
          nudge(1, 0)
          break
        case 'nudgeUp':
          nudge(0, -1)
          break
        case 'nudgeDown':
          nudge(0, 1)
          break
        case 'toggleAgent':
          toggleAgent(!agentOpen)
          break
        case 'toggleLayers':
          toggleLayers(!layersOpen)
          break
        case 'toggleAssets':
          toggleAssets(!assetsOpen)
          break
        case 'toggleHistory':
          toggleHistory(!historyOpen)
          break
        case 'toggleCode':
          toggleCode(!codeOpen)
          break
        case 'openSettings':
          setSettingsOpen(true)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    preview,
    shortcutConfig,
    deleteSelected,
    duplicateSelected,
    undo,
    redo,
    reorder,
    copySelected,
    cutSelected,
    paste,
    mutate,
    groupSelected,
    ungroupSelected,
    agentOpen,
    layersOpen,
    assetsOpen,
    historyOpen,
    codeOpen,
  ])

  const selectedIdSet = new Set(selectedIds)
  const selectedShapes = shapes.filter((s) => selectedIdSet.has(s.id))
  const selected = selectedShapes[0]
  const reduceMotion = useReducedMotion()
  const barMotion = fadeUp(reduceMotion)
  const barTransition = uiTransition(reduceMotion)

  return (
    <SidebarProvider
      open={agentOpen}
      onOpenChange={toggleAgent}
      enableKeyboardShortcut={false}
      width={agentWidth}
      onWidthChange={(width) => {
        setAgentWidth(width)
        if (!preview) window.localStorage.setItem('loora:agent-width', String(width))
      }}
      className="h-full min-h-0 bg-cx-canvas"
    >
      <AgentPanel
        key={activeId}
        actions={actions}
        shapesRef={shapesRef}
        selectedIdsRef={selectedIdsRef}
        docId={activeId}
        ready={databaseReady && loadedDocId === activeId && !docLoadError}
        sendRef={agentSend}
      />

      <main className="relative min-w-0 flex-1">
        <ContextMenu>
          <ContextMenuTrigger className="block h-full w-full">
            <Canvas
              elements={shapes}
              selectedIds={selectedIds}
              tool={tool}
              docId={preview ? undefined : activeId}
              controlsRef={canvasControls}
              onScaleChange={setZoomPct}
              onSelect={setSelectedIds}
              onToolChange={setTool}
              onCreate={(s) => mutate((prev) => [...prev, s])}
              onUpdateMany={updateElements}
              onComment={(text) => {
                toggleAgent(true)
                return agentSend.current?.(text) ?? false
              }}
              onCanvasContextMenu={({ x, y, nextSelectedIds }) => {
                contextPointRef.current = { x, y }
                selectedIdsRef.current = nextSelectedIds
                // Flush so the popup that opens in this same event sees the right items.
                flushSync(() => {
                  setContextMenuIds(nextSelectedIds)
                  setClipboardReady(clipboard.current.elements.length > 0)
                })
              }}
            />
          </ContextMenuTrigger>
          <ContextMenuPopup align="start" className="w-56">
            {contextMenuIds.length === 0 ? (
              <>
                <ContextMenuItem
                  disabled={!clipboardReady}
                  onClick={() => {
                    const point = contextPointRef.current
                    if (point) pasteHere(point)
                    else paste()
                  }}
                >
                  <ClipboardPasteIcon data-slot="icon" />
                  Paste here
                  <ContextMenuShortcut>{shortcutLabel('paste')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={shapes.length === 0}
                  onClick={() => setSelectedIds(shapes.map((s) => s.id))}
                >
                  Select all
                  <ContextMenuShortcut>{shortcutLabel('selectAll')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => canvasControls.current?.zoomToFit()}>
                  <MaximizeIcon data-slot="icon" />
                  Zoom to fit
                  <ContextMenuShortcut>{shortcutLabel('zoomToFit')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => setTool('comment')}>
                  <MessageSquarePlusIcon data-slot="icon" />
                  Comment
                </ContextMenuItem>
              </>
            ) : (
              <>
                <ContextMenuItem onClick={cutSelected}>
                  <ScissorsIcon data-slot="icon" />
                  Cut
                  <ContextMenuShortcut>{shortcutLabel('cut')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={copySelected}>
                  <CopyIcon data-slot="icon" />
                  Copy
                  <ContextMenuShortcut>{shortcutLabel('copy')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem disabled={!clipboardReady} onClick={paste}>
                  <ClipboardPasteIcon data-slot="icon" />
                  Paste
                  <ContextMenuShortcut>{shortcutLabel('paste')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={duplicateSelected}>
                  <CopyIcon data-slot="icon" />
                  Duplicate
                  <ContextMenuShortcut>{shortcutLabel('duplicate')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={contextMenuIds.length < 2}
                  onClick={groupSelected}
                >
                  <GroupIcon data-slot="icon" />
                  Group
                  <ContextMenuShortcut>{shortcutLabel('group')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!shapes.some((s) => contextMenuIds.includes(s.id) && s.groupId)}
                  onClick={ungroupSelected}
                >
                  <UngroupIcon data-slot="icon" />
                  Ungroup
                  <ContextMenuShortcut>{shortcutLabel('ungroup')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <BringToFrontIcon data-slot="icon" />
                    Arrange
                  </ContextMenuSubTrigger>
                  <ContextMenuSubPopup className="w-48">
                    <ContextMenuItem onClick={() => reorder('forward')}>
                      <BringToFrontIcon data-slot="icon" />
                      Bring forward
                      <ContextMenuShortcut>{shortcutLabel('bringForward')}</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => reorder('front')}>
                      <BringToFrontIcon data-slot="icon" />
                      Bring to front
                      <ContextMenuShortcut>{shortcutLabel('bringToFront')}</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => reorder('backward')}>
                      <SendToBackIcon data-slot="icon" />
                      Send backward
                      <ContextMenuShortcut>{shortcutLabel('sendBackward')}</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => reorder('back')}>
                      <SendToBackIcon data-slot="icon" />
                      Send to back
                      <ContextMenuShortcut>{shortcutLabel('sendToBack')}</ContextMenuShortcut>
                    </ContextMenuItem>
                  </ContextMenuSubPopup>
                </ContextMenuSub>
                {contextMenuIds.length > 1 ? (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <AlignHorizontalDistributeCenterIcon data-slot="icon" />
                      Align
                    </ContextMenuSubTrigger>
                    <ContextMenuSubPopup className="w-56">
                      {(
                        [
                          ['left', AlignStartVerticalIcon, 'Align left'],
                          ['centerX', AlignCenterVerticalIcon, 'Align horizontal centers'],
                          ['right', AlignEndVerticalIcon, 'Align right'],
                          ['top', AlignStartHorizontalIcon, 'Align top'],
                          ['centerY', AlignCenterHorizontalIcon, 'Align vertical centers'],
                          ['bottom', AlignEndHorizontalIcon, 'Align bottom'],
                        ] as const
                      ).map(([edge, Icon, label]) => (
                        <ContextMenuItem key={edge} onClick={() => align(edge)}>
                          <Icon data-slot="icon" />
                          {label}
                        </ContextMenuItem>
                      ))}
                      {contextMenuIds.length > 2 ? (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => distribute('x')}>
                            <AlignHorizontalDistributeCenterIcon data-slot="icon" />
                            Distribute horizontally
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => distribute('y')}>
                            <AlignVerticalDistributeCenterIcon data-slot="icon" />
                            Distribute vertically
                          </ContextMenuItem>
                        </>
                      ) : null}
                    </ContextMenuSubPopup>
                  </ContextMenuSub>
                ) : null}
                {contextMenuIds.length === 1 ? (
                  <>
                    <ContextMenuItem onClick={() => toggleCode(true)}>
                      <CodeXmlIcon data-slot="icon" />
                      Edit code
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() =>
                        window.open(
                          `/blockpage/${encodeURIComponent(activeId)}?element=${encodeURIComponent(contextMenuIds[0])}`,
                          '_blank',
                          'noopener',
                        )
                      }
                    >
                      <MaximizeIcon data-slot="icon" />
                      Preview fullscreen
                    </ContextMenuItem>
                  </>
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={deleteSelected}>
                  <Trash2Icon data-slot="icon" />
                  Delete
                </ContextMenuItem>
              </>
            )}
          </ContextMenuPopup>
        </ContextMenu>

        {loadedDocId !== activeId && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-cx-canvas/80 backdrop-blur-[1px]">
            <div
              className={cn(
                'flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-5 py-4 text-center shadow-sm',
                !docLoading && 'border-destructive/30',
              )}
            >
              <p
                className={cn(
                  'text-sm',
                  docLoading ? 'text-muted-foreground' : 'text-destructive-foreground',
                )}
              >
                {docLoading
                  ? 'Loading document…'
                  : docLoadError ?? 'Document is not ready.'}
              </p>
              {!docLoading && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void fetchDocument(activeId, hasStoredElements(activeId))}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}
        {!docLoading && loadedDocId === activeId && docLoadError && (
          <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
            <div
              role="alert"
              className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive-foreground shadow-sm"
            >
              <span>{docLoadError}</span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void fetchDocument(activeId, hasStoredElements(activeId))}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        <Drawer open={layersOpen} onOpenChange={toggleLayers} position="bottom">
          <DrawerPopup
            position="bottom"
            variant="inset"
            className="mx-auto h-[min(50svh,28rem)] w-full max-w-sm overflow-hidden rounded-2xl border"
          >
            <LayersPanel
              elements={shapes}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onReorderList={(orderedIds) => mutate((prev) => reorderElements(prev, orderedIds))}
              onRename={(id, name) => updateElement(id, { name })}
              onClose={() => toggleLayers(false)}
            />
          </DrawerPopup>
        </Drawer>

        <Drawer open={assetsOpen} onOpenChange={toggleAssets} position="bottom">
          <DrawerPopup
            position="bottom"
            variant="inset"
            className="h-[min(60svh,32rem)] overflow-hidden rounded-2xl border"
          >
            <AssetsPanel onInsert={insertAsset} />
          </DrawerPopup>
        </Drawer>

        <Drawer open={settingsOpen} onOpenChange={setSettingsOpen} position="bottom">
          <DrawerPopup
            position="bottom"
            variant="inset"
            className="mx-auto h-[min(70svh,36rem)] w-full max-w-lg overflow-hidden rounded-2xl border"
          >
            <SettingsPanel
              onClose={() => setSettingsOpen(false)}
              shortcutConfig={shortcutConfig}
              onShortcutConfigChange={updateShortcutConfig}
            />
          </DrawerPopup>
        </Drawer>

        <div className="absolute top-4 right-4 flex items-center gap-1">
          <Button
            variant={layersOpen ? 'secondary' : 'ghost'}
            size="icon"
            aria-label="Layers"
            title="Layers"
            aria-pressed={layersOpen}
            onClick={() => toggleLayers(!layersOpen)}
          >
            <LayersIcon data-slot="icon" />
          </Button>
          <Button
            variant={assetsOpen ? 'secondary' : 'ghost'}
            size="icon"
            aria-label="Assets"
            title="Assets"
            aria-pressed={assetsOpen}
            onClick={() => toggleAssets(!assetsOpen)}
          >
            <ImageIcon data-slot="icon" />
          </Button>
          <HistoryPopover
            docId={activeId}
            open={historyOpen}
            onOpenChange={toggleHistory}
            shapesRef={shapesRef}
            onRestore={(restored) => {
              mutate(() => restored)
              setSelectedIds([])
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions" title="More actions">
                <EllipsisIcon data-slot="icon" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => toggleAgent(!agentOpen)}>
                <SparklesIcon data-slot="icon" />
                Agent panel
                {agentOpen ? <CheckIcon className="ml-auto size-3.5" /> : null}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setExportOpen(true)} disabled={shapes.length === 0}>
                <DownloadIcon data-slot="icon" />
                Export and hand off
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <SettingsIcon data-slot="icon" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-4 flex items-center justify-center gap-2">
          <span className="text-sm font-semibold tracking-tight">
            loora<span className="text-cx-accent">.</span>
          </span>
          <span className="text-muted-foreground/50">/</span>
          <DocSwitcher
            docs={docs}
            activeId={activeId}
            onSwitch={switchDoc}
            onNew={newDoc}
            onRename={renameDoc}
            onDelete={deleteDoc}
          />
        </div>

        <div className="absolute top-1/2 right-4 flex -translate-y-1/2 flex-col gap-1 rounded-xl border bg-card p-1 shadow-sm">
          {TOOLS.map(({ tool: t, icon: Icon, label }) => {
            const toolShortcut = shortcutLabel(`tool.${t}` as BuiltInShortcutId)
            return (
              <Button
                key={t}
                variant="ghost"
                size="icon"
                aria-label={`${label} (${toolShortcut})`}
                title={`${label} (${toolShortcut})`}
                className={cn(tool === t && 'bg-cx-accent/10 text-cx-accent hover:bg-cx-accent/10 hover:text-cx-accent')}
                onClick={() => setTool(t)}
              >
                <Icon data-slot="icon" />
              </Button>
            )
          })}
          <div className="mx-1 my-0.5 h-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Undo (${shortcutLabel('undo')})`}
            title={`Undo (${shortcutLabel('undo')})`}
            disabled={past.current.length === 0}
            onClick={undo}
          >
            <Undo2Icon data-slot="icon" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Redo (${shortcutLabel('redo')})`}
            title={`Redo (${shortcutLabel('redo')})`}
            disabled={future.current.length === 0}
            onClick={redo}
          >
            <Redo2Icon data-slot="icon" />
          </Button>
        </div>

        <div className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-xl border bg-card p-1 shadow-sm">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Zoom out (${shortcutLabel('zoomOut')})`}
            title={`Zoom out (${shortcutLabel('zoomOut')})`}
            onClick={() => canvasControls.current?.zoomOut()}
          >
            <ZoomOutIcon data-slot="icon" />
          </Button>
          <button
            type="button"
            aria-label={`Reset zoom (${shortcutLabel('zoomReset')})`}
            title={`Reset zoom (${shortcutLabel('zoomReset')})`}
            className="w-11 rounded-md px-1 py-0.5 text-center font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => canvasControls.current?.zoomReset()}
          >
            {zoomPct}%
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Zoom in (${shortcutLabel('zoomIn')})`}
            title={`Zoom in (${shortcutLabel('zoomIn')})`}
            onClick={() => canvasControls.current?.zoomIn()}
          >
            <ZoomInIcon data-slot="icon" />
          </Button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Zoom to fit (${shortcutLabel('zoomToFit')}), selection (${shortcutLabel('zoomToSelection')})`}
            title={`Zoom to fit (${shortcutLabel('zoomToFit')} · ${shortcutLabel('zoomToSelection')} selection)`}
            onClick={() =>
              selectedIds.length > 0
                ? canvasControls.current?.zoomToSelection()
                : canvasControls.current?.zoomToFit()
            }
          >
            <MaximizeIcon data-slot="icon" />
          </Button>
        </div>

        <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
          <AnimatePresence>
            {selected && (
              <motion.div
                key="selection-bar"
                className="flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 shadow-sm"
                initial={barMotion.initial}
                animate={barMotion.animate}
                exit={barMotion.exit}
                transition={barTransition}
              >
            {/* Desktop: keep z-order as primary actions. Mobile / multi-select
                overflow goes into Arrange so the bar stays scannable. */}
            {!isMobile && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Bring forward (], shift-click for front)"
                  title={`Bring forward (${shortcutLabel('bringForward')} · ${shortcutLabel('bringToFront')} front)`}
                  onClick={(e) => reorder(e.shiftKey ? 'front' : 'forward')}
                >
                  <BringToFrontIcon data-slot="icon" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Send backward ([, shift-click for back)"
                  title={`Send backward (${shortcutLabel('sendBackward')} · ${shortcutLabel('sendToBack')} back)`}
                  onClick={(e) => reorder(e.shiftKey ? 'back' : 'backward')}
                >
                  <SendToBackIcon data-slot="icon" />
                </Button>
              </>
            )}
            {(isMobile || selectedShapes.length > 1) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={isMobile ? 'Arrange selection' : 'Align & distribute'}
                    title={isMobile ? 'Arrange' : 'Align & distribute'}
                  >
                    <AlignHorizontalDistributeCenterIcon data-slot="icon" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-56">
                  {isMobile && (
                    <>
                      <DropdownMenuItem onClick={() => reorder('forward')}>
                        <BringToFrontIcon data-slot="icon" />
                        Bring forward
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => reorder('front')}>
                        <BringToFrontIcon data-slot="icon" />
                        Bring to front
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => reorder('backward')}>
                        <SendToBackIcon data-slot="icon" />
                        Send backward
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => reorder('back')}>
                        <SendToBackIcon data-slot="icon" />
                        Send to back
                      </DropdownMenuItem>
                      {selectedShapes.length > 1 ? <DropdownMenuSeparator /> : null}
                    </>
                  )}
                  {selectedShapes.length > 1 &&
                    (
                      [
                        ['left', AlignStartVerticalIcon, 'Align left'],
                        ['centerX', AlignCenterVerticalIcon, 'Align horizontal centers'],
                        ['right', AlignEndVerticalIcon, 'Align right'],
                        ['top', AlignStartHorizontalIcon, 'Align top'],
                        ['centerY', AlignCenterHorizontalIcon, 'Align vertical centers'],
                        ['bottom', AlignEndHorizontalIcon, 'Align bottom'],
                      ] as const
                    ).map(([edge, Icon, label]) => (
                      <DropdownMenuItem key={edge} onClick={() => align(edge)}>
                        <Icon data-slot="icon" />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  {selectedShapes.length > 2 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => distribute('x')}>
                        <AlignHorizontalDistributeCenterIcon data-slot="icon" />
                        Distribute horizontally
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => distribute('y')}>
                        <AlignVerticalDistributeCenterIcon data-slot="icon" />
                        Distribute vertically
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {selectedShapes.length > 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Group selection (${shortcutLabel('group')})`}
                title={`Group (${shortcutLabel('group')})`}
                onClick={groupSelected}
              >
                <GroupIcon data-slot="icon" />
              </Button>
            )}
            {selectedShapes.some((s) => s.groupId) && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Ungroup selection (${shortcutLabel('ungroup')})`}
                title={`Ungroup (${shortcutLabel('ungroup')})`}
                onClick={ungroupSelected}
              >
                <UngroupIcon data-slot="icon" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Duplicate selection (${shortcutLabel('duplicate')})`}
              title={`Duplicate (${shortcutLabel('duplicate')})`}
              onClick={duplicateSelected}
            >
              <CopyIcon data-slot="icon" />
            </Button>
            {selectedShapes.length === 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit code"
                title="Edit code"
                onClick={() => toggleCode(true)}
              >
                <CodeXmlIcon data-slot="icon" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete selection"
              title="Delete"
              onClick={deleteSelected}
            >
              <Trash2Icon data-slot="icon" />
            </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Drawer open={codeOpen && !!selected} onOpenChange={toggleCode} position="bottom">
          <DrawerPopup
            position="bottom"
            variant="inset"
            className="h-[min(70svh,36rem)] overflow-hidden rounded-2xl border"
          >
            {selected && (
              <CodeEditorPanel
                key={selected.id}
                element={selected}
                onApply={(code) => updateElement(selected.id, { code })}
                onClose={() => toggleCode(false)}
              />
            )}
          </DrawerPopup>
        </Drawer>

        <ExportDialog
          key={activeId}
          open={exportOpen}
          onOpenChange={setExportOpen}
          doc={docs.find((doc) => doc.id === activeId) ?? { id: activeId, name: 'Untitled' }}
          shapes={shapes}
          selectedIds={selectedIds}
          databaseReady={databaseReady}
        />

      </main>

    </SidebarProvider>
  )
}
