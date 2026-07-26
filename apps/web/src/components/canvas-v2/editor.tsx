import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ElementType,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  BringToFrontIcon,
  CheckIcon,
  ClipboardIcon,
  CodeXmlIcon,
  CommandIcon,
  ComponentIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FrameIcon,
  GroupIcon,
  HandIcon,
  ImageIcon,
  LayersIcon,
  Link2Icon,
  MaximizeIcon,
  MousePointer2Icon,
  PanelsTopLeftIcon,
  Redo2Icon,
  RectangleHorizontalIcon,
  SendToBackIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  UngroupIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import {
  CanvasProvider,
  CanvasSurface,
  type CanvasCamera,
  type CanvasSurfaceControls,
  useCanvasDocument,
  useCanvasDomRegistry,
  useCanvasHistory,
  useCanvasReadOnly,
  useCanvasSelection,
  useCanvasSession,
  useCanvasTransaction,
} from '@loora/canvas/react'
import {
  canvasId,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  createTextNode,
  defaultLayout,
  defaultStyle,
  orderedChildren,
  resolveNodeRef,
  type CanvasNode,
  type CanvasDocumentV2,
  type GroupNode,
  type ImageNode,
  type NodeRef,
  type ShapeNode,
} from '@loora/canvas/model'
import {
  compileReactComponent,
  compileStandaloneHtml,
  serializeCanvasDocument,
} from '@loora/canvas/export'
import type {
  CanvasSyncStatus,
  CanvasSyncTarget,
} from '#/lib/canvas-v2-client'
import type {
  CanvasEngine,
  CanvasOperation,
  CanvasTransaction,
} from '@loora/canvas/engine'
import { CanvasV2LayersPanel } from './layers-panel'
import { CanvasV2PropertiesPanel } from './properties-panel'
import { CanvasV2AgentPanel } from './agent-panel'
import { CanvasV2Comment } from './comment'
import { CanvasV2History } from './history'
import { CanvasV2Publish } from './publish'
import {
  AssetsPanel,
  type AssetMeta,
} from '#/components/assets-panel'
import {
  EditorCommandMenu,
  type EditorCommandGroup,
} from '#/components/editor-command-menu'
import { SettingsPanel } from '#/components/settings-panel'
import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import { orpc } from '#/lib/orpc-client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Drawer, DrawerPopup } from '#/components/ui/drawer'
import {
  Sidebar,
  SidebarProvider,
} from '#/components/ui/sidebar'
import { useIsMobile } from '#/hooks/use-media-query'
import {
  cacheShortcuts,
  formatBuiltInChord,
  isEditableTarget,
  loadCachedShortcuts,
  matchShortcut,
  normalizeConfig,
  type BuiltInShortcutId,
  type ShortcutConfig,
} from '#/lib/shortcuts'
import { cn } from '#/lib/utils'
import {
  captureCanvasPng,
  captureNodePng,
} from '#/lib/canvas-v2-capture'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'

const INSPECTOR_MIN_WIDTH = 220
const INSPECTOR_MAX_WIDTH = 420

function clampInspectorWidth(width: number) {
  return Math.round(
    Math.min(
      INSPECTOR_MAX_WIDTH,
      Math.max(INSPECTOR_MIN_WIDTH, width),
    ),
  )
}

export function CanvasV2Editor({
  controller,
  name,
  topBar,
  readOnly = false,
  queuedAgentPrompt,
  onQueuedAgentPromptConsumed,
}: {
  controller: CanvasEditorController
  name: string
  topBar?: ReactNode
  readOnly?: boolean
  queuedAgentPrompt?: { id: string; message: string } | null
  onQueuedAgentPromptConsumed?: () => void
}) {
  return (
    <CanvasProvider
      engine={controller.engine}
      readOnly={readOnly}
      onTransaction={(transaction) => controller.enqueue(transaction)}
    >
      <CanvasV2Shell
        controller={controller}
        name={name}
        topBar={topBar}
        readOnly={readOnly}
        queuedAgentPrompt={queuedAgentPrompt}
        onQueuedAgentPromptConsumed={onQueuedAgentPromptConsumed}
      />
    </CanvasProvider>
  )
}

function cameraStorageKey(target: CanvasSyncTarget | undefined) {
  return target
    ? `loora:canvas-v2:camera:${target.designId}:${target.draftId ?? 'main'}`
    : 'loora:canvas-v2:camera:preview'
}

function loadCamera(key: string): Partial<CanvasCamera> {
  if (typeof window === 'undefined') return {}
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    if (
      value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Number.isFinite(value.zoom)
    ) {
      return value
    }
  } catch {
    // A broken camera cache is disposable.
  }
  return {}
}

function requestedPreviewWidth(fallback: number) {
  if (typeof window === 'undefined') return fallback
  const width = Number(new URLSearchParams(window.location.search).get('width'))
  return Number.isFinite(width) && width > 0 ? width : fallback
}

function initialAgentOpen() {
  if (typeof window === 'undefined') return true
  const requested = new URLSearchParams(window.location.search).get('agent')
  if (requested === '0' || requested === 'false') return false
  if (requested === '1' || requested === 'true') return true
  return window.localStorage.getItem('loora:agent') !== '0'
}

function CanvasV2Shell({
  controller,
  name,
  topBar,
  readOnly,
  queuedAgentPrompt,
  onQueuedAgentPromptConsumed,
}: {
  controller: CanvasEditorController
  name: string
  topBar?: ReactNode
  readOnly: boolean
  queuedAgentPrompt?: { id: string; message: string } | null
  onQueuedAgentPromptConsumed?: () => void
}) {
  const isMobile = useIsMobile()
  const canvasSession = useCanvasSession()
  const controlsRef = useRef<CanvasSurfaceControls>(null)
  const [inspector, setInspector] = useState<'layers' | 'design' | null>(
    () => (isMobile ? null : 'layers'),
  )
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(initialAgentOpen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [interactionMode, setInteractionMode] = useState<'select' | 'pan'>(
    'select',
  )
  const [queuedPrompt, setQueuedPrompt] = useState<{
    id: string
    message: string
  } | null>(null)
  const [previewWidth, setPreviewWidth] = useState(() =>
    requestedPreviewWidth(
      controller.engine.document.breakpoints.at(-1)?.previewWidth ?? 1440,
    ),
  )
  const [zoom, setZoom] = useState(0.75)
  const [agentWidth, setAgentWidth] = useState(() => {
    if (typeof window === 'undefined') return 340
    const value = Number(window.localStorage.getItem('loora:agent-width'))
    return Number.isFinite(value)
      ? Math.min(640, Math.max(280, Math.round(value)))
      : 340
  })
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    if (typeof window === 'undefined') return 280
    const value = Number(window.localStorage.getItem('loora:layers-width'))
    return Number.isFinite(value) && value > 0
      ? clampInspectorWidth(value)
      : 280
  })
  const [resizingInspector, setResizingInspector] = useState(false)
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>(() =>
    controller.target
      ? loadCachedShortcuts()
      : { overrides: {}, custom: [] },
  )
  const [agentSystemPrompt, setAgentSystemPrompt] = useState<string | null>(
    controller.target ? null : '',
  )
  const cameraKey = cameraStorageKey(controller.target)
  const initialCamera = useMemo(() => loadCamera(cameraKey), [cameraKey])
  const actions = useCanvasEditorActions()

  useEffect(() => {
    window.localStorage.setItem('loora:agent', agentOpen ? '1' : '0')
  }, [agentOpen])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const nodeId = params.get('node') ?? params.get('page')
    if (!nodeId || !controller.engine.document.nodes[nodeId]) return
    const instancePath = params.get('instancePath')
      ?.split('/')
      .filter(Boolean) ?? []
    const ref = {
      nodeId,
      instancePath: params.has('node') ? instancePath : [],
    }
    try {
      if (!resolveNodeRef(controller.engine.document, ref)) return
      canvasSession.select([ref])
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() =>
          controlsRef.current?.zoomToSelection(),
        )
      })
    } catch {
      // Stale visual links open the document without forcing a selection.
    }
  }, [canvasSession, controller.engine])

  useEffect(() => {
    if (!queuedAgentPrompt) return
    setAgentOpen(true)
    setQueuedPrompt(queuedAgentPrompt)
    onQueuedAgentPromptConsumed?.()
  }, [onQueuedAgentPromptConsumed, queuedAgentPrompt?.id])

  useEffect(() => {
    if (!controller.target) return
    let cancelled = false
    void orpc.preferences
      .get()
      .then((preferences) => {
        if (cancelled) return
        const next = normalizeConfig(preferences.shortcuts)
        setShortcutConfig(next)
        setAgentSystemPrompt(preferences.agentSystemPrompt)
        cacheShortcuts(next)
      })
      .catch((cause) => {
        console.error('[preferences] Failed to load preferences:', cause)
        if (!cancelled) setAgentSystemPrompt('')
      })
    return () => {
      cancelled = true
    }
  }, [controller.target?.designId])

  const updateShortcutConfig = (next: ShortcutConfig) => {
    const normalized = normalizeConfig(next)
    setShortcutConfig(normalized)
    cacheShortcuts(normalized)
    void orpc.preferences
      .save({ shortcuts: normalized })
      .catch((cause) =>
        console.error('[preferences] Failed to save shortcuts:', cause),
      )
  }

  const saveAgentSystemPrompt = async (prompt: string) => {
    const saved = await orpc.preferences.saveAgentPrompt({ prompt })
    setAgentSystemPrompt(saved.agentSystemPrompt)
  }

  const shortcutLabel = (id: BuiltInShortcutId) =>
    formatBuiltInChord(id, shortcutConfig)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const match = matchShortcut(event, shortcutConfig)
      if (!match) return
      if (match.kind === 'custom') {
        event.preventDefault()
        if (!controller.target) return
        setAgentOpen(true)
        setQueuedPrompt({
          id: crypto.randomUUID(),
          message: match.prompt,
        })
        return
      }
      const hit = match.id
      const run = () => {
        if (hit === 'toggleAgent') setAgentOpen((open) => !open)
        else if (hit === 'toggleLayers') {
          setInspector((current) =>
            current === 'layers' ? null : 'layers',
          )
        } else if (hit === 'toggleAssets') {
          setAssetsOpen((open) => !open)
        } else if (hit === 'openCommandMenu') setCommandMenuOpen(true)
        else if (hit === 'openSettings') setSettingsOpen(true)
        else if (hit === 'zoomIn') controlsRef.current?.zoomIn()
        else if (hit === 'zoomOut') controlsRef.current?.zoomOut()
        else if (hit === 'zoomReset') controlsRef.current?.zoomReset()
        else if (hit === 'zoomToFit') controlsRef.current?.zoomToFit()
        else if (hit === 'zoomToSelection') {
          controlsRef.current?.zoomToSelection()
        } else if (hit === 'tool.select') setInteractionMode('select')
        else if (hit === 'tool.hand') setInteractionMode('pan')
        else if (hit === 'tool.text') actions.addText()
        else if (hit === 'tool.box') actions.addShape()
        else if (hit === 'tool.image') setAssetsOpen(true)
        else if (hit === 'undo') actions.history.undo()
        else if (hit === 'redo') actions.history.redo()
        else if (hit === 'duplicate') actions.duplicateSelection()
        else if (hit === 'group') actions.groupSelection()
        else if (hit === 'ungroup') actions.ungroupSelection()
        else if (hit === 'delete') actions.deleteSelection()
        else if (hit === 'bringForward') actions.reorderSelection('forward')
        else if (hit === 'bringToFront') actions.reorderSelection('front')
        else if (hit === 'sendBackward') actions.reorderSelection('backward')
        else if (hit === 'sendToBack') actions.reorderSelection('back')
        else if (hit === 'nudgeLeft') actions.nudgeSelection(-1, 0)
        else if (hit === 'nudgeRight') actions.nudgeSelection(1, 0)
        else if (hit === 'nudgeUp') actions.nudgeSelection(0, -1)
        else if (hit === 'nudgeDown') actions.nudgeSelection(0, 1)
        else return false
        return true
      }
      if (run()) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions, shortcutConfig])

  const commandGroups: EditorCommandGroup[] = [
    {
      label: 'Insert',
      commands: [
        {
          id: 'insert-page',
          label: 'New Page',
          icon: PanelsTopLeftIcon,
          disabled: readOnly,
          run: actions.addPage,
        },
        {
          id: 'insert-frame',
          label: 'Insert frame',
          icon: FrameIcon,
          disabled: readOnly || !actions.parent,
          run: actions.addFrame,
        },
        {
          id: 'insert-text',
          label: 'Insert text',
          icon: TypeIcon,
          disabled: readOnly || !actions.parent,
          run: actions.addText,
        },
        {
          id: 'insert-shape',
          label: 'Insert rectangle',
          icon: RectangleHorizontalIcon,
          disabled: readOnly || !actions.parent,
          run: actions.addShape,
        },
        {
          id: 'insert-component',
          label: 'Create component',
          icon: ComponentIcon,
          disabled: readOnly || !actions.parent,
          run: actions.addComponent,
        },
        {
          id: 'insert-image',
          label: 'Insert image',
          icon: ImageIcon,
          disabled: !controller.target || readOnly,
          run: () => setAssetsOpen(true),
        },
      ],
    },
    {
      label: 'Edit',
      commands: [
        {
          id: 'undo',
          label: 'Undo',
          icon: Undo2Icon,
          shortcut: shortcutLabel('undo'),
          disabled: readOnly || !actions.history.canUndo,
          run: () => actions.history.undo(),
        },
        {
          id: 'redo',
          label: 'Redo',
          icon: Redo2Icon,
          shortcut: shortcutLabel('redo'),
          disabled: readOnly || !actions.history.canRedo,
          run: () => actions.history.redo(),
        },
        {
          id: 'duplicate',
          label: 'Duplicate selection',
          icon: CopyIcon,
          shortcut: shortcutLabel('duplicate'),
          disabled: !actions.canDuplicate,
          run: actions.duplicateSelection,
        },
        {
          id: 'group',
          label: 'Group selection',
          icon: GroupIcon,
          shortcut: shortcutLabel('group'),
          disabled: !actions.canGroup,
          run: actions.groupSelection,
        },
        {
          id: 'delete',
          label: 'Delete selection',
          icon: Trash2Icon,
          shortcut: shortcutLabel('delete'),
          disabled: readOnly || actions.selection.length === 0,
          run: actions.deleteSelection,
        },
      ],
    },
    {
      label: 'View',
      commands: [
        {
          id: 'view-layers',
          label: 'Layers',
          icon: LayersIcon,
          active: inspector === 'layers',
          shortcut: shortcutLabel('toggleLayers'),
          run: () =>
            setInspector((current) =>
              current === 'layers' ? null : 'layers',
            ),
        },
        {
          id: 'view-design',
          label: 'Design properties',
          icon: SlidersHorizontalIcon,
          active: inspector === 'design',
          run: () =>
            setInspector((current) =>
              current === 'design' ? null : 'design',
            ),
        },
        {
          id: 'view-agent',
          label: 'Agent panel',
          icon: SparklesIcon,
          active: agentOpen,
          shortcut: shortcutLabel('toggleAgent'),
          disabled: !controller.target,
          run: () => setAgentOpen((open) => !open),
        },
        {
          id: 'zoom-fit',
          label: 'Zoom to fit',
          icon: MaximizeIcon,
          shortcut: shortcutLabel('zoomToFit'),
          run: () => controlsRef.current?.zoomToFit(),
        },
        {
          id: 'settings',
          label: 'Settings',
          icon: SettingsIcon,
          shortcut: shortcutLabel('openSettings'),
          disabled: !controller.target,
          run: () => setSettingsOpen(true),
        },
      ],
    },
  ]

  const inspectorPanel =
    inspector === 'layers' ? (
      <CanvasV2LayersPanel
        onReorder={actions.reorderSelection}
        canReorder={actions.canReorder}
        onClose={() => setInspector(null)}
      />
    ) : inspector === 'design' ? (
      <CanvasV2PropertiesPanel onClose={() => setInspector(null)} />
    ) : null

  const inspectorTitle = inspector === 'layers' ? 'Layers' : 'Design'

  return (
    <SidebarProvider
      open={agentOpen}
      onOpenChange={setAgentOpen}
      enableKeyboardShortcut={false}
      width={agentWidth}
      onWidthChange={(width) => {
        setAgentWidth(width)
        window.localStorage.setItem('loora:agent-width', String(width))
      }}
      className="h-full min-h-0 bg-background"
    >
      {controller.target ? (
        <Sidebar
          side="left"
          variant="sidebar"
          collapsible="offcanvas"
          resizable
          className="[&_[data-slot=sidebar-inner]]:overflow-hidden [&_[data-slot=sidebar-inner]]:border-e"
        >
          <CanvasV2AgentPanel
            target={controller.target}
            readOnly={readOnly}
            queuedPrompt={queuedPrompt}
            onQueuedPromptConsumed={() => setQueuedPrompt(null)}
            onClose={() => setAgentOpen(false)}
          />
        </Sidebar>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
          <span className="shrink-0 ps-1 text-xs font-semibold tracking-tight">
            loora
          </span>
          <span className="text-muted-foreground/40 max-sm:hidden">/</span>
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden max-sm:max-w-40">
            {topBar ?? (
              <span className="max-w-48 truncate text-xs text-muted-foreground">
                {name}
              </span>
            )}
          </div>
          <span className="text-muted-foreground/40 max-sm:hidden">/</span>
          <div className="max-sm:hidden">
            {readOnly ? (
              <span className="text-[11px] text-muted-foreground">
                Read-only
              </span>
            ) : (
              <CanvasSyncIndicator controller={controller} />
            )}
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Commands (${shortcutLabel('openCommandMenu')})`}
              title={`Commands (${shortcutLabel('openCommandMenu')})`}
              onClick={() => setCommandMenuOpen(true)}
            >
              <CommandIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Assets"
              title="Assets"
              disabled={!controller.target}
              data-active={assetsOpen || undefined}
              className="data-active:bg-secondary"
              onClick={() => setAssetsOpen((open) => !open)}
            >
              <ImageIcon />
            </Button>
            {controller.target ? (
              <>
                <CanvasV2History
                  controller={controller}
                  readOnly={readOnly}
                  iconOnly
                />
                <CanvasV2Publish
                  target={controller.target}
                  onFlush={controller.flush}
                  iconOnly
                />
              </>
            ) : null}
            <div className="mx-1 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Layers"
              title="Layers"
              data-active={inspector === 'layers' || undefined}
              className="data-active:bg-secondary"
              onClick={() =>
                setInspector((current) =>
                  current === 'layers' ? null : 'layers',
                )
              }
            >
              <LayersIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Design properties"
              title="Design properties"
              data-active={inspector === 'design' || undefined}
              className="data-active:bg-secondary"
              onClick={() =>
                setInspector((current) =>
                  current === 'design' ? null : 'design',
                )
              }
            >
              <SlidersHorizontalIcon />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More actions"
                  title="More actions"
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={!controller.target}
                  onClick={() => setAgentOpen((open) => !open)}
                >
                  <SparklesIcon data-slot="icon" />
                  Agent panel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setExportOpen(true)}>
                  <DownloadIcon data-slot="icon" />
                  Export and hand off
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!controller.target}
                  onClick={() => setSettingsOpen(true)}
                >
                  <SettingsIcon data-slot="icon" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <CanvasV2ToolStrip
            actions={actions}
            interactionMode={interactionMode}
            onInteractionModeChange={setInteractionMode}
            onAssetsOpen={() => setAssetsOpen(true)}
            comment={
              controller.target && !readOnly ? (
                <CanvasV2Comment
                  onComment={(message) => {
                    setAgentOpen(true)
                    setQueuedPrompt({
                      id: crypto.randomUUID(),
                      message,
                    })
                  }}
                />
              ) : null
            }
          />

          <main className="relative min-w-0 flex-1 overflow-hidden">
            <CanvasSurface
              key={cameraKey}
              controlsRef={controlsRef}
              initialCamera={initialCamera}
              interactionMode={interactionMode}
              className="h-full w-full"
              pageWidth={previewWidth}
              onCameraChange={(camera) => {
                setZoom(camera.zoom)
                if (controller.target) {
                  window.localStorage.setItem(cameraKey, JSON.stringify(camera))
                }
              }}
            />

            <Drawer
              open={assetsOpen}
              onOpenChange={setAssetsOpen}
              position="bottom"
            >
              <DrawerPopup
                position="bottom"
                variant="inset"
                className="h-[min(60svh,32rem)] overflow-hidden rounded-xl border"
              >
                <AssetsPanel
                  onInsert={(asset) => {
                    actions.insertAsset(asset)
                    setAssetsOpen(false)
                  }}
                />
              </DrawerPopup>
            </Drawer>

            {isMobile ? (
              <Drawer
                open={inspector !== null}
                onOpenChange={(open) => !open && setInspector(null)}
                position="bottom"
              >
                <DrawerPopup
                  position="bottom"
                  variant="inset"
                  className="mx-auto h-[min(60svh,34rem)] w-full max-w-sm overflow-hidden rounded-xl border"
                >
                  {inspectorPanel}
                </DrawerPopup>
              </Drawer>
            ) : null}

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

            <CanvasV2Export
              controller={controller}
              open={exportOpen}
              onOpenChange={setExportOpen}
            />

            <EditorCommandMenu
              open={commandMenuOpen}
              onOpenChange={setCommandMenuOpen}
              groups={commandGroups}
            />
          </main>

          {!isMobile && inspectorPanel ? (
            <div
              className="relative flex shrink-0 border-s"
              style={{ width: inspectorWidth }}
            >
              <div
                role="separator"
                aria-label={`Resize ${inspectorTitle} panel`}
                aria-orientation="vertical"
                className="absolute inset-y-0 -start-1 z-20 w-2 cursor-col-resize touch-none hover:bg-border"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setResizingInspector(true)
                }}
                onPointerMove={(event) => {
                  if (!resizingInspector) return
                  setInspectorWidth(
                    clampInspectorWidth(window.innerWidth - event.clientX),
                  )
                }}
                onPointerUp={(event) => {
                  if (!resizingInspector) return
                  event.currentTarget.releasePointerCapture(event.pointerId)
                  setResizingInspector(false)
                  window.localStorage.setItem(
                    'loora:layers-width',
                    String(inspectorWidth),
                  )
                }}
              />
              <div className="flex min-h-0 w-full overflow-hidden">
                {inspectorPanel}
              </div>
            </div>
          ) : null}
        </div>

        <CanvasV2StatusBar
          actions={actions}
          controls={controlsRef}
          zoom={zoom}
          previewWidth={previewWidth}
          onPreviewWidthChange={setPreviewWidth}
        />
      </div>
    </SidebarProvider>
  )
}

function CanvasV2Breakpoint({
  width,
  onChange,
}: {
  width: number
  onChange: (width: number) => void
}) {
  const document = useCanvasDocument()
  return (
    <select
      aria-label="Responsive preview"
      value={width}
      className="h-6 rounded-md border bg-background px-1.5 text-[11px]"
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {[...document.breakpoints]
        .sort((left, right) => left.minWidth - right.minWidth)
        .map((breakpoint) => (
          <option key={breakpoint.id} value={breakpoint.previewWidth}>
            {breakpoint.name} · {breakpoint.previewWidth}px
          </option>
        ))}
    </select>
  )
}


export interface CanvasEditorController {
  engine: CanvasEngine
  target?: CanvasSyncTarget
  status: CanvasSyncStatus
  pendingCount: number
  revision?: number
  subscribe: (listener: () => void) => () => void
  enqueue: (transaction: CanvasTransaction) => void
  flush?: () => Promise<void>
  adoptSnapshot?: (
    document: CanvasDocumentV2,
    revision: number,
  ) => Promise<void>
}

function CanvasSyncIndicator({ controller }: { controller: CanvasEditorController }) {
  useSyncExternalStore(controller.subscribe, () => `${controller.status}:${controller.pendingCount}`)
  const label =
    controller.status === 'syncing'
      ? `Saving ${controller.pendingCount || ''}`.trim()
      : controller.status === 'offline'
        ? `Offline · ${controller.pendingCount} queued`
        : controller.status === 'conflict'
          ? 'Needs conflict review'
          : controller.pendingCount > 0
            ? `${controller.pendingCount} queued`
            : 'Saved'
  return (
    <p
      className={
        controller.status === 'conflict'
          ? 'text-[10px] text-destructive-foreground'
          : 'text-[10px] text-muted-foreground'
      }
    >
      {label}
    </p>
  )
}

function insertionParent(document: ReturnType<typeof useCanvasDocument>, selectedId?: string) {
  let node = selectedId ? document.nodes[selectedId] : null
  while (node) {
    if (['page', 'component', 'frame', 'group'].includes(node.type)) return node
    node = node.parentId ? document.nodes[node.parentId] : null
  }
  return Object.values(document.nodes)
    .filter((candidate) => candidate.type === 'page')
    .sort((left, right) => left.order - right.order)[0] ?? null
}

type CanvasReorderDirection = 'forward' | 'front' | 'backward' | 'back'

interface CanvasEditorActions {
  parent: CanvasNode | null
  selection: NodeRef[]
  history: ReturnType<typeof useCanvasHistory>
  readOnly: boolean
  canDuplicate: boolean
  canGroup: boolean
  canUngroup: boolean
  canReorder: boolean
  addPage: () => void
  addFrame: () => void
  addText: () => void
  addShape: () => void
  addComponent: () => void
  insertAsset: (asset: AssetMeta) => void
  duplicateSelection: () => void
  deleteSelection: () => void
  groupSelection: () => void
  ungroupSelection: () => void
  reorderSelection: (direction: CanvasReorderDirection) => void
  nudgeSelection: (x: number, y: number) => void
}

function hasAncestor(
  document: CanvasDocumentV2,
  nodeId: string,
  candidates: Set<string>,
) {
  let parentId = document.nodes[nodeId]?.parentId ?? null
  while (parentId) {
    if (candidates.has(parentId)) return true
    parentId = document.nodes[parentId]?.parentId ?? null
  }
  return false
}

function frameAsShape(frame: ReturnType<typeof createFrameNode>): ShapeNode {
  const { semanticTag: _semanticTag, ...base } = frame
  return { ...base, type: 'shape', shape: 'rectangle' }
}

function frameAsImage(
  frame: ReturnType<typeof createFrameNode>,
  asset: AssetMeta,
): ImageNode {
  const { semanticTag: _semanticTag, ...base } = frame
  return {
    ...base,
    type: 'image',
    src: `/api/asset/${asset.id}`,
    alt: asset.name,
    fit: 'contain',
  }
}

function frameAsGroup(frame: ReturnType<typeof createFrameNode>): GroupNode {
  const { semanticTag: _semanticTag, ...base } = frame
  return { ...base, type: 'group' }
}

function remapClonedNode(node: CanvasNode, ids: Map<string, string>) {
  const clone = structuredClone(node)
  clone.id = ids.get(node.id) ?? node.id
  clone.parentId = node.parentId
    ? ids.get(node.parentId) ?? node.parentId
    : null
  clone.interactions = clone.interactions.map((interaction) => ({
    ...interaction,
    actions: interaction.actions.map((action) => {
      if (
        action.type === 'navigate' ||
        action.type === 'open-overlay'
      ) {
        return {
          ...action,
          pageId: ids.get(action.pageId) ?? action.pageId,
        }
      }
      if (action.type === 'visibility') {
        return {
          ...action,
          nodeId: ids.get(action.nodeId) ?? action.nodeId,
        }
      }
      if (action.type === 'set-variant') {
        return {
          ...action,
          instanceId: ids.get(action.instanceId) ?? action.instanceId,
        }
      }
      return action
    }),
  }))
  if (clone.type === 'instance') {
    clone.componentId = ids.get(clone.componentId) ?? clone.componentId
    clone.overrides = Object.fromEntries(
      Object.entries(clone.overrides).map(([id, patch]) => [
        ids.get(id) ?? id,
        patch,
      ]),
    )
  }
  if (clone.type === 'component') {
    clone.variantOverrides = Object.fromEntries(
      Object.entries(clone.variantOverrides).map(([variant, overrides]) => [
        variant,
        Object.fromEntries(
          Object.entries(overrides).map(([id, patch]) => [
            ids.get(id) ?? id,
            patch,
          ]),
        ),
      ]),
    )
  }
  return clone
}

function useCanvasEditorActions(): CanvasEditorActions {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const session = useCanvasSession()
  const transact = useCanvasTransaction()
  const history = useCanvasHistory()
  const readOnly = useCanvasReadOnly()
  const selected = selection[0]
  const parent =
    selected?.instancePath.length === 0
      ? insertionParent(document, selected.nodeId)
      : insertionParent(document)

  const insert = (node: CanvasNode) => {
    if (readOnly) return
    transact({
      id: canvasId('tx'),
      label: `Insert ${node.name}`,
      operations: [{ type: 'node.insert', node }],
    })
    session.select([{ nodeId: node.id, instancePath: [] }])
  }

  const addFrame = () => {
    if (!parent || readOnly) return
    const children = orderedChildren(document, parent.id)
    insert(createFrameNode('Frame', {
      parentId: parent.id,
      order: (children.at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(320, 220, {
        position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
        x: 48,
        y: 48,
      }),
      style: defaultStyle({
        fills: [{ type: 'solid', color: '#f3f1f8' }],
        radius: 16,
        overflow: 'hidden',
      }),
    }))
  }

  const addText = () => {
    if (!parent || readOnly) return
    const children = orderedChildren(document, parent.id)
    insert(createTextNode('New text', {
      parentId: parent.id,
      order: (children.at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(240, 42, {
        position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
        x: 48,
        y: 48,
        height: { unit: 'hug' },
      }),
    }))
  }

  const addShape = () => {
    if (!parent || readOnly) return
    const children = orderedChildren(document, parent.id)
    const frame = createFrameNode('Rectangle', {
      parentId: parent.id,
      order: (children.at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(180, 120, {
        position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
        x: 48,
        y: 48,
      }),
      style: defaultStyle({
        fills: [{ type: 'solid', color: '#6c5ce7' }],
        radius: 12,
      }),
    })
    insert(frameAsShape(frame))
  }

  const addPage = () => {
    if (readOnly) return
    const pages = Object.values(document.nodes).filter((node) => node.type === 'page')
    const right = pages.reduce((value, page) => {
      const width = page.layout.width.unit === 'px' ? page.layout.width.value : page.viewport.width
      return Math.max(value, page.layout.x + width)
    }, 0)
    insert(createPageNode(`Page ${pages.length + 1}`, {
      order: (pages.at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(1440, 900, { x: right + 160, y: 80 }),
    }))
  }

  const addComponent = () => {
    if (!parent || readOnly) return
    const componentId = canvasId('component')
    const instanceId = canvasId('instance')
    const component = createComponentNode('Component', {
      id: componentId,
      parentId: null,
      order:
        (orderedChildren(document, null).at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(220, 64),
      style: defaultStyle({
        fills: [{ type: 'solid', color: '#201a33' }],
        radius: 12,
        overflow: 'hidden',
      }),
      variants: ['default'],
      defaultVariant: 'default',
    })
    const label = createTextNode('Component', {
      parentId: componentId,
      order: 1024,
      layout: defaultLayout(120, 24, {
        position: 'flow',
        height: { unit: 'hug' },
      }),
      style: defaultStyle({
        typography: {
          family: 'Archivo',
          size: 15,
          weight: 600,
          lineHeight: 1.4,
          letterSpacing: 0,
          align: 'center',
        },
        fills: [{ type: 'solid', color: '#ffffff' }],
      }),
    })
    const children = orderedChildren(document, parent.id)
    const instance = createInstanceNode(
      componentId,
      'Component instance',
      {
        id: instanceId,
        parentId: parent.id,
        order: (children.at(-1)?.order ?? 0) + 1024,
        layout: defaultLayout(220, 64, {
          position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
          x: 48,
          y: 48,
        }),
        variant: 'default',
      },
    )
    transact({
      id: canvasId('tx'),
      label: 'Create component',
      operations: [
        { type: 'node.insert', node: component },
        { type: 'node.insert', node: label },
        { type: 'node.insert', node: instance },
      ],
    })
    session.select([{ nodeId: instance.id, instancePath: [] }])
  }

  const insertAsset = (asset: AssetMeta) => {
    if (!parent || readOnly) return
    const children = orderedChildren(document, parent.id)
    const frame = createFrameNode(asset.name, {
      parentId: parent.id,
      order: (children.at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(320, 240, {
        position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
        x: 48,
        y: 48,
      }),
      style: defaultStyle({
        fills: [{ type: 'solid', color: '#ffffff' }],
        radius: 12,
        overflow: 'hidden',
      }),
    })
    insert(frameAsImage(frame, asset))
  }

  const sourceRefs = selection.filter(
    (ref) => ref.instancePath.length === 0 && document.nodes[ref.nodeId],
  )
  const sourceIds = new Set(sourceRefs.map((ref) => ref.nodeId))
  const sourceRoots = sourceRefs.filter(
    (ref) => !hasAncestor(document, ref.nodeId, sourceIds),
  )
  const selectedSourceNodes = sourceRefs
    .map((ref) => document.nodes[ref.nodeId])
    .filter((node): node is CanvasNode => !!node)
  const groupParentId = selectedSourceNodes[0]?.parentId
  const groupParent =
    groupParentId !== undefined && groupParentId !== null
      ? document.nodes[groupParentId]
      : null
  const canGroup =
    !readOnly &&
    selectedSourceNodes.length >= 2 &&
    groupParent?.layout.mode === 'absolute' &&
    selectedSourceNodes.every(
      (node) =>
        node.parentId === groupParentId &&
        node.type !== 'page' &&
        node.type !== 'component' &&
        !node.locked,
    )
  const canUngroup =
    !readOnly &&
    selectedSourceNodes.length === 1 &&
    selectedSourceNodes[0]?.type === 'group' &&
    !!selectedSourceNodes[0].parentId
  const canDuplicate =
    !readOnly &&
    sourceRoots.length > 0 &&
    sourceRoots.every((ref) => !document.nodes[ref.nodeId]?.locked)
  const canReorder =
    !readOnly &&
    sourceRefs.length === 1 &&
    !!document.nodes[sourceRefs[0]!.nodeId]?.parentId &&
    !document.nodes[sourceRefs[0]!.nodeId]?.locked

  const duplicateSelection = () => {
    if (!canDuplicate) return
    const ids = new Map<string, string>()
    const ordered: CanvasNode[] = []
    const visit = (id: string) => {
      const node = document.nodes[id]
      if (!node || ids.has(id)) return
      ids.set(id, canvasId(node.type))
      ordered.push(node)
      for (const child of orderedChildren(document, id)) visit(child.id)
    }
    sourceRoots.forEach((ref) => visit(ref.nodeId))

    const nextOrder = new Map<string | null, number>()
    const operations: CanvasOperation[] = ordered.map((node) => {
      const clone = remapClonedNode(node, ids)
      const isRoot = sourceRoots.some((ref) => ref.nodeId === node.id)
      if (isRoot) {
        const parentKey = node.parentId
        const order =
          nextOrder.get(parentKey) ??
          ((orderedChildren(document, parentKey).at(-1)?.order ?? 0) + 1024)
        clone.order = order
        nextOrder.set(parentKey, order + 1024)
        if (clone.layout.position === 'absolute' || clone.type === 'page') {
          clone.layout = {
            ...clone.layout,
            x: clone.layout.x + 24,
            y: clone.layout.y + 24,
          }
        }
        clone.name = `${clone.name} copy`
      }
      return { type: 'node.insert', node: clone }
    })
    transact({
      id: canvasId('tx'),
      label: sourceRoots.length === 1 ? 'Duplicate node' : 'Duplicate nodes',
      operations,
    })
    session.select(
      sourceRoots.map((ref) => ({
        nodeId: ids.get(ref.nodeId)!,
        instancePath: [],
      })),
    )
  }

  const deleteSelection = () => {
    if (readOnly || selection.length === 0) return
    const operations: CanvasOperation[] = []
    const selectedSourceIds = new Set(
      selection
        .filter((ref) => ref.instancePath.length === 0)
        .map((ref) => ref.nodeId),
    )
    for (const ref of selection) {
      const resolved = resolveNodeRef(document, ref)
      if (!resolved || resolved.locked) continue
      if (ref.instancePath.length > 0) {
        operations.push({
          type: 'instance.patchOverride',
          id: ref.instancePath.at(-1)!,
          targetId: ref.nodeId,
          patch: { hidden: true },
        })
      } else if (!hasAncestor(document, ref.nodeId, selectedSourceIds)) {
        operations.push({ type: 'node.delete', id: ref.nodeId })
      }
    }
    if (operations.length === 0) return
    transact({
      id: canvasId('tx'),
      label: operations.length === 1 ? 'Delete node' : 'Delete nodes',
      operations,
    })
    session.select([])
  }

  const groupSelection = () => {
    if (!canGroup || !groupParent || groupParentId == null) return
    const left = Math.min(...selectedSourceNodes.map((node) => node.layout.x))
    const top = Math.min(...selectedSourceNodes.map((node) => node.layout.y))
    const right = Math.max(
      ...selectedSourceNodes.map(
        (node) =>
          node.layout.x +
          (node.layout.width.unit === 'px' ? node.layout.width.value : 100),
      ),
    )
    const bottom = Math.max(
      ...selectedSourceNodes.map(
        (node) =>
          node.layout.y +
          (node.layout.height.unit === 'px' ? node.layout.height.value : 100),
      ),
    )
    const frame = createFrameNode('Group', {
      parentId: groupParentId,
      order: Math.min(...selectedSourceNodes.map((node) => node.order)),
      layout: defaultLayout(
        Math.max(1, right - left),
        Math.max(1, bottom - top),
        {
          position: 'absolute',
          x: left,
          y: top,
          mode: 'absolute',
        },
      ),
      style: defaultStyle({ overflow: 'visible' }),
    })
    const group = frameAsGroup(frame)
    const operations: CanvasOperation[] = [
      { type: 'node.insert', node: group },
    ]
    for (const node of selectedSourceNodes) {
      operations.push({
        type: 'node.move',
        id: node.id,
        parentId: group.id,
        order: node.order,
      })
      operations.push({
        type: 'node.patch',
        id: node.id,
        patch: {
          layout: {
            x: node.layout.x - left,
            y: node.layout.y - top,
          },
        },
      })
    }
    transact({
      id: canvasId('tx'),
      label: 'Group selection',
      operations,
    })
    session.select([{ nodeId: group.id, instancePath: [] }])
  }

  const ungroupSelection = () => {
    if (!canUngroup) return
    const group = selectedSourceNodes[0]
    if (!group || group.type !== 'group' || !group.parentId) return
    const children = orderedChildren(document, group.id)
    const siblings = orderedChildren(document, group.parentId)
    const groupIndex = siblings.findIndex((node) => node.id === group.id)
    const nextOrder = siblings[groupIndex + 1]?.order ?? group.order + 1024
    const gap = (nextOrder - group.order) / (children.length + 1)
    const operations: CanvasOperation[] = []
    children.forEach((child, index) => {
      operations.push({
        type: 'node.move',
        id: child.id,
        parentId: group.parentId,
        order: group.order + gap * (index + 1),
      })
      if (child.layout.position === 'absolute') {
        operations.push({
          type: 'node.patch',
          id: child.id,
          patch: {
            layout: {
              x: group.layout.x + child.layout.x,
              y: group.layout.y + child.layout.y,
            },
          },
        })
      }
    })
    operations.push({ type: 'node.delete', id: group.id })
    transact({
      id: canvasId('tx'),
      label: 'Ungroup selection',
      operations,
    })
    session.select(
      children.map((child) => ({ nodeId: child.id, instancePath: [] })),
    )
  }

  const reorderSelection = (direction: CanvasReorderDirection) => {
    if (!canReorder) return
    const node = document.nodes[sourceRefs[0]!.nodeId]!
    const siblings = orderedChildren(document, node.parentId)
    const index = siblings.findIndex((candidate) => candidate.id === node.id)
    const operations: CanvasOperation[] = []
    if (direction === 'forward' && index < siblings.length - 1) {
      const target = siblings[index + 1]!
      operations.push(
        { type: 'node.patch', id: node.id, patch: { order: target.order } },
        { type: 'node.patch', id: target.id, patch: { order: node.order } },
      )
    } else if (direction === 'backward' && index > 0) {
      const target = siblings[index - 1]!
      operations.push(
        { type: 'node.patch', id: node.id, patch: { order: target.order } },
        { type: 'node.patch', id: target.id, patch: { order: node.order } },
      )
    } else if (direction === 'front' && index < siblings.length - 1) {
      operations.push({
        type: 'node.patch',
        id: node.id,
        patch: { order: (siblings.at(-1)?.order ?? node.order) + 1024 },
      })
    } else if (direction === 'back' && index > 0) {
      operations.push({
        type: 'node.patch',
        id: node.id,
        patch: { order: (siblings[0]?.order ?? node.order) - 1024 },
      })
    }
    if (operations.length === 0) return
    transact({
      id: canvasId('tx'),
      label: 'Reorder selection',
      operations,
    })
  }

  const nudgeSelection = (x: number, y: number) => {
    if (readOnly || selection.length === 0) return
    const operations: CanvasOperation[] = []
    for (const ref of selection) {
      const node = resolveNodeRef(document, ref)
      if (!node || node.locked || node.layout.position !== 'absolute') continue
      const patch = {
        layout: {
          x: node.layout.x + x,
          y: node.layout.y + y,
        },
      }
      if (ref.instancePath.length > 0) {
        operations.push({
          type: 'instance.patchOverride',
          id: ref.instancePath.at(-1)!,
          targetId: ref.nodeId,
          patch,
        })
      } else {
        operations.push({
          type: 'node.patch',
          id: ref.nodeId,
          patch,
        })
      }
    }
    if (operations.length === 0) return
    transact({
      id: canvasId('tx'),
      label: 'Nudge selection',
      coalesceKey: 'keyboard-nudge',
      operations,
    })
  }

  return {
    parent,
    selection,
    history,
    readOnly,
    canDuplicate,
    canGroup,
    canUngroup,
    canReorder,
    addPage,
    addFrame,
    addText,
    addShape,
    addComponent,
    insertAsset,
    duplicateSelection,
    deleteSelection,
    groupSelection,
    ungroupSelection,
    reorderSelection,
    nudgeSelection,
  }
}

function CanvasV2ToolButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ElementType
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-active={active || undefined}
      className="data-active:bg-secondary data-active:text-foreground"
      onClick={onClick}
    >
      <Icon />
    </Button>
  )
}

/** Flush vertical strip against the canvas, not a floating cluster. */
function CanvasV2ToolStrip({
  actions,
  interactionMode,
  onInteractionModeChange,
  onAssetsOpen,
  comment,
}: {
  actions: CanvasEditorActions
  interactionMode: 'select' | 'pan'
  onInteractionModeChange: (mode: 'select' | 'pan') => void
  onAssetsOpen: () => void
  comment: ReactNode
}) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 border-e py-1.5">
      <CanvasV2ToolButton
        icon={MousePointer2Icon}
        label="Select"
        active={interactionMode === 'select'}
        onClick={() => onInteractionModeChange('select')}
      />
      <CanvasV2ToolButton
        icon={HandIcon}
        label="Hand"
        active={interactionMode === 'pan'}
        onClick={() => onInteractionModeChange('pan')}
      />
      <div className="my-1 h-px w-4 bg-border" />
      <CanvasV2ToolButton
        icon={FrameIcon}
        label="Frame"
        disabled={actions.readOnly || !actions.parent}
        onClick={() => {
          actions.addFrame()
          onInteractionModeChange('select')
        }}
      />
      <CanvasV2ToolButton
        icon={TypeIcon}
        label="Text"
        disabled={actions.readOnly || !actions.parent}
        onClick={() => {
          actions.addText()
          onInteractionModeChange('select')
        }}
      />
      <CanvasV2ToolButton
        icon={RectangleHorizontalIcon}
        label="Rectangle"
        disabled={actions.readOnly || !actions.parent}
        onClick={() => {
          actions.addShape()
          onInteractionModeChange('select')
        }}
      />
      <CanvasV2ToolButton
        icon={ImageIcon}
        label="Image"
        disabled={actions.readOnly}
        onClick={onAssetsOpen}
      />
      <CanvasV2ToolButton
        icon={ComponentIcon}
        label="Component"
        disabled={actions.readOnly || !actions.parent}
        onClick={() => {
          actions.addComponent()
          onInteractionModeChange('select')
        }}
      />
      {comment}
      <div className="mt-auto flex flex-col items-center gap-0.5">
        <div className="my-1 h-px w-4 bg-border" />
        <CanvasV2ToolButton
          icon={Undo2Icon}
          label="Undo"
          disabled={actions.readOnly || !actions.history.canUndo}
          onClick={() => actions.history.undo()}
        />
        <CanvasV2ToolButton
          icon={Redo2Icon}
          label="Redo"
          disabled={actions.readOnly || !actions.history.canRedo}
          onClick={() => actions.history.redo()}
        />
      </div>
    </div>
  )
}

/**
 * One slim strip along the bottom: view controls on the left, selection
 * actions on the right. Replaces two floating clusters that used to sit on
 * top of the artboard.
 */
function CanvasV2StatusBar({
  actions,
  controls,
  zoom,
  previewWidth,
  onPreviewWidthChange,
}: {
  actions: CanvasEditorActions
  controls: RefObject<CanvasSurfaceControls | null>
  zoom: number
  previewWidth: number
  onPreviewWidthChange: (width: number) => void
}) {
  const count = actions.selection.length
  return (
    <footer className="flex h-8 shrink-0 items-center gap-0.5 border-t px-1.5 text-[11px] text-muted-foreground">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => controls.current?.zoomOut()}
      >
        <ZoomOutIcon />
      </Button>
      <Button
        size="xs"
        variant="ghost"
        className="min-w-11 tabular-nums"
        title="Reset zoom"
        onClick={() => controls.current?.zoomReset()}
      >
        {Math.round(zoom * 100)}%
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => controls.current?.zoomIn()}
      >
        <ZoomInIcon />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={count > 0 ? 'Zoom to selection' : 'Zoom to fit'}
        title={count > 0 ? 'Zoom to selection' : 'Zoom to fit'}
        onClick={() =>
          count > 0
            ? controls.current?.zoomToSelection()
            : controls.current?.zoomToFit()
        }
      >
        <MaximizeIcon />
      </Button>
      <div className="mx-1 hidden h-4 w-px bg-border md:block" />
      <div className="hidden md:block">
        <CanvasV2Breakpoint
          width={previewWidth}
          onChange={onPreviewWidthChange}
        />
      </div>

      {count > 0 ? (
        <div className="ms-auto flex items-center gap-0.5">
          <span className="pe-1 tabular-nums">
            {count === 1 ? '1 selected' : `${count} selected`}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Arrange"
                title="Arrange"
                disabled={!actions.canReorder}
              >
                <BringToFrontIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => actions.reorderSelection('front')}>
                <BringToFrontIcon data-slot="icon" />
                Bring to front
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.reorderSelection('forward')}>
                <BringToFrontIcon data-slot="icon" />
                Bring forward
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.reorderSelection('backward')}>
                <SendToBackIcon data-slot="icon" />
                Send backward
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.reorderSelection('back')}>
                <SendToBackIcon data-slot="icon" />
                Send to back
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {actions.canUngroup ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Ungroup"
              title="Ungroup"
              onClick={actions.ungroupSelection}
            >
              <UngroupIcon />
            </Button>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Group"
              title="Group"
              disabled={!actions.canGroup}
              onClick={actions.groupSelection}
            >
              <GroupIcon />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Duplicate"
            title="Duplicate"
            disabled={!actions.canDuplicate}
            onClick={actions.duplicateSelection}
          >
            <CopyIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete"
            title="Delete"
            disabled={actions.readOnly}
            onClick={actions.deleteSelection}
          >
            <Trash2Icon />
          </Button>
        </div>
      ) : null}
    </footer>
  )
}
function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadDataUrl(filename: string, url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

function safeExportName(name: string, extension: string) {
  const base =
    name
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'loora-design'
  return `${base}.${extension}`
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function CanvasV2Export({
  controller,
  open,
  onOpenChange,
}: {
  controller: CanvasEditorController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const document = useCanvasDocument()
  const registry = useCanvasDomRegistry()
  const selection = useCanvasSelection()
  const [format, setFormat] = useState<'react' | 'html' | 'json'>('react')
  const [codeOpen, setCodeOpen] = useState(false)
  const [pngBusy, setPngBusy] = useState(false)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoff, setHandoff] = useState<{
    url: string
    expiresAt: number
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedRef =
    selection.length === 1 && document.nodes[selection[0]!.nodeId]
      ? selection[0]
      : null
  const selectedNode = selectedRef
    ? resolveNodeRef(document, selectedRef)
    : null
  const exportOptions =
    selectedRef?.instancePath.length === 0
      ? selectedNode?.type === 'page'
        ? { pageId: selectedNode.id }
        : { nodeId: selectedRef.nodeId }
      : {}
  const exportName = selectedNode?.name ?? document.name
  const output = useMemo(() => {
    if (!open || !codeOpen) return ''
    if (format === 'html') {
      return compileStandaloneHtml(document, exportOptions)
    }
    if (format === 'json') return serializeCanvasDocument(document)
    return compileReactComponent(document, exportOptions)
  }, [
    document,
    exportOptions.nodeId,
    exportOptions.pageId,
    format,
    codeOpen,
    open,
  ])
  const handoffPrompt = handoff
    ? `Fetch the Loora Canvas V2 handoff from ${handoff.url}. Read the version 3 JSON document and assets. Recreate the selected UI faithfully using its normalized nodes, parentId/order hierarchy, structured layout and styles, responsive overrides, components, instances, tokens, and declarative interactions. CanvasDocumentV2 is the source of truth; do not look for editable source strings.`
    : ''

  const exportPng = async () => {
    setPngBusy(true)
    setError(null)
    try {
      const image = selectedRef
        ? await captureNodePng(registry, selectedRef)
        : await captureCanvasPng(document, registry)
      downloadDataUrl(safeExportName(exportName, 'png'), image)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not prepare the PNG export.',
      )
    } finally {
      setPngBusy(false)
    }
  }

  const createHandoff = async () => {
    if (!controller.target) return
    setHandoffBusy(true)
    setError(null)
    setCopied(false)
    try {
      await controller.flush?.()
      const created = await orpc.handoff.create({
        designId: controller.target.designId,
        draftId: controller.target.draftId,
      })
      setHandoff({
        url: `${window.location.origin}/api/handoff/${created.token}`,
        expiresAt: created.expiresAt,
      })
    } catch {
      setError('Could not create the handoff link. Try again.')
    } finally {
      setHandoffBusy(false)
    }
  }

  const copyHandoff = async () => {
    try {
      await copyText(handoffPrompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Clipboard access was blocked. Copy the prompt manually.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className={cn(
          codeOpen
            ? 'h-[min(84svh,50rem)] max-w-4xl'
            : 'max-w-lg',
        )}
        bottomStickOnMobile={false}
      >
        <DialogHeader>
          <DialogTitle>Export design</DialogTitle>
          <DialogDescription>
            {selectedNode
              ? `Export “${selectedNode.name}” from the structured canvas.`
              : 'Export the complete structured canvas.'}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="min-h-0 space-y-5 overflow-y-auto">
          <div className="overflow-hidden rounded-xl border">
            <button
              type="button"
              disabled={pngBusy}
              onClick={() => void exportPng()}
              className="flex w-full items-center gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="w-11 shrink-0 font-mono text-[11px] font-medium text-muted-foreground">
                .PNG
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Image</span>
                <span className="block text-xs text-muted-foreground">
                  High-resolution DOM snapshot
                </span>
              </span>
              {pngBusy ? (
                <Spinner className="size-4" />
              ) : (
                <DownloadIcon className="size-4 text-muted-foreground" />
              )}
            </button>
            {[
              {
                format: 'html' as const,
                extension: '.HTML',
                name: 'Web page',
                description: 'Standalone responsive HTML, CSS, and runtime',
              },
              {
                format: 'react' as const,
                extension: '.TSX',
                name: 'React component',
                description: 'Generated React component and scoped CSS',
              },
              {
                format: 'json' as const,
                extension: '.JSON',
                name: 'Canvas V2 document',
                description: 'Versioned structured source of truth',
              },
            ].map((item) => (
              <button
                key={item.format}
                type="button"
                onClick={() => {
                  const next =
                    item.format === 'html'
                      ? compileStandaloneHtml(document, exportOptions)
                      : item.format === 'json'
                        ? serializeCanvasDocument(document)
                        : compileReactComponent(document, exportOptions)
                  download(
                    safeExportName(
                      exportName,
                      item.format === 'react' ? 'tsx' : item.format,
                    ),
                    next,
                    item.format === 'json'
                      ? 'application/json'
                      : 'text/plain',
                  )
                }}
                className="flex w-full items-center gap-3 border-t px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted"
              >
                <span className="w-11 shrink-0 font-mono text-[11px] font-medium text-muted-foreground">
                  {item.extension}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <DownloadIcon className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>

          <section>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Generated code</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Read-only. Canvas V2 remains the source of truth.
                </p>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => setCodeOpen((current) => !current)}
              >
                <CodeXmlIcon />
                {codeOpen ? 'Hide preview' : 'Preview'}
              </Button>
            </div>
            {codeOpen ? (
              <div className="mt-3 flex min-h-0 flex-col gap-2">
                <div className="flex gap-1">
                  {(['react', 'html', 'json'] as const).map((item) => (
                    <Button
                      key={item}
                      size="xs"
                      variant={format === item ? 'secondary' : 'ghost'}
                      onClick={() => setFormat(item)}
                    >
                      {item === 'react' ? 'TSX' : item.toUpperCase()}
                    </Button>
                  ))}
                </div>
                <pre className="max-h-[22rem] min-h-48 overflow-auto rounded-lg border bg-[#17151f] p-4 text-xs leading-5 text-[#ebe7f5]">
                  <code>{output}</code>
                </pre>
              </div>
            ) : null}
          </section>

          {controller.target ? (
            <section className="border-t pt-5">
              <h3 className="text-sm font-semibold">Hand off to an agent</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Create a private prompt backed by the same Canvas V2 document.
              </p>
              {handoff ? (
                <div className="mt-3 space-y-3">
                  <textarea
                    readOnly
                    value={handoffPrompt}
                    aria-label="Agent handoff prompt"
                    className="min-h-28 w-full resize-none rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed outline-none"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void copyHandoff()}>
                      {copied ? <CheckIcon /> : <ClipboardIcon />}
                      {copied ? 'Copied' : 'Copy prompt'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={handoffBusy}
                      onClick={() => void createHandoff()}
                    >
                      {handoffBusy ? <Spinner /> : null}
                      New link
                    </Button>
                    <span className="ms-auto text-[11px] text-muted-foreground">
                      Expires {new Date(handoff.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ) : (
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={handoffBusy}
                  onClick={() => void createHandoff()}
                >
                  {handoffBusy ? <Spinner /> : <Link2Icon />}
                  {handoffBusy ? 'Creating link…' : 'Create handoff link'}
                </Button>
              )}
            </section>
          ) : null}

          {error ? (
            <p className="text-xs text-destructive-foreground">{error}</p>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}
