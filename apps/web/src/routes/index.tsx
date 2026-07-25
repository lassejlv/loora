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
  CommandIcon,
  EllipsisIcon,
  FileIcon,
  FilePlus2Icon,
  HistoryIcon,
  MousePointer2Icon,
  MousePointerClickIcon,
  ImageIcon,
  FigmaIcon,
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
  hasStoredTargetElements,
  loadActiveDraft,
  loadDocs,
  loadElements,
  loadTargetElements,
  saveActiveDraft,
  saveDocs,
  saveElements,
  saveTargetElements,
  targetKey,
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
import { PublishButton } from '#/components/publish-button'
import { deleteHistory } from '@loora/rpc/history'
import { snapshotCanvas } from '#/lib/snapshot'
import { AgentPanel } from '#/components/agent-panel'
import { BranchControls, type BranchSummary } from '#/components/draft-controls'
import { ExportDialog } from '#/components/export-dialog'
import {
  FigmaImportDialog,
  type FigmaImportDestination,
} from '#/components/figma-import-dialog'
import {
  EditorCommandMenu,
  type EditorCommandGroup,
} from '#/components/editor-command-menu'
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
import {
  DRAFT_STATUSES,
  mergeCanvas,
  type CanvasMergeConflict,
  type CanvasTarget,
  type MergeChoice,
} from '@loora/db/drafts'
import { Drawer, DrawerPopup } from '#/components/ui/drawer'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
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
    <PreviewAccessScreen userId={session.user.id} preview={<Editor preview />}>
      <SubscriptionScreen userId={session.user.id} preview={<Editor preview />}>
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
  onImport,
  onRename,
  onDelete,
}: {
  docs: DocMeta[]
  activeId: string
  onSwitch: (id: string) => void
  onNew: () => void
  onImport: () => void
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
          <DropdownMenuItem onClick={onImport}>
            <FigmaIcon data-slot="icon" />
            Import from Figma
          </DropdownMenuItem>
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

// The layers rail is docked, not floating: it takes width from the canvas, so
// it needs a floor that still fits a name and a ceiling that leaves the canvas
// usable.
const LAYERS_MIN_WIDTH = 200
const LAYERS_MAX_WIDTH = 420
const clampLayersWidth = (width: number) =>
  Math.round(Math.min(LAYERS_MAX_WIDTH, Math.max(LAYERS_MIN_WIDTH, width)))

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
  const initialDraftId = preview
    ? null
    : new URLSearchParams(window.location.search).get('draft')
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
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialDraftId)
  const [drafts, setDrafts] = useState<BranchSummary[]>([])
  const [runningTargets, setRunningTargets] = useState<Array<string | null>>([])
  const [branchNotice, setBranchNotice] = useState<string | null>(null)
  const branchNoticeTimer = useRef<number | null>(null)
  const announceBranch = useCallback((message: string) => {
    if (branchNoticeTimer.current !== null) {
      window.clearTimeout(branchNoticeTimer.current)
    }
    setBranchNotice(message)
    branchNoticeTimer.current = window.setTimeout(() => {
      setBranchNotice(null)
      branchNoticeTimer.current = null
    }, 3200)
  }, [])

  useEffect(
    () => () => {
      if (branchNoticeTimer.current !== null) {
        window.clearTimeout(branchNoticeTimer.current)
      }
    },
    [],
  )
  const activeTarget: CanvasTarget = { designId: activeId, draftId: activeDraftId }
  const activeTargetKey = targetKey(activeTarget)
  const [shapes, setShapes] = useState<CanvasElement[]>(() =>
    preview || cacheOwnedByAnotherUser ? [] : loadTargetElements(activeTarget),
  )
  const [targetRevision, setTargetRevision] = useState(0)
  const targetRevisionRef = useRef(0)
  targetRevisionRef.current = targetRevision
  const lastSyncedShapes = useRef<CanvasElement[]>(shapes)
  const [syncConflict, setSyncConflict] = useState<{
    base: CanvasElement[]
    remote: CanvasElement[]
    local: CanvasElement[]
    remoteRevision: number
    conflicts: CanvasMergeConflict[]
  } | null>(null)
  const [syncResolutions, setSyncResolutions] = useState<Record<string, MergeChoice>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [databaseReady, setDatabaseReady] = useState(false)
  const [loadedDocId, setLoadedDocId] = useState<string | null>(() =>
    preview || (!cacheOwnedByAnotherUser && hasStoredTargetElements(activeTarget))
      ? activeTargetKey
      : null,
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
  const [figmaImportOpen, setFigmaImportOpen] = useState(() =>
    !preview && new URLSearchParams(window.location.search).get('figmaImport') === 'true',
  )
  const [figmaImportDestination, setFigmaImportDestination] =
    useState<FigmaImportDestination>('new')
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const openFigmaImport = (destination: FigmaImportDestination) => {
    setFigmaImportDestination(destination)
    setFigmaImportOpen(true)
  }
  const [agentWidth, setAgentWidth] = useState(() => {
    if (preview || typeof window === 'undefined') return 340
    const raw = Number(window.localStorage.getItem('loora:agent-width'))
    return Number.isFinite(raw) ? Math.min(640, Math.max(280, Math.round(raw))) : 340
  })
  const [layersWidth, setLayersWidth] = useState(() => {
    if (preview || typeof window === 'undefined') return 260
    const raw = Number(window.localStorage.getItem('loora:layers-width'))
    return Number.isFinite(raw) && raw > 0 ? clampLayersWidth(raw) : 260
  })
  const [resizingLayers, setResizingLayers] = useState(false)
  // Ids hovered in the layers rail, mirrored onto the canvas as an outline.
  const [hoveredLayerIds, setHoveredLayerIds] = useState<string[]>([])
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>(() =>
    preview ? { overrides: {}, custom: [] } : loadCachedShortcuts(),
  )
  const [agentSystemPrompt, setAgentSystemPrompt] = useState<string | null>(() =>
    preview ? '' : null,
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
        setAgentSystemPrompt(prefs.agentSystemPrompt)
        cacheShortcuts(next)
      })
      .catch((error) => {
        console.error('[preferences] Failed to load preferences:', error)
        if (!cancelled) setAgentSystemPrompt('')
      })
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

  const saveAgentSystemPrompt = async (prompt: string) => {
    const saved = await orpc.preferences.saveAgentPrompt({ prompt })
    setAgentSystemPrompt(saved.agentSystemPrompt)
  }

  const shortcutLabel = (id: BuiltInShortcutId) => formatBuiltInChord(id, shortcutConfig)

  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const activeDraftIdRef = useRef(activeDraftId)
  activeDraftIdRef.current = activeDraftId
  const activeTargetKeyRef = useRef(activeTargetKey)
  activeTargetKeyRef.current = activeTargetKey
  const documentRequest = useRef(0)
  const documentMutationVersions = useRef(new Map<string, number>())
  const mutationsBlockedRef = useRef(false)
  mutationsBlockedRef.current =
    !preview &&
    (loadedDocId !== activeTargetKey ||
      syncConflict !== null ||
      (activeDraftId !== null &&
        drafts.find((draft) => draft.id === activeDraftId)?.status !== 'active'))
  const canvasControls = useRef<CanvasControls | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  // Bridge: canvas comment pins push messages straight into the agent chat.
  const agentSend = useRef<((text: string) => boolean) | null>(null)
  const targetShapeRefs = useRef(
    new Map<string, { current: CanvasElement[] }>(),
  )
  const targetRevisions = useRef(new Map<string, number>())
  const targetLastSynced = useRef(new Map<string, CanvasElement[]>())
  const targetSaveChains = useRef(new Map<string, Promise<void>>())
  const targetActions = useRef(new Map<string, ElementActions>())
  const activeShapeRef = targetShapeRefs.current.get(activeTargetKey) ?? { current: shapes }
  activeShapeRef.current = shapes
  targetShapeRefs.current.set(activeTargetKey, activeShapeRef)
  targetRevisions.current.set(activeTargetKey, targetRevision)
  targetLastSynced.current.set(activeTargetKey, lastSyncedShapes.current)

  const fetchDocument = useCallback(async (
    target: CanvasTarget,
    cached: boolean,
    discardLocal = false,
  ) => {
    const key = targetKey(target)
    const request = ++documentRequest.current
    const mutationVersion = documentMutationVersions.current.get(key) ?? 0
    setDocLoading(true)
    setDocLoadError(null)
    if (!cached) setLoadedDocId(null)
    try {
      const remote = target.draftId
        ? await orpc.draft.get({ designId: target.designId, id: target.draftId })
        : await orpc.design.get({ id: target.designId })
      const remoteDraftStatus =
        target.draftId && 'status' in remote
          ? DRAFT_STATUSES.find((candidate) => candidate === remote.status) ?? null
          : null
      if (target.draftId && remoteDraftStatus) {
          setDrafts((current) =>
            current.map((draft) =>
              draft.id === target.draftId
                ? {
                    ...draft,
                    status: remoteDraftStatus,
                    revision: remote.revision,
                    updatedAt: remote.updatedAt,
                  }
                : draft,
            ),
          )
      }
      const changedWhileLoading =
        (documentMutationVersions.current.get(key) ?? 0) !== mutationVersion
      if (request !== documentRequest.current || activeTargetKeyRef.current !== key) return false

      const knownBase = targetLastSynced.current.get(key)
      const localShapes = targetShapeRefs.current.get(key)?.current ?? shapesRef.current
      const hasUnsyncedLocal =
        !discardLocal &&
        (!remoteDraftStatus || remoteDraftStatus === 'active') &&
        knownBase !== undefined &&
        JSON.stringify(knownBase) !== JSON.stringify(localShapes)
      const shouldReconcile = changedWhileLoading || hasUnsyncedLocal
      if (shouldReconcile && knownBase) {
        const reconciled = mergeCanvas(knownBase, remote.shapes, localShapes)
        if (reconciled.unresolved.length > 0) {
          setShapes(localShapes)
          shapesRef.current = localShapes
          setTargetRevision(remote.revision)
          targetRevisionRef.current = remote.revision
          lastSyncedShapes.current = remote.shapes
          targetRevisions.current.set(key, remote.revision)
          targetLastSynced.current.set(key, remote.shapes)
          setSyncConflict({
            base: knownBase,
            remote: remote.shapes,
            local: localShapes,
            remoteRevision: remote.revision,
            conflicts: reconciled.conflicts,
          })
          setSyncResolutions({})
          setLoadedDocId(key)
          setDocLoading(false)
          return true
        }
        setShapes(reconciled.shapes)
        shapesRef.current = reconciled.shapes
        saveTargetElements(target, reconciled.shapes)
      } else {
        setShapes(remote.shapes)
        shapesRef.current = remote.shapes
        saveTargetElements(target, remote.shapes)
      }
      setTargetRevision(remote.revision)
      targetRevisionRef.current = remote.revision
      targetRevisions.current.set(key, remote.revision)
      setSyncConflict(null)
      setSyncResolutions({})
      lastSyncedShapes.current = remote.shapes
      targetLastSynced.current.set(key, remote.shapes)
      setLoadedDocId(key)
      setDocLoading(false)
      return true
    } catch (error) {
      console.error('[designs] Failed to load design:', error)
      if (request !== documentRequest.current || activeTargetKeyRef.current !== key) return false
      if (cached) setLoadedDocId(key)
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
          const created = await Promise.all(
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
          setActiveDraftId(null)
          activeDraftIdRef.current = null
          setDrafts([])
          const mainTarget = { designId: activeId, draftId: null }
          const key = targetKey(mainTarget)
          activeTargetKeyRef.current = key
          setLoadedDocId(key)
          const activeCreated = created.find((item) => item.id === activeId)
          setTargetRevision(activeCreated?.revision ?? 0)
          targetRevisionRef.current = activeCreated?.revision ?? 0
          lastSyncedShapes.current = shapesRef.current
        } else {
          const remoteDocs = remote.map(({ id, name }) => ({ id, name }))
          const urlD = readUrlDesignId()
          const nextActive =
            (urlD && remote.some((doc) => doc.id === urlD) && urlD) ||
            (remote.some((doc) => doc.id === activeId) ? activeId : remote[0].id)
          const remoteDrafts = await orpc.draft.list({
            designId: nextActive,
            includeArchived: true,
          })
          if (cancelled) return
          // A shared link's ?draft wins; otherwise resume the branch this design
          // was last edited on. Only 'active' branches resume — merged and
          // discarded ones are read-only snapshots nobody wants to land in.
          const requestedDraft =
            new URLSearchParams(window.location.search).get('draft') ??
            loadActiveDraft(nextActive)
          const nextDraft =
            requestedDraft &&
            remoteDrafts.some((draft) => draft.id === requestedDraft && draft.status === 'active')
              ? requestedDraft
              : null
          saveActiveDraft(nextActive, nextDraft)
          const nextTarget = { designId: nextActive, draftId: nextDraft }
          const nextKey = targetKey(nextTarget)
          const cached = hasStoredTargetElements(nextTarget)
          saveDocs(remoteDocs, nextActive)
          activeIdRef.current = nextActive
          activeDraftIdRef.current = nextDraft
          activeTargetKeyRef.current = nextKey
          setDocState({ docs: remoteDocs, activeId: nextActive })
          setActiveDraftId(nextDraft)
          setDrafts(remoteDrafts)
          if (!preview) {
            localDesignRef.current = nextActive
            void setUrlState({ d: nextActive, draft: nextDraft })
          }
          const cachedShapes = cached ? loadTargetElements(nextTarget) : []
          setShapes(cachedShapes)
          lastSyncedShapes.current = cachedShapes
          setLoadedDocId(cached ? nextKey : null)
          setSelectedIds([])
          await fetchDocument(nextTarget, cached)
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
  const targetSelections = useRef(new Map<string, string[]>())
  const targetHistories = useRef(
    new Map<
      string,
      {
        past: HistoryEntry[]
        future: HistoryEntry[]
        lastMutation: number
      }
    >(),
  )

  useEffect(() => {
    if (preview || loadedDocId !== activeTargetKey || docLoading) return
    saveTargetElements(activeTarget, shapes)
  }, [shapes, activeTargetKey, preview, loadedDocId, docLoading])

  useEffect(() => {
    if (
      preview ||
      !databaseReady ||
      loadedDocId !== activeTargetKey ||
      docLoadError ||
      syncConflict
    ) return
    const active = docs.find((doc) => doc.id === activeId)
    if (!active) return
    const draft = activeDraftId
      ? drafts.find((candidate) => candidate.id === activeDraftId)
      : null
    if (draft && draft.status !== 'active') return

    const timeout = window.setTimeout(() => {
      const save = activeDraftId
        ? orpc.draft.save({
            id: activeDraftId,
            designId: active.id,
            shapes,
            expectedRevision: targetRevisionRef.current,
          })
        : orpc.design.save({
            id: active.id,
            name: active.name,
            shapes,
            expectedRevision: targetRevisionRef.current,
          })
      void save
        .then((saved) => {
          if (activeTargetKeyRef.current !== activeTargetKey) return
          setTargetRevision(saved.revision)
          targetRevisionRef.current = saved.revision
          lastSyncedShapes.current = shapes
          if (activeDraftId) {
            setDrafts((current) =>
              current.map((candidate) =>
                candidate.id === activeDraftId
                  ? { ...candidate, revision: saved.revision, updatedAt: saved.updatedAt }
                  : candidate,
              ),
            )
          }
        })
        .catch(async (error) => {
          console.error('[designs] Failed to save target:', error)
          try {
            const remote = activeDraftId
              ? await orpc.draft.get({ designId: active.id, id: activeDraftId })
              : await orpc.design.get({ id: active.id })
            if (activeTargetKeyRef.current !== activeTargetKey) return
            const reconciled = mergeCanvas(lastSyncedShapes.current, remote.shapes, shapes)
            if (reconciled.unresolved.length > 0) {
              setSyncConflict({
                base: lastSyncedShapes.current,
                remote: remote.shapes,
                local: shapes,
                remoteRevision: remote.revision,
                conflicts: reconciled.conflicts,
              })
              setSyncResolutions({})
              return
            }
            setTargetRevision(remote.revision)
            targetRevisionRef.current = remote.revision
            lastSyncedShapes.current = remote.shapes
            setShapes(reconciled.shapes)
          } catch (refreshError) {
            console.error('[designs] Failed to reconcile target:', refreshError)
          }
        })
    }, 1500)

    return () => window.clearTimeout(timeout)
  }, [
    activeId,
    activeDraftId,
    activeTargetKey,
    databaseReady,
    docs,
    drafts,
    preview,
    shapes,
    loadedDocId,
    docLoadError,
    syncConflict,
  ])

  const resolveSyncConflict = () => {
    if (!syncConflict) return
    const reconciled = mergeCanvas(
      syncConflict.base,
      syncConflict.remote,
      syncConflict.local,
      syncResolutions,
    )
    if (reconciled.unresolved.length > 0) return
    setTargetRevision(syncConflict.remoteRevision)
    targetRevisionRef.current = syncConflict.remoteRevision
    lastSyncedShapes.current = syncConflict.remote
    setShapes(reconciled.shapes)
    shapesRef.current = reconciled.shapes
    saveTargetElements(activeTarget, reconciled.shapes)
    setSyncConflict(null)
    setSyncResolutions({})
  }

  const reloadAfterSyncConflict = () => {
    setSyncConflict(null)
    setSyncResolutions({})
    void fetchDocument(activeTarget, hasStoredTargetElements(activeTarget), true)
  }

  // Dev-only hook for end-to-end tests to seed and inspect canvas state.
  useEffect(() => {
    if (!import.meta.env.DEV || preview) return
    ;(window as unknown as Record<string, unknown>).__loora = {
      setElements: (next: CanvasElement[]) => mutate(() => next),
      getElements: () => shapesRef.current,
      snapshot: () => snapshotCanvas(shapesRef.current),
    }
  })

  const stashTargetEditorState = (key: string) => {
    targetSelections.current.set(key, selectedIdsRef.current)
    targetHistories.current.set(key, {
      past: past.current,
      future: future.current,
      lastMutation: lastMutation.current,
    })
  }

  const restoreTargetEditorState = (key: string, elements: CanvasElement[]) => {
    const elementIds = new Set(elements.map((element) => element.id))
    setSelectedIds(
      (targetSelections.current.get(key) ?? []).filter((id) => elementIds.has(id)),
    )
    const history = targetHistories.current.get(key)
    past.current = history?.past ?? []
    future.current = history?.future ?? []
    lastMutation.current = history?.lastMutation ?? 0
    bumpHistory((version) => version + 1)
  }

  const flushActiveDoc = async () => {
    const active = docs.find((doc) => doc.id === activeId)
    const draft = activeDraftId
      ? drafts.find((candidate) => candidate.id === activeDraftId)
      : null
    if (
      !databaseReady ||
      !active ||
      loadedDocId !== activeTargetKey ||
      docLoadError ||
      syncConflict ||
      (draft && draft.status !== 'active')
    ) return
    try {
      const saved = activeDraftId
        ? await orpc.draft.save({
            id: activeDraftId,
            designId: active.id,
            shapes: shapesRef.current,
            expectedRevision: targetRevisionRef.current,
          })
        : await orpc.design.save({
          id: active.id,
          name: active.name,
          shapes: shapesRef.current,
          expectedRevision: targetRevisionRef.current,
        })
      setTargetRevision(saved.revision)
      targetRevisionRef.current = saved.revision
      lastSyncedShapes.current = shapesRef.current
      if (activeDraftId) {
        setDrafts((current) =>
          current.map((candidate) =>
            candidate.id === activeDraftId
              ? { ...candidate, revision: saved.revision, updatedAt: saved.updatedAt }
              : candidate,
          ),
        )
      }
    } catch (error) {
      console.error('[designs] Failed to flush target:', error)
      throw error
    }
  }

  const applyDoc = (id: string) => {
    if (id === activeIdRef.current && activeDraftIdRef.current === null) return
    void flushActiveDoc()
    stashTargetEditorState(activeTargetKeyRef.current)
    activeIdRef.current = id
    activeDraftIdRef.current = null
    setActiveDraftId(null)
    setDrafts([])
    setDocState((s) => {
      saveDocs(s.docs, id)
      return { ...s, activeId: id }
    })
    const target = { designId: id, draftId: null }
    const key = targetKey(target)
    activeTargetKeyRef.current = key
    const cached = hasStoredTargetElements(target)
    const cachedShapes = cached ? loadTargetElements(target) : []
    const cachedRevision = targetRevisions.current.get(key) ?? 0
    setShapes(cachedShapes)
    shapesRef.current = cachedShapes
    lastSyncedShapes.current = targetLastSynced.current.get(key) ?? cachedShapes
    setTargetRevision(cachedRevision)
    targetRevisionRef.current = cachedRevision
    setLoadedDocId(cached ? key : null)
    setDocLoadError(null)
    setSyncConflict(null)
    restoreTargetEditorState(key, cachedShapes)
    if (databaseReady) {
      void Promise.all([
        fetchDocument(target, cached),
        orpc.draft
          .list({ designId: id, includeArchived: true })
          .then((rows) => {
            setDrafts(rows)
            // Resume the branch this design was last edited on, unless the user
            // moved on while the list was in flight.
            if (preview) return
            if (activeIdRef.current !== id || activeDraftIdRef.current !== null) return
            const remembered = loadActiveDraft(id)
            if (!remembered) return
            if (!rows.some((draft) => draft.id === remembered && draft.status === 'active')) {
              saveActiveDraft(id, null)
              return
            }
            switchDraft(remembered, true)
          })
          .catch((error) => console.error('[drafts] Failed to list drafts:', error)),
      ])
    }
  }

  const switchDoc = (id: string) => {
    if (id === activeId) return
    if (!preview) {
      localDesignRef.current = id
      void setUrlState({ d: id, draft: null })
    }
    applyDoc(id)
  }

  const switchDraft = (draftId: string | null, skipFlush = false) => {
    if (draftId === activeDraftIdRef.current) return
    if (!skipFlush) void flushActiveDoc()
    stashTargetEditorState(activeTargetKeyRef.current)
    const target = { designId: activeIdRef.current, draftId }
    const key = targetKey(target)
    activeDraftIdRef.current = draftId
    activeTargetKeyRef.current = key
    setActiveDraftId(draftId)
    if (!preview) {
      saveActiveDraft(activeIdRef.current, draftId)
      void setUrlState({ draft: draftId })
    }
    const cached = hasStoredTargetElements(target)
    const cachedShapes = cached ? loadTargetElements(target) : []
    const cachedRevision =
      targetRevisions.current.get(key) ??
      (draftId ? drafts.find((draft) => draft.id === draftId)?.revision ?? 0 : 0)
    setShapes(cachedShapes)
    shapesRef.current = cachedShapes
    lastSyncedShapes.current = targetLastSynced.current.get(key) ?? cachedShapes
    setTargetRevision(cachedRevision)
    targetRevisionRef.current = cachedRevision
    setLoadedDocId(cached ? key : null)
    setDocLoadError(null)
    setSyncConflict(null)
    restoreTargetEditorState(key, cachedShapes)
    if (databaseReady) void fetchDocument(target, cached)
  }

  const switchBranchWithNotice = (draftId: string | null, skipFlush = false) => {
    if (draftId === activeDraftIdRef.current) return
    switchDraft(draftId, skipFlush)
    const branchName = draftId
      ? drafts.find((draft) => draft.id === draftId)?.name ?? 'branch'
      : 'Main'
    announceBranch(`Switched canvas to ${branchName}`)
  }

  const refreshDrafts = useCallback(async () => {
    if (preview) return
    const rows = await orpc.draft.list({ designId: activeIdRef.current, includeArchived: true })
    setDrafts(rows)
  }, [preview])

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

  useEffect(() => {
    if (preview || urlState.d !== activeId || urlState.draft === activeDraftId) return
    if (urlState.draft && !drafts.some((draft) => draft.id === urlState.draft)) return
    switchDraft(urlState.draft)
    // switchDraft closes over the latest target state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, urlState.d, urlState.draft, activeId, activeDraftId, drafts])

  const newDoc = () => {
    void flushActiveDoc()
    stashTargetEditorState(activeTargetKeyRef.current)
    const doc: DocMeta = { id: docId(), name: `Untitled ${docs.length + 1}` }
    const next = [...docs, doc]
    saveElements(doc.id, [])
    saveDocs(next, doc.id)
    if (!preview) {
      localDesignRef.current = doc.id
      void setUrlState({ d: doc.id, draft: null })
    }
    activeIdRef.current = doc.id
    activeDraftIdRef.current = null
    const key = targetKey({ designId: doc.id, draftId: null })
    activeTargetKeyRef.current = key
    setDocState({ docs: next, activeId: doc.id })
    setActiveDraftId(null)
    setDrafts([])
    setShapes([])
    lastSyncedShapes.current = []
    setTargetRevision(0)
    targetRevisionRef.current = 0
    setLoadedDocId(key)
    setDocLoading(false)
    setDocLoadError(null)
    setSyncConflict(null)
    restoreTargetEditorState(key, [])
  }

  const activateFigmaImport = (
    result: Awaited<ReturnType<typeof orpc.figma.import>>,
    destination: FigmaImportDestination,
  ) => {
    const imported = result.design
    if (destination === 'current') {
      const previousIds = new Set(shapesRef.current.map((shape) => shape.id))
      mutate(() => imported.shapes)
      saveTargetElements(activeTarget, imported.shapes)
      lastSyncedShapes.current = imported.shapes
      setTargetRevision(imported.revision)
      targetRevisionRef.current = imported.revision
      if (activeDraftId) {
        setDrafts((current) =>
          current.map((draft) =>
            draft.id === activeDraftId
              ? { ...draft, revision: imported.revision, updatedAt: imported.updatedAt }
              : draft,
          ),
        )
      }
      setSelectedIds(
        imported.shapes
          .filter((shape) => !previousIds.has(shape.id))
          .map((shape) => shape.id),
      )
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => canvasControls.current?.zoomToFit())
      })
      return
    }

    void flushActiveDoc()
    stashTargetEditorState(activeTargetKeyRef.current)
    documentRequest.current += 1
    const doc: DocMeta = { id: imported.id, name: imported.name }
    const next = [...docs.filter((candidate) => candidate.id !== doc.id), doc]
    saveElements(doc.id, imported.shapes)
    saveDocs(next, doc.id)
    localDesignRef.current = doc.id
    void setUrlState({ d: doc.id, draft: null })
    activeIdRef.current = doc.id
    activeDraftIdRef.current = null
    const key = targetKey({ designId: doc.id, draftId: null })
    activeTargetKeyRef.current = key
    setDocState({ docs: next, activeId: doc.id })
    setActiveDraftId(null)
    setDrafts([])
    setShapes(imported.shapes)
    lastSyncedShapes.current = imported.shapes
    setLoadedDocId(key)
    setDocLoading(false)
    setDocLoadError(null)
    targetSelections.current.delete(key)
    targetHistories.current.delete(key)
    restoreTargetEditorState(key, imported.shapes)
    if (databaseReady) void fetchDocument({ designId: doc.id, draftId: null }, true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => canvasControls.current?.zoomToFit())
    })
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
    for (const key of targetSelections.current.keys()) {
      if (key.startsWith(`${activeId}:`)) targetSelections.current.delete(key)
    }
    for (const key of targetHistories.current.keys()) {
      if (key.startsWith(`${activeId}:`)) targetHistories.current.delete(key)
    }
    if (!preview) {
      localDesignRef.current = nextId
      void setUrlState({ d: nextId, draft: null })
    }
    activeIdRef.current = nextId
    activeDraftIdRef.current = null
    const target = { designId: nextId, draftId: null }
    const key = targetKey(target)
    activeTargetKeyRef.current = key
    const cached = hasStoredTargetElements(target)
    const cachedShapes = cached ? loadTargetElements(target) : []
    setDocState({ docs: next, activeId: nextId })
    setActiveDraftId(null)
    setDrafts([])
    setShapes(cachedShapes)
    lastSyncedShapes.current = cachedShapes
    setLoadedDocId(cached ? key : null)
    setDocLoadError(null)
    setSyncConflict(null)
    restoreTargetEditorState(key, cachedShapes)
    if (databaseReady) {
      void Promise.all([
        fetchDocument(target, cached),
        orpc.draft
          .list({ designId: nextId, includeArchived: true })
          .then(setDrafts)
          .catch((error) => console.error('[drafts] Failed to list drafts:', error)),
      ])
    }
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
        const id = activeTargetKeyRef.current
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

  const deleteIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const target = new Set(ids)
      mutate((prev) => prev.filter((s) => !target.has(s.id)))
      setSelectedIds((sel) => sel.filter((id) => !target.has(id)))
    },
    [mutate],
  )

  const deleteSelected = useCallback(() => {
    deleteIds(selectedIdsRef.current)
  }, [deleteIds])

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

  const duplicateIds = useCallback(
    (ids: string[]) => {
      const wanted = new Set(ids)
      const targets = shapesRef.current.filter((s) => wanted.has(s.id))
      if (targets.length === 0) return
      const copies = remapGroups(targets).map((s) => ({
        ...s,
        id: elementId(),
        x: s.x + 16,
        y: s.y + 16,
      }))
      mutate((prev) => [...prev, ...copies])
      setSelectedIds(copies.map((c) => c.id))
    },
    [mutate],
  )

  const duplicateSelected = useCallback(() => {
    duplicateIds(selectedIdsRef.current)
  }, [duplicateIds])

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

  const groupIds = useCallback(
    (ids: string[]) => {
      if (ids.length < 2) return
      const target = new Set(ids)
      const gid = `g${elementId()}`
      mutate((prev) => prev.map((s) => (target.has(s.id) ? { ...s, groupId: gid } : s)))
    },
    [mutate],
  )

  const ungroupIds = useCallback(
    (ids: string[]) => {
      const target = new Set(ids)
      mutate((prev) => prev.map((s) => (target.has(s.id) ? { ...s, groupId: undefined } : s)))
    },
    [mutate],
  )

  const groupSelected = useCallback(() => {
    groupIds(selectedIdsRef.current)
  }, [groupIds])

  const ungroupSelected = useCallback(() => {
    ungroupIds(selectedIdsRef.current)
  }, [ungroupIds])

  // Hiding drops the element from the selection: canvas chrome for something
  // that is not on screen is a dead end.
  const setLayerFlags = useCallback(
    (ids: string[], patch: { hidden?: boolean; locked?: boolean }) => {
      if (ids.length === 0) return
      const target = new Set(ids)
      mutate((prev) =>
        prev.map((s) =>
          target.has(s.id)
            ? {
                ...s,
                ...(patch.hidden === undefined ? {} : { hidden: patch.hidden || undefined }),
                ...(patch.locked === undefined ? {} : { locked: patch.locked || undefined }),
              }
            : s,
        ),
      )
      if (patch.hidden === true) setSelectedIds((sel) => sel.filter((id) => !target.has(id)))
    },
    [mutate],
  )

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

  const queueHiddenTargetSave = useCallback(
    (target: CanvasTarget, ref: { current: CanvasElement[] }) => {
      const key = targetKey(target)
      const previous = targetSaveChains.current.get(key) ?? Promise.resolve()
      const next = previous
        .catch(() => {})
        .then(async () => {
          if (activeTargetKeyRef.current === key) return
          const revision = targetRevisions.current.get(key) ?? 0
          const currentShapes = ref.current
          const doc = docs.find((candidate) => candidate.id === target.designId)
          if (!doc) return
          try {
            const saved = target.draftId
              ? await orpc.draft.save({
                  id: target.draftId,
                  designId: target.designId,
                  shapes: currentShapes,
                  expectedRevision: revision,
                })
              : await orpc.design.save({
                  id: target.designId,
                  name: doc.name,
                  shapes: currentShapes,
                  expectedRevision: revision,
                })
            targetRevisions.current.set(key, saved.revision)
            targetLastSynced.current.set(key, currentShapes)
            if (target.draftId) {
              setDrafts((all) =>
                all.map((draft) =>
                  draft.id === target.draftId
                    ? { ...draft, revision: saved.revision, updatedAt: saved.updatedAt }
                    : draft,
                ),
              )
            }
          } catch (error) {
            console.error('[designs] Hidden target save conflicted:', error)
            const remote = target.draftId
              ? await orpc.draft.get({ designId: target.designId, id: target.draftId })
              : await orpc.design.get({ id: target.designId })
            const base = targetLastSynced.current.get(key) ?? remote.shapes
            const reconciled = mergeCanvas(base, remote.shapes, ref.current)
            if (reconciled.unresolved.length > 0) {
              console.error(
                `[designs] Hidden target has ${reconciled.unresolved.length} unresolved conflicts.`,
              )
              return
            }
            ref.current = reconciled.shapes
            saveTargetElements(target, reconciled.shapes)
            targetRevisions.current.set(key, remote.revision)
            targetLastSynced.current.set(key, remote.shapes)
            const saved = target.draftId
              ? await orpc.draft.save({
                  id: target.draftId,
                  designId: target.designId,
                  shapes: reconciled.shapes,
                  expectedRevision: remote.revision,
                })
              : await orpc.design.save({
                  id: target.designId,
                  name: doc.name,
                  shapes: reconciled.shapes,
                  expectedRevision: remote.revision,
                })
            targetRevisions.current.set(key, saved.revision)
            targetLastSynced.current.set(key, reconciled.shapes)
          }
        })
      targetSaveChains.current.set(key, next)
    },
    [docs],
  )

  const getTargetBindings = useCallback(
    (draftId: string | null) => {
      if (draftId === activeDraftIdRef.current) {
        return { actions, shapesRef }
      }

      const target = { designId: activeIdRef.current, draftId }
      const key = targetKey(target)
      let ref = targetShapeRefs.current.get(key)
      if (!ref) {
        ref = { current: loadTargetElements(target) }
        targetShapeRefs.current.set(key, ref)
        const draft = draftId
          ? drafts.find((candidate) => candidate.id === draftId)
          : null
        targetRevisions.current.set(key, draft?.revision ?? 0)
        targetLastSynced.current.set(key, ref.current)
      }

      let hiddenActions = targetActions.current.get(key)
      if (!hiddenActions) {
        const mutateHidden = (fn: (elements: CanvasElement[]) => CanvasElement[]) => {
          const next = fn(ref!.current)
          ref!.current = next
          saveTargetElements(target, next)
          queueHiddenTargetSave(target, ref!)
          return next
        }
        hiddenActions = {
          createElement(element) {
            const full = { ...element, id: element.id ?? elementId() }
            mutateHidden((current) => [...current, full])
            return full
          },
          createElements(batch) {
            const full = batch.map((element) => ({ ...element, id: elementId() }))
            mutateHidden((current) => [...current, ...full])
            return full
          },
          updateElement(id, patch) {
            let updated: CanvasElement | null = null
            mutateHidden((current) =>
              current.map((element) => {
                if (element.id !== id) return element
                updated = { ...element, ...patch }
                return updated
              }),
            )
            return updated ?? ref!.current.find((element) => element.id === id) ?? null
          },
          deleteElement(id) {
            const exists = ref!.current.some((element) => element.id === id)
            mutateHidden((current) => current.filter((element) => element.id !== id))
            return exists
          },
          reorderElements(orderedIds) {
            const next = mutateHidden((current) => reorderElements(current, orderedIds))
            return next.map((element) => element.id)
          },
          groupElements(ids) {
            const wanted = new Set(ids)
            const targets = ref!.current.filter((element) => wanted.has(element.id))
            if (targets.length < 2) return null
            const groupId = `g${elementId()}`
            mutateHidden((current) =>
              current.map((element) =>
                wanted.has(element.id) ? { ...element, groupId } : element,
              ),
            )
            return { groupId, ids: targets.map((element) => element.id) }
          },
          ungroupElements(ids) {
            const wanted = new Set(ids)
            const count = ref!.current.filter(
              (element) => wanted.has(element.id) && element.groupId,
            ).length
            mutateHidden((current) =>
              current.map((element) =>
                wanted.has(element.id) ? { ...element, groupId: undefined } : element,
              ),
            )
            return count
          },
        }
        targetActions.current.set(key, hiddenActions)
      }
      return { actions: hiddenActions, shapesRef: ref }
    },
    [actions, drafts, queueHiddenTargetSave],
  )

  const reorder = useCallback(
    (dir: 'forward' | 'backward' | 'front' | 'back', ids?: string[]) => {
      const sel = new Set(ids ?? selectedIdsRef.current)
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
    [mutate],
  )

  useEffect(() => {
    if (preview) return
    const onKeyDown = (e: KeyboardEvent) => {
      const hit = matchShortcut(e, shortcutConfig)
      if (hit?.kind === 'builtIn' && hit.id === 'openCommandMenu') {
        e.preventDefault()
        setCommandMenuOpen((open) => !open)
        return
      }
      if (isEditableTarget(e.target)) return
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
        case 'openCommandMenu':
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
  // Memoised so the memo() on LayersPanel survives unrelated Editor renders —
  // the rail re-renders on every canvas drag frame otherwise.
  const layersPanelProps = useMemo(
    () => ({
      elements: shapes,
      selectedIds,
      onSelect: setSelectedIds,
      onReorderList: (orderedIds: string[]) =>
        mutate((prev) => reorderElements(prev, orderedIds)),
      onRename: (id: string, name: string) => {
        updateElement(id, { name })
      },
      onSetFlags: setLayerFlags,
      onDuplicate: duplicateIds,
      onDelete: deleteIds,
      onGroup: groupIds,
      onUngroup: ungroupIds,
      onRaise: (ids: string[]) => reorder('forward', ids),
      onLower: (ids: string[]) => reorder('backward', ids),
      onHover: setHoveredLayerIds,
    }),
    [
      shapes,
      selectedIds,
      mutate,
      updateElement,
      setLayerFlags,
      duplicateIds,
      deleteIds,
      groupIds,
      ungroupIds,
      reorder,
    ],
  )

  const commandGroups: EditorCommandGroup[] = [
    {
      label: 'Figma',
      commands: [
        {
          id: 'figma-current',
          label: 'Import Figma into current document',
          keywords: 'paste append frame design',
          icon: FigmaIcon,
          run: () => openFigmaImport('current'),
        },
        {
          id: 'figma-new',
          label: 'Import Figma as new document',
          keywords: 'paste file design create',
          icon: FigmaIcon,
          run: () => openFigmaImport('new'),
        },
      ],
    },
    {
      label: 'Documents',
      commands: [
        {
          id: 'document-new',
          label: 'New document',
          keywords: 'create file',
          icon: FilePlus2Icon,
          run: newDoc,
        },
        ...docs.map((doc) => ({
          id: `document-${doc.id}`,
          label: `Open ${doc.name}`,
          keywords: 'switch document file',
          icon: FileIcon,
          active: doc.id === activeId,
          run: () => switchDoc(doc.id),
        })),
        {
          id: 'document-export',
          label: 'Export and hand off',
          keywords: 'download share',
          icon: DownloadIcon,
          disabled: shapes.length === 0,
          run: () => setExportOpen(true),
        },
      ],
    },
    {
      label: 'Edit',
      commands: [
        {
          id: 'edit-undo',
          label: 'Undo',
          icon: Undo2Icon,
          shortcut: shortcutLabel('undo'),
          disabled: past.current.length === 0,
          run: undo,
        },
        {
          id: 'edit-redo',
          label: 'Redo',
          icon: Redo2Icon,
          shortcut: shortcutLabel('redo'),
          disabled: future.current.length === 0,
          run: redo,
        },
        {
          id: 'edit-select-all',
          label: 'Select all',
          icon: MousePointer2Icon,
          shortcut: shortcutLabel('selectAll'),
          disabled: shapes.length === 0,
          run: () => setSelectedIds(shapes.map((shape) => shape.id)),
        },
        {
          id: 'edit-duplicate',
          label: 'Duplicate selection',
          icon: CopyIcon,
          shortcut: shortcutLabel('duplicate'),
          disabled: selectedIds.length === 0,
          run: duplicateSelected,
        },
        {
          id: 'edit-delete',
          label: 'Delete selection',
          icon: Trash2Icon,
          shortcut: shortcutLabel('delete'),
          disabled: selectedIds.length === 0,
          run: deleteSelected,
        },
      ],
    },
    {
      label: 'View',
      commands: [
        {
          id: 'view-agent',
          label: 'Toggle agent panel',
          icon: SparklesIcon,
          shortcut: shortcutLabel('toggleAgent'),
          active: agentOpen,
          run: () => toggleAgent(!agentOpen),
        },
        {
          id: 'view-layers',
          label: 'Toggle layers',
          icon: LayersIcon,
          shortcut: shortcutLabel('toggleLayers'),
          active: layersOpen,
          run: () => toggleLayers(!layersOpen),
        },
        {
          id: 'view-assets',
          label: 'Toggle assets',
          icon: ImageIcon,
          shortcut: shortcutLabel('toggleAssets'),
          active: assetsOpen,
          run: () => toggleAssets(!assetsOpen),
        },
        {
          id: 'view-history',
          label: 'Toggle history',
          icon: HistoryIcon,
          shortcut: shortcutLabel('toggleHistory'),
          active: historyOpen,
          run: () => toggleHistory(!historyOpen),
        },
        {
          id: 'view-code',
          label: 'Edit selected element code',
          keywords: 'html css source',
          icon: CodeXmlIcon,
          shortcut: shortcutLabel('toggleCode'),
          disabled: selectedIds.length !== 1,
          active: codeOpen,
          run: () => toggleCode(true),
        },
        {
          id: 'view-zoom-fit',
          label: 'Zoom to fit',
          icon: MaximizeIcon,
          shortcut: shortcutLabel('zoomToFit'),
          run: () => canvasControls.current?.zoomToFit(),
        },
        {
          id: 'view-settings',
          label: 'Open settings',
          icon: SettingsIcon,
          shortcut: shortcutLabel('openSettings'),
          run: () => setSettingsOpen(true),
        },
      ],
    },
    {
      label: 'Tools',
      commands: TOOLS.map(({ tool: nextTool, icon, label }) => ({
        id: `tool-${nextTool}`,
        label: `${label} tool`,
        icon,
        shortcut: shortcutLabel(`tool.${nextTool}` as BuiltInShortcutId),
        active: tool === nextTool,
        run: () => setTool(nextTool),
      })),
    },
  ]

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
        draftId={activeDraftId}
        getTargetBindings={getTargetBindings}
        isTargetReadOnly={(draftId) =>
          Boolean(
            draftId &&
              drafts.find((draft) => draft.id === draftId)?.status !== 'active',
          )
        }
        branches={drafts}
        onTargetChange={(draftId, options) => {
          if (options?.announce) switchBranchWithNotice(draftId)
          else switchDraft(draftId)
        }}
        onCreateBranch={async (name) => {
          await flushActiveDoc()
          const created = await orpc.draft.create({
            id: `dr${crypto.randomUUID().replaceAll('-', '')}`,
            designId: activeIdRef.current,
            name,
          })
          setDrafts((current) => [created, ...current])
          switchDraft(created.id, true)
          announceBranch(`Created branch ${created.name}`)
          return created
        }}
        onRunningTargetsChange={setRunningTargets}
        ready={databaseReady}
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
              hoveredIds={hoveredLayerIds}
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
                          `/blockpage/${encodeURIComponent(activeId)}?${activeDraftId ? `draft=${encodeURIComponent(activeDraftId)}&` : ''}element=${encodeURIComponent(contextMenuIds[0])}`,
                          '_blank',
                          'noopener',
                        )
                      }
                    >
                      <MaximizeIcon data-slot="icon" />
                      Open as page
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

        {loadedDocId !== activeTargetKey && (
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
                  onClick={() => void fetchDocument(activeTarget, hasStoredTargetElements(activeTarget))}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}
        {!docLoading && loadedDocId === activeTargetKey && docLoadError && (
          <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
            <div
              role="alert"
              className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive-foreground shadow-sm"
            >
              <span>{docLoadError}</span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void fetchDocument(activeTarget, hasStoredTargetElements(activeTarget))}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Below md a docked rail would eat the canvas, so it stays a drawer. */}
        {isMobile ? (
          <Drawer open={layersOpen} onOpenChange={toggleLayers} position="bottom">
            <DrawerPopup
              position="bottom"
              variant="inset"
              className="mx-auto h-[min(50svh,28rem)] w-full max-w-sm overflow-hidden rounded-2xl border"
            >
              <LayersPanel {...layersPanelProps} onClose={() => toggleLayers(false)} />
            </DrawerPopup>
          </Drawer>
        ) : null}

        <Drawer open={assetsOpen} onOpenChange={toggleAssets} position="bottom">
          <DrawerPopup
            position="bottom"
            variant="inset"
            className="h-[min(60svh,32rem)] overflow-hidden rounded-2xl border"
          >
            <AssetsPanel onInsert={insertAsset} />
          </DrawerPopup>
        </Drawer>

        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogPopup
            showCloseButton={false}
            className="h-[min(70svh,36rem)] overflow-hidden p-0"
          >
            <SettingsPanel
              onClose={() => setSettingsOpen(false)}
              shortcutConfig={shortcutConfig}
              onShortcutConfigChange={updateShortcutConfig}
              agentSystemPrompt={agentSystemPrompt}
              onSaveAgentSystemPrompt={saveAgentSystemPrompt}
            />
          </DialogPopup>
        </Dialog>

        <div className="absolute top-4 right-4 flex items-center gap-1">
          {!preview ? (
            <Button
              variant={commandMenuOpen ? 'secondary' : 'ghost'}
              size="icon"
              aria-label={`Commands (${shortcutLabel('openCommandMenu')})`}
              title={`Commands (${shortcutLabel('openCommandMenu')})`}
              aria-pressed={commandMenuOpen}
              onClick={() => setCommandMenuOpen(true)}
            >
              <CommandIcon data-slot="icon" />
            </Button>
          ) : null}
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
            draftId={activeDraftId}
            storageId={activeTargetKey}
            readOnly={
              activeDraftId !== null &&
              drafts.find((draft) => draft.id === activeDraftId)?.status !== 'active'
            }
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

        <AnimatePresence>
          {branchNotice ? (
            <motion.div
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="pointer-events-none absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded-full border bg-popover/95 px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-sm backdrop-blur"
            >
              {branchNotice}
            </motion.div>
          ) : null}
        </AnimatePresence>

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
            onImport={() => openFigmaImport('new')}
            onRename={renameDoc}
            onDelete={deleteDoc}
          />
          {!preview ? (
            <>
              <span className="text-muted-foreground/50">/</span>
              <BranchControls
                designId={activeId}
                branches={drafts}
                activeBranchId={activeDraftId}
                runningBranchIds={runningTargets.filter(
                  (draftId): draftId is string => draftId !== null,
                )}
                onSwitch={switchBranchWithNotice}
                onCreated={(branch) => {
                  setDrafts((current) => [branch, ...current])
                  switchDraft(branch.id, true)
                  announceBranch(`Created branch ${branch.name}`)
                }}
                onChanged={refreshDrafts}
                onApplied={(nextShapes, revision, branchName) => {
                  stashTargetEditorState(activeTargetKeyRef.current)
                  const mainTarget = { designId: activeId, draftId: null }
                  const key = targetKey(mainTarget)
                  saveTargetElements(mainTarget, nextShapes)
                  targetSelections.current.delete(key)
                  targetHistories.current.delete(key)
                  activeDraftIdRef.current = null
                  activeTargetKeyRef.current = key
                  setActiveDraftId(null)
                  setShapes(nextShapes)
                  shapesRef.current = nextShapes
                  lastSyncedShapes.current = nextShapes
                  setTargetRevision(revision)
                  targetRevisionRef.current = revision
                  setLoadedDocId(key)
                  setSyncConflict(null)
                  restoreTargetEditorState(key, nextShapes)
                  saveActiveDraft(activeId, null)
                  void setUrlState({ draft: null })
                  announceBranch(`Merged ${branchName} into Main`)
                }}
                flush={flushActiveDoc}
              />
            </>
          ) : null}
        </div>

        <Dialog open={syncConflict !== null} onOpenChange={() => {}}>
          <DialogPopup className="max-w-xl" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Resolve concurrent changes</DialogTitle>
              <DialogDescription>
                This target changed somewhere else while you were editing. Choose which version
                to keep for each conflict, or reload to discard your local changes.
              </DialogDescription>
            </DialogHeader>
            {syncConflict ? (
              <div className="min-h-0 space-y-2 overflow-y-auto px-6 py-2">
                {syncConflict.conflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {conflict.kind === 'order'
                          ? 'Layer order'
                          : `Element ${conflict.elementId}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conflict.kind === 'order'
                          ? 'Both versions reordered the same layers differently.'
                          : 'Both versions changed or removed this element differently.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant={
                          syncResolutions[conflict.id] === 'main' ? 'default' : 'outline'
                        }
                        onClick={() =>
                          setSyncResolutions((current) => ({
                            ...current,
                            [conflict.id]: 'main',
                          }))
                        }
                      >
                        Remote
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          syncResolutions[conflict.id] === 'draft' ? 'default' : 'outline'
                        }
                        onClick={() =>
                          setSyncResolutions((current) => ({
                            ...current,
                            [conflict.id]: 'draft',
                          }))
                        }
                      >
                        Mine
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={reloadAfterSyncConflict}>
                Reload target
              </Button>
              <Button
                disabled={
                  !syncConflict ||
                  syncConflict.conflicts.some(
                    (conflict) => !syncResolutions[conflict.id],
                  )
                }
                onClick={resolveSyncConflict}
              >
                Merge and save
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>

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
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit code"
                  title="Edit code"
                  onClick={() => toggleCode(true)}
                >
                  <CodeXmlIcon data-slot="icon" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open as page"
                  title="Open as page"
                  onClick={() =>
                    window.open(
                      `/blockpage/${encodeURIComponent(activeId)}?${activeDraftId ? `draft=${encodeURIComponent(activeDraftId)}&` : ''}element=${encodeURIComponent(selectedShapes[0].id)}`,
                      '_blank',
                      'noopener',
                    )
                  }
                >
                  <MaximizeIcon data-slot="icon" />
                </Button>
                {!activeDraftId ? (
                  <PublishButton
                    key={selectedShapes[0].id}
                    designId={activeId}
                    elementId={selectedShapes[0].id}
                  />
                ) : null}
              </>
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
          key={activeTargetKey}
          open={exportOpen}
          onOpenChange={setExportOpen}
          doc={docs.find((doc) => doc.id === activeId) ?? { id: activeId, name: 'Untitled' }}
          shapes={shapes}
          selectedIds={selectedIds}
          databaseReady={databaseReady}
          draftId={activeDraftId}
          flush={flushActiveDoc}
        />

        <FigmaImportDialog
          open={figmaImportOpen}
          onOpenChange={setFigmaImportOpen}
          onImported={activateFigmaImport}
          initialDestination={figmaImportDestination}
          currentDocument={{
            id: activeId,
            name: docs.find((doc) => doc.id === activeId)?.name ?? 'Untitled',
            shapes,
            draftId: activeDraftId,
            revision: targetRevision,
          }}
        />

        {!preview ? (
          <EditorCommandMenu
            open={commandMenuOpen}
            onOpenChange={setCommandMenuOpen}
            groups={commandGroups}
          />
        ) : null}

      </main>

      {/* Docked layers rail: takes width from the canvas rather than covering
          it, so nothing you are arranging can hide behind the panel. */}
      {!isMobile && layersOpen ? (
        <div
          className="relative flex shrink-0 py-2 pe-2"
          style={{ width: layersWidth }}
        >
          <div
            role="separator"
            aria-label="Resize layers panel"
            aria-orientation="vertical"
            className="absolute inset-y-0 -start-1 z-20 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:start-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-cx-accent/40"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setResizingLayers(true)
            }}
            onPointerMove={(event) => {
              if (!resizingLayers) return
              setLayersWidth(clampLayersWidth(window.innerWidth - event.clientX))
            }}
            onPointerUp={(event) => {
              if (!resizingLayers) return
              event.currentTarget.releasePointerCapture(event.pointerId)
              setResizingLayers(false)
              if (!preview) {
                window.localStorage.setItem('loora:layers-width', String(layersWidth))
              }
            }}
          />
          <div className="flex min-h-0 w-full overflow-hidden rounded-2xl border bg-card shadow-sm">
            <LayersPanel {...layersPanelProps} onClose={() => toggleLayers(false)} />
          </div>
        </div>
      ) : null}

    </SidebarProvider>
  )
}
