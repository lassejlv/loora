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
import { Link } from '@tanstack/react-router'
import {
  BracesIcon,
  CodeXmlIcon,
  ComponentIcon,
  FileCode2Icon,
  GroupIcon,
  ImageIcon,
  MousePointer2Icon,
  PanelsTopLeftIcon,
  Redo2Icon,
  RectangleHorizontalIcon,
  ShapesIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@loora/ui/icons'
import {
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  EyeIcon,
  FrameIcon,
  HandIcon,
  LayersIcon,
  MaximizeIcon,
  PlusIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from '@loora/ui/icons'
import {
  CanvasProvider,
  CanvasSurface,
  type CanvasCamera,
  type CanvasDropPlacement,
  type CanvasSurfaceControls,
  useCanvasDocument,
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
  createVectorNode,
  defaultLayout,
  defaultStyle,
  orderedChildren,
  resolveNodeRef,
  type CanvasNode,
  type CanvasDocument,
  type GroupNode,
  type ImageNode,
  type NodeRef,
  type ShapeNode,
  type VectorNode,
} from '@loora/canvas/model'
import type {
  CanvasAgentActivity,
  CanvasPeer,
  CanvasRemoteChange,
  CanvasSyncStatus,
  CanvasSyncTarget,
} from '../lib/canvas-client'
import type {
  CanvasEngine,
  CanvasOperation,
  CanvasTransaction,
} from '@loora/canvas/engine'
import { CanvasLayersPanel } from './layers-panel'
import { CanvasPropertiesPanel } from './properties-panel'
import { CanvasContextMenu } from './canvas-menu'
import {
  CanvasCollaboratorPresence,
  type PresenceCamera,
} from './presence'
import { CanvasAgentAvatar, CanvasAgentOverlay } from './agent-presence'
import { CanvasExport } from './export-panel'
import { CanvasHistory } from './history'
import { HtmlImportDialog } from './html-import-dialog'
import { IconPickerDialog } from './icon-picker-dialog'
import type { IconEntry } from '../lib/icon-libraries'
import { svgStringToVectorDescriptor, looksLikeSvg } from '../lib/svg-to-vector'
import {
  ASSET_DRAG_TYPE,
  AssetsPanel,
  MAX_ASSET_BYTES,
  assetSrc,
  fileToBase64,
  type AssetMeta,
} from './assets-panel'
import {
  EditorCommandMenu,
  type EditorCommandGroup,
} from './editor-command-menu'
import { Button } from '@loora/ui/button'
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from '@loora/ui/tooltip'
import { orpc } from '@loora/rpc/client'
import { compileCanvasCode, type CanvasCodeFormat } from '../lib/canvas-code-copy'
import { copyText } from '../lib/copy-text'
import {
  buildClipboardPayload,
  parseClipboardPayload,
  pasteNodes,
  validatePaste,
} from '../lib/canvas-clipboard'
import { importHtmlCssToCanvas } from '../lib/canvas-html-import'
import {
  containingPageForRef,
  fetchImageFile,
  importedImageNodes,
  placeHtmlImport,
} from '../lib/canvas-html-paste'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@loora/ui/dropdown-menu'
import { Drawer, DrawerPopup } from '@loora/ui/drawer'
import { useIsMobile } from '@loora/ui/hooks/use-media-query'
import {
  cacheShortcuts,
  formatBuiltInChord,
  isEditableTarget,
  loadCachedShortcuts,
  matchShortcut,
  normalizeConfig,
  type BuiltInShortcutId,
  type ShortcutConfig,
} from '../lib/shortcuts'
import { Dialog, DialogPopup } from '@loora/ui/dialog'

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

function CanvasDockedPanel({
  side,
  title,
  storageKey,
  children,
}: {
  side: 'left' | 'right'
  title: string
  storageKey: string
  children: ReactNode
}) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return 280
    const value = Number(window.localStorage.getItem(storageKey))
    return Number.isFinite(value) && value > 0
      ? clampInspectorWidth(value)
      : 280
  })
  const [resizing, setResizing] = useState(false)
  const widthFromPointer = (clientX: number) =>
    clampInspectorWidth(
      side === 'left' ? clientX : window.innerWidth - clientX,
    )

  return (
    <div
      className={`pointer-events-auto relative flex h-full shrink-0 bg-surface ${
        side === 'left' ? 'border-e border-line' : 'border-s border-line'
      }`}
      style={{ width }}
    >
      <div
        role="separator"
        aria-label={`Resize ${title} panel`}
        aria-orientation="vertical"
        data-resizing={resizing || undefined}
        className={`absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-line data-resizing:after:bg-foreground/25 ${
          side === 'left' ? '-end-1' : '-start-1'
        }`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setResizing(true)
        }}
        onPointerMove={(event) => {
          if (!resizing) return
          setWidth(widthFromPointer(event.clientX))
        }}
        onPointerUp={(event) => {
          if (!resizing) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          setResizing(false)
          const next = widthFromPointer(event.clientX)
          setWidth(next)
          window.localStorage.setItem(storageKey, String(next))
        }}
        onPointerCancel={() => setResizing(false)}
      />
      <div className="flex min-h-0 w-full overflow-hidden">{children}</div>
    </div>
  )
}

export interface CanvasTopBarActions {
  openAssets: () => void
  openHistory: () => void
}

/**
 * The settings dialog is the product's account/preferences surface, not the
 * editor's — it knows about sessions, billing and themes. The editor owns the
 * shortcut config it edits, so the host passes a renderer in rather than the
 * package reaching back into the app for the panel.
 */
export type CanvasSettingsSlot = (props: {
  onClose: () => void
  shortcutConfig: ShortcutConfig
  onShortcutConfigChange: (next: ShortcutConfig) => void
}) => ReactNode

export function CanvasEditor({
  controller,
  name,
  topBar,
  topBarEnd,
  readOnly = false,
  renderSettings,
}: {
  controller: CanvasEditorController
  name: string
  topBar?: ReactNode | ((actions: CanvasTopBarActions) => ReactNode)
  /** Trailing header slot, pushed to the far end away from the breadcrumb. */
  topBarEnd?: ReactNode
  readOnly?: boolean
  renderSettings?: CanvasSettingsSlot
}) {
  return (
    <CanvasProvider
      engine={controller.engine}
      readOnly={readOnly}
      onTransaction={(transaction) => controller.enqueue(transaction)}
    >
      <CanvasShell
        controller={controller}
        name={name}
        topBar={topBar}
        topBarEnd={topBarEnd}
        readOnly={readOnly}
        renderSettings={renderSettings}
      />
    </CanvasProvider>
  )
}

function cameraStorageKey(target: CanvasSyncTarget | undefined) {
  return target
    ? `loora:canvas:camera:${target.designId}:${target.draftId ?? 'main'}`
    : 'loora:canvas:camera:preview'
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

function CanvasShell({
  controller,
  name,
  topBar,
  topBarEnd,
  readOnly,
  renderSettings,
}: {
  controller: CanvasEditorController
  name: string
  topBar?: ReactNode | ((actions: CanvasTopBarActions) => ReactNode)
  topBarEnd?: ReactNode
  readOnly: boolean
  renderSettings?: CanvasSettingsSlot
}) {
  const isMobile = useIsMobile()
  const canvasSession = useCanvasSession()
  const controlsRef = useRef<CanvasSurfaceControls>(null)
  const [mobileInspector, setMobileInspector] = useState<
    'layers' | 'design' | null
  >(null)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [htmlImportOpen, setHtmlImportOpen] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  const pasteNoticeTimer = useRef<number | null>(null)
  const [interactionMode, setInteractionMode] = useState<'select' | 'pan'>(
    'select',
  )

  const showPasteNotice = (message: string) => {
    setPasteNotice(message)
    if (pasteNoticeTimer.current !== null) {
      window.clearTimeout(pasteNoticeTimer.current)
    }
    pasteNoticeTimer.current = window.setTimeout(() => {
      setPasteNotice(null)
      pasteNoticeTimer.current = null
    }, 5_000)
  }

  useEffect(
    () => () => {
      if (pasteNoticeTimer.current !== null) {
        window.clearTimeout(pasteNoticeTimer.current)
      }
    },
    [],
  )
  // The widest breakpoint is the canvas page width. There is no preview
  // switcher in the chrome, so this is read once per document.
  const previewWidth = useMemo(
    () =>
      requestedPreviewWidth(
        controller.engine.document.breakpoints.at(-1)?.previewWidth ?? 1440,
      ),
    [controller.engine],
  )
  const [zoom, setZoom] = useState(0.75)
  const surfaceRef = useRef<HTMLElement | null>(null)
  const [camera, setCamera] = useState<PresenceCamera>({ x: 0, y: 0, zoom: 0.75 })
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>(() =>
    controller.target
      ? loadCachedShortcuts()
      : { overrides: {}, custom: [] },
  )
  const cameraKey = cameraStorageKey(controller.target)
  const initialCamera = useMemo(() => loadCamera(cameraKey), [cameraKey])
  const actions = useCanvasEditorActions(showPasteNotice)
  const addPageAndFocus = () => {
    actions.addPage()
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() =>
        controlsRef.current?.zoomToSelection(),
      )
    })
  }
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
    if (!controller.target) return
    let cancelled = false
    void orpc.preferences
      .get()
      .then((preferences) => {
        if (cancelled) return
        const next = normalizeConfig(preferences.shortcuts)
        setShortcutConfig(next)
        cacheShortcuts(next)
      })
      .catch((cause) => {
        console.error('[preferences] Failed to load preferences:', cause)
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

  const shortcutLabel = (id: BuiltInShortcutId) =>
    formatBuiltInChord(id, shortcutConfig)

  /**
   * Image files dropped straight from the desktop are uploaded, then placed
   * where they landed. Anything the assets panel would refuse is refused here.
   */
  const uploadDroppedImages = async (
    files: File[],
    placement: CanvasDropPlacement,
  ) => {
    const images = files.filter(
      (file) => file.type.startsWith('image/') && file.size <= MAX_ASSET_BYTES,
    )
    if (images.length === 0 || readOnly) return
    for (const [index, file] of images.entries()) {
      try {
        const saved = await orpc.asset.upload({
          name: file.name,
          mediaType: file.type,
          data: await fileToBase64(file),
        })
        actions.insertAsset(saved, {
          ...placement,
          // Several files at once cascade instead of stacking on one point.
          order: placement.order + index,
          x: placement.x + index * 24,
          y: placement.y + index * 24,
        })
      } catch (cause) {
        console.error('[assets] Drop upload failed:', cause)
      }
    }
  }


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      // Enter types into the selected text node, the way every canvas tool does.
      if (
        event.key === 'Enter' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const ref = actions.selection[0]
        if (ref && controller.engine.getNode(ref.nodeId)?.type === 'text') {
          event.preventDefault()
          actions.editText(ref)
          return
        }
      }
      const hit = matchShortcut(event, shortcutConfig)
      if (!hit) return
      const run = () => {
        if (hit === 'toggleAssets') {
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
        else if (hit === 'copy' || hit === 'cut' || hit === 'paste') {
          // The standard chords raise a native clipboard event that carries the
          // data with it, so they are left alone. A rebound chord does not, and
          // falls back to the async clipboard API.
          const native =
            (event.metaKey || event.ctrlKey) &&
            ['c', 'x', 'v'].includes(event.key.toLowerCase())
          if (native) return false
          if (hit === 'copy') actions.copySelection()
          else if (hit === 'cut') actions.cutSelection()
          else actions.pasteClipboard()
        }
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

  // Native clipboard events carry the data with them, so copy and paste work
  // without asking for clipboard permission. The shortcut handler above skips
  // copy/cut/paste while these are installed.
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return
      const text = actions.clipboardText()
      if (!text || !event.clipboardData) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
    }
    const onCut = (event: ClipboardEvent) => {
      if (readOnly || isEditableTarget(event.target)) return
      const text = actions.clipboardText()
      if (!text || !event.clipboardData) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
      actions.deleteSelection()
    }
    const onPaste = (event: ClipboardEvent) => {
      if (readOnly || isEditableTarget(event.target)) return
      const html = event.clipboardData?.getData('text/html')
      const text = event.clipboardData?.getData('text/plain')
      if (html) {
        event.preventDefault()
        void actions.pasteFromHtml(html, text || '')
        return
      }
      if (!text) return
      event.preventDefault()
      actions.pasteFromText(text)
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('paste', onPaste)
    }
  }, [actions, readOnly])

  const commandGroups: EditorCommandGroup[] = [
    {
      label: 'Insert',
      commands: [
        {
          id: 'insert-page',
          label: 'New Page',
          icon: PanelsTopLeftIcon,
          disabled: readOnly,
          run: addPageAndFocus,
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
        {
          id: 'insert-icon',
          label: 'Insert icon',
          keywords: 'svg vector lucide hugeicons symbol',
          icon: ShapesIcon,
          disabled: readOnly || !actions.parent,
          run: () => setIconPickerOpen(true),
        },
        {
          id: 'import-html',
          label: 'Import HTML & CSS',
          keywords: 'convert web page code',
          icon: FileCode2Icon,
          disabled: readOnly,
          run: () => setHtmlImportOpen(true),
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
        {
          id: 'copy-html',
          label: 'Copy as HTML',
          icon: FileCode2Icon,
          disabled: !actions.canCopyCode,
          run: () => void actions.copyCode('html', previewWidth),
        },
        {
          id: 'copy-jsx',
          label: 'Copy as JSX',
          icon: BracesIcon,
          disabled: !actions.canCopyCode,
          run: () => void actions.copyCode('jsx', previewWidth),
        },
        {
          id: 'copy-tailwind',
          label: 'Copy as Tailwind',
          icon: CodeXmlIcon,
          disabled: !actions.canCopyCode,
          run: () => void actions.copyCode('tailwind', previewWidth),
        },
      ],
    },
    {
      label: 'View',
      commands: [
        ...(isMobile
          ? [
              {
                id: 'view-layers',
                label: 'Layers',
                icon: LayersIcon,
                run: () => setMobileInspector('layers'),
              },
              {
                id: 'view-properties',
                label: 'Properties',
                icon: SlidersHorizontalIcon,
                run: () => setMobileInspector('design'),
              },
            ]
          : []),
        {
          id: 'zoom-fit',
          label: 'Zoom to fit',
          icon: MaximizeIcon,
          shortcut: shortcutLabel('zoomToFit'),
          run: () => controlsRef.current?.zoomToFit(),
        },
        {
          id: 'export',
          label: 'Export',
          icon: DownloadIcon,
          run: () => setExportOpen(true),
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

  const layersPanel = (
    <CanvasLayersPanel
      onReorder={actions.reorderSelection}
      canReorder={actions.canReorder}
      onAddPage={addPageAndFocus}
      position="left"
      onClose={isMobile ? () => setMobileInspector(null) : undefined}
    />
  )
  const propertiesPanel = (
    <CanvasPropertiesPanel
      onClose={isMobile ? () => setMobileInspector(null) : undefined}
    />
  )

  return (
    <div className="relative h-full min-h-0 w-full bg-cx-canvas">
      <main
        ref={surfaceRef}
        className="absolute inset-0 overflow-hidden"
      >
        <CanvasContextMenu
          actions={actions}
          shortcutLabel={shortcutLabel}
          onZoomToSelection={() => controlsRef.current?.zoomToSelection()}
          onInsertIcon={() => setIconPickerOpen(true)}
        >
          <CanvasSurface
            key={cameraKey}
            controlsRef={controlsRef}
            initialCamera={initialCamera}
            interactionMode={interactionMode}
            className="h-full w-full"
            pageWidth={previewWidth}
            acceptsDrop={(event) =>
              event.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
              event.dataTransfer.types.includes('Files')
            }
            onDrop={(event, placement) => {
              const payload = event.dataTransfer.getData(ASSET_DRAG_TYPE)
              if (payload) {
                try {
                  actions.insertAsset(JSON.parse(payload) as AssetMeta, placement)
                } catch {
                  // A payload we cannot read is not ours to place.
                }
                return
              }
              void uploadDroppedImages([...event.dataTransfer.files], placement)
            }}
            onCameraChange={(next) => {
              setZoom(next.zoom)
              setCamera(next)
              if (controller.target) {
                window.localStorage.setItem(cameraKey, JSON.stringify(next))
              }
            }}
          />
        </CanvasContextMenu>

        <CanvasAgentOverlay controller={controller} />

        <CanvasCollaboratorPresence
          controller={controller}
          camera={camera}
          surfaceRef={surfaceRef}
        />

        {controller.target ? (
          <CanvasHistory
            controller={controller}
            readOnly={readOnly}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            showTrigger={false}
          />
        ) : null}

        <Drawer
          open={assetsOpen}
          onOpenChange={setAssetsOpen}
          position="bottom"
        >
          <DrawerPopup
            position="bottom"
            variant="inset"
            className="h-[min(60svh,32rem)] overflow-hidden rounded-lg bg-surface shadow-panel-lg"
          >
            <CanvasAssets
              onInsert={(asset) => {
                actions.insertAsset(asset)
                setAssetsOpen(false)
              }}
            />
          </DrawerPopup>
        </Drawer>

        {isMobile ? (
          <Drawer
            open={mobileInspector !== null}
            onOpenChange={(open) => !open && setMobileInspector(null)}
            position="bottom"
          >
            <DrawerPopup
              position="bottom"
              variant="inset"
              className="mx-auto h-[min(60svh,34rem)] w-full max-w-sm overflow-hidden rounded-lg bg-surface shadow-panel-lg"
            >
              {mobileInspector === 'layers' ? layersPanel : propertiesPanel}
            </DrawerPopup>
          </Drawer>
        ) : null}

        {renderSettings ? (
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogPopup
              showCloseButton={false}
              className="h-[min(70svh,36rem)] overflow-hidden p-0"
            >
              {renderSettings({
                onClose: () => setSettingsOpen(false),
                shortcutConfig,
                onShortcutConfigChange: updateShortcutConfig,
              })}
            </DialogPopup>
          </Dialog>
        ) : null}

        <CanvasExport
          controller={controller}
          open={exportOpen}
          onOpenChange={setExportOpen}
        />

        <HtmlImportDialog
          open={htmlImportOpen}
          onOpenChange={setHtmlImportOpen}
          defaultWidth={previewWidth}
          onImport={actions.insertDocument}
        />

        <IconPickerDialog
          open={iconPickerOpen}
          onOpenChange={setIconPickerOpen}
          onInsert={actions.insertIcon}
        />

        <EditorCommandMenu
          open={commandMenuOpen}
          onOpenChange={setCommandMenuOpen}
          groups={commandGroups}
        />
      </main>

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
        <header className="pointer-events-auto flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2">
          <Link
            to="/app"
            className="flex items-center gap-1.5"
            aria-label="Back to dashboard"
          >
            <img
              src="/logo192.png"
              alt=""
              width={16}
              height={16}
              className="size-4 shrink-0 rounded-sm"
            />
            <span className="shrink-0 text-xs font-semibold tracking-tight">
              loora
            </span>
          </Link>
          <span className="text-muted-foreground/35 max-sm:hidden">/</span>
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden max-sm:max-w-40">
            {typeof topBar === 'function'
              ? topBar({
                  openAssets: () => setAssetsOpen(true),
                  openHistory: () => setHistoryOpen(true),
                })
              : topBar ?? (
                  <span className="max-w-48 truncate text-xs text-muted-foreground">
                    {name}
                  </span>
                )}
          </div>
          <span className="text-muted-foreground/35 max-sm:hidden">/</span>
          <div className="max-sm:hidden">
            {readOnly ? (
              <span className="text-xs text-muted-foreground">Read-only</span>
            ) : (
              <CanvasSyncIndicator controller={controller} />
            )}
          </div>
          {/* The right cluster: the agent sits with the human collaborators,
              because to everyone in the document it is one of them. */}
          <div className="ms-auto flex min-w-0 shrink-0 items-center gap-2">
            <CanvasAgentAvatar controller={controller} />
            {topBarEnd}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {!isMobile ? (
            <CanvasDockedPanel
              side="left"
              title="Layers"
              storageKey="loora:layers-width"
            >
              {layersPanel}
            </CanvasDockedPanel>
          ) : null}
          {/* The free canvas area. The tool clusters float inside it so they
              stay centred on what is visible, not on the whole viewport. */}
          <div className="relative min-h-0 min-w-0 flex-1">
            <TooltipProvider delay={400} closeDelay={0}>
              <CanvasToolStrip
                actions={actions}
                interactionMode={interactionMode}
                onInteractionModeChange={setInteractionMode}
                onPreview={() => setExportOpen(true)}
                onAddPage={addPageAndFocus}
                onAssetsOpen={() => setAssetsOpen(true)}
                onOpenIconPicker={() => setIconPickerOpen(true)}
                onOpenInspector={setMobileInspector}
                onOpenCommands={() => setCommandMenuOpen(true)}
                shortcutLabel={shortcutLabel}
                controls={controlsRef}
                zoom={zoom}
                isMobile={isMobile}
              />
            </TooltipProvider>
            {pasteNotice ? (
              <div
                role="status"
                className="pointer-events-auto absolute inset-x-3 bottom-3 z-30 mx-auto max-w-md rounded-md border border-line bg-surface px-3 py-2 text-xs text-destructive-foreground shadow-panel-lg sm:inset-x-auto sm:right-3 sm:left-auto"
              >
                {pasteNotice}
              </div>
            ) : null}
          </div>

          {!isMobile ? (
            <CanvasDockedPanel
              side="right"
              title="Properties"
              storageKey="loora:properties-width"
            >
              {propertiesPanel}
            </CanvasDockedPanel>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export interface CanvasEditorController {
  engine: CanvasEngine
  target?: CanvasSyncTarget
  status: CanvasSyncStatus
  pendingCount: number
  revision?: number
  agentActivity?: CanvasAgentActivity | null
  remoteChange?: CanvasRemoteChange | null
  peers?: CanvasPeer[]
  publishPresence?: (presence: {
    cursor?: { x: number; y: number } | null
    selection?: string[]
  }) => void
  subscribe: (listener: () => void) => () => void
  /** Separate from `subscribe`: cursor updates must not rerender the editor. */
  subscribePresence?: (listener: () => void) => () => void
  /** Branch lifecycle notifications from realtime. */
  subscribeBranches?: (listener: () => void) => () => void
  enqueue: (transaction: CanvasTransaction) => void
  flush?: () => Promise<void>
  adoptSnapshot?: (
    document: CanvasDocument,
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
          ? 'text-xs text-destructive-foreground'
          : 'text-xs text-muted-foreground'
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

export interface CanvasEditorActions {
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
  editText: (ref: NodeRef) => void
  canCopy: boolean
  canCopyCode: boolean
  canEditText: boolean
  /** Serialized selection for a native copy/cut event, or null. */
  clipboardText: () => string | null
  copySelection: () => void
  copyCode: (format: CanvasCodeFormat, width?: number) => Promise<void>
  cutSelection: () => void
  pasteClipboard: () => void
  pasteFromText: (text: string) => void
  pasteFromHtml: (html: string, fallbackText?: string) => Promise<void>
  addShape: () => void
  addComponent: () => void
  insertIcon: (entry: IconEntry) => void
  insertDocument: (document: CanvasDocument) => void
  insertAsset: (asset: AssetMeta, placement?: CanvasDropPlacement) => void
  duplicateSelection: () => void
  deleteSelection: () => void
  groupSelection: () => void
  ungroupSelection: () => void
  reorderSelection: (direction: CanvasReorderDirection) => void
  nudgeSelection: (x: number, y: number) => void
}

function hasAncestor(
  document: CanvasDocument,
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
    src: assetSrc(asset),
    alt: asset.name,
    // Sized to the asset's aspect on insert, so fill paints edge-to-edge.
    fit: 'fill',
  }
}

function imagePlacementSize(
  natural: { width: number; height: number } | null,
  maxEdge = 320,
) {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { width: maxEdge, height: Math.round((maxEdge * 3) / 4) }
  }
  const scale = Math.min(maxEdge / natural.width, maxEdge / natural.height, 1)
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  }
}

function probeImageSize(src: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new Image()
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = src
  })
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

/** Survives a clipboard the browser will not hand back (permissions, http). */
let localClipboard = ''

function useCanvasEditorActions(
  onPasteError?: (message: string) => void,
): CanvasEditorActions {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const session = useCanvasSession()
  const transact = useCanvasTransaction()
  const history = useCanvasHistory()
  const readOnly = useCanvasReadOnly()
  const selected = selection[0]
  const activePage = containingPageForRef(document, selected)
  const parent =
    selected?.instancePath.length === 0
      ? insertionParent(document, selected.nodeId)
      : activePage ?? insertionParent(document)

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

  /** Puts an existing text node into edit mode; the renderer owns the caret. */
  const editText = (ref: NodeRef) => {
    if (readOnly) return
    session.editText(ref)
  }

  const addText = () => {
    if (!parent || readOnly) return
    const children = orderedChildren(document, parent.id)
    const node = createTextNode('New text', {
      parentId: parent.id,
      order: (children.at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(240, 42, {
        position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
        x: 48,
        y: 48,
        height: { unit: 'hug' },
      }),
    })
    insert(node)
    // Land in the box with the placeholder selected, so the next keystroke is
    // the copy rather than a trip through the inspector.
    editText({ nodeId: node.id, instancePath: [] })
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

  const insertVectorDescriptor = (
    name: string,
    descriptor: { viewBox: string; paths: VectorNode['paths'] },
  ) => {
    if (!parent || readOnly) return
    const children = orderedChildren(document, parent.id)
    insert(
      createVectorNode(name, {
        parentId: parent.id,
        order: (children.at(-1)?.order ?? 0) + 1024,
        layout: defaultLayout(48, 48, {
          position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
          x: 48,
          y: 48,
        }),
        style: defaultStyle({
          fills: [],
          stroke: { color: '#475467', width: 1.5 },
        }),
        viewBox: descriptor.viewBox,
        paths: descriptor.paths,
      }),
    )
  }

  const insertIcon = (entry: IconEntry) => {
    insertVectorDescriptor(entry.name, entry.toVector())
  }

  const addPage = () => {
    if (readOnly) return
    const pages = orderedChildren(document, null).filter(
      (node) => node.type === 'page',
    )
    const right = pages.reduce((value, page) => {
      const width = page.layout.width.unit === 'px' ? page.layout.width.value : page.viewport.width
      return Math.max(value, page.layout.x + width)
    }, 0)
    insert(createPageNode(`Page ${pages.length + 1}`, {
      order: (pages.at(-1)?.order ?? 0) + 1024,
      layout: defaultLayout(1440, 900, { x: right + 160, y: 80 }),
    }))
  }

  const insertDocument = (
    imported: CanvasDocument,
    label = 'Import HTML & CSS',
  ) => {
    if (readOnly) return
    const importedNodes = Object.values(imported.nodes)
    if (importedNodes.length === 0) return
    for (const node of importedNodes) {
      if (document.nodes[node.id]) {
        throw new Error(`Imported node ${node.id} already exists`)
      }
    }
    const roots = orderedChildren(document, null)
    const right = roots.reduce((value, node) => {
      const width =
        node.layout.width.unit === 'px'
          ? node.layout.width.value
          : node.type === 'page'
            ? node.viewport.width
            : 0
      return Math.max(value, node.layout.x + width)
    }, 0)
    const importedRoots = importedNodes
      .filter((node) => node.parentId === null)
      .sort((left, rightNode) => left.order - rightNode.order)
    const orderBase = roots.at(-1)?.order ?? 0
    const rootIds = new Set(importedRoots.map((node) => node.id))
    const nodes = importedNodes.map((node) => {
      const clone = structuredClone(node)
      if (rootIds.has(clone.id)) {
        const rootIndex = importedRoots.findIndex(
          (root) => root.id === clone.id,
        )
        clone.order = orderBase + (rootIndex + 1) * 1_024
        clone.layout.x += right + 160
      }
      return clone
    })
    const depth = (node: CanvasNode) => {
      let value = 0
      let parentId = node.parentId
      while (parentId) {
        value += 1
        parentId = imported.nodes[parentId]?.parentId ?? null
      }
      return value
    }
    nodes.sort(
      (left, rightNode) =>
        depth(left) - depth(rightNode) ||
        left.order - rightNode.order ||
        left.id.localeCompare(rightNode.id),
    )
    transact({
      id: canvasId('tx'),
      label,
      operations: nodes.map((node) => ({ type: 'node.insert', node })),
    })
    session.select(
      importedRoots.map((node) => ({
        nodeId: node.id,
        instancePath: [],
      })),
    )
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

  /**
   * Places an image. Without a placement it lands in the current insertion
   * parent; a drop onto the canvas supplies the container and point it was
   * dropped on.
   */
  const insertAsset = (asset: AssetMeta, placement?: CanvasDropPlacement) => {
    const target = placement
      ? document.nodes[placement.parentId]
      : parent
    if (!target || readOnly) return
    void (async () => {
      const size = imagePlacementSize(await probeImageSize(assetSrc(asset)))
      const children = orderedChildren(document, target.id)
      const frame = createFrameNode(asset.name, {
        parentId: target.id,
        order: placement?.order ?? (children.at(-1)?.order ?? 0) + 1024,
        layout: defaultLayout(size.width, size.height, {
          position:
            placement?.position ??
            (target.layout.mode === 'absolute' ? 'absolute' : 'flow'),
          // Dropped images centre on the pointer rather than hanging off it.
          x: placement ? Math.round(placement.x - size.width / 2) : 48,
          y: placement ? Math.round(placement.y - size.height / 2) : 48,
        }),
        style: defaultStyle({
          fills: [{ type: 'solid', color: '#ffffff' }],
          radius: 12,
          overflow: 'hidden',
        }),
      })
      insert(frameAsImage(frame, asset))
    })()
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

  const canCopy = sourceRoots.length > 0
  const canEditText =
    !readOnly &&
    selection.length === 1 &&
    resolveNodeRef(document, selection[0]!)?.type === 'text'

  /**
   * The payload for the current selection, also parked in memory so paste keeps
   * working when the browser will not hand the clipboard back (permissions,
   * insecure origin).
   */
  const clipboardText = () => {
    const payload = buildClipboardPayload(
      document,
      sourceRoots.map((ref) => ref.nodeId),
    )
    if (!payload) return null
    localClipboard = JSON.stringify(payload)
    return localClipboard
  }

  const pasteFromText = (text: string) => {
    if (!parent || readOnly || !text) return
    const payload = parseClipboardPayload(text)
    if (!payload) {
      const plain = text.trim()
      if (plain && looksLikeSvg(plain)) {
        const descriptor = svgStringToVectorDescriptor(plain)
        if (descriptor) {
          insertVectorDescriptor('Icon', descriptor)
          return
        }
      }
      if (plain) pasteText(plain)
      return
    }
    const pasted = pasteNodes(document, payload, parent.id)
    // The clipboard is untrusted: the nodes only land if the document they
    // would produce still validates.
    if (pasted.nodes.length === 0 || !validatePaste(document, pasted.nodes)) return
    transact({
      id: canvasId('tx'),
      label: pasted.rootIds.length === 1 ? 'Paste node' : 'Paste nodes',
      operations: pasted.nodes.map((node) => ({ type: 'node.insert', node })),
    })
    session.select(pasted.rootIds.map((nodeId) => ({ nodeId, instancePath: [] })))
  }

  const saveImportedImages = async (nodes: CanvasNode[]) => {
    const images = importedImageNodes(nodes)
    const bySource = new Map<string, ImageNode[]>()
    for (const image of images) {
      const matches = bySource.get(image.src) ?? []
      matches.push(image)
      bySource.set(image.src, matches)
    }

    const operations: CanvasOperation[] = []
    for (const [source, matching] of bySource) {
      try {
        const file = await fetchImageFile(source, matching[0]?.name ?? 'Pasted image')
        const saved = await orpc.asset.upload({
          name: file.name,
          mediaType: file.type,
          data: await fileToBase64(file),
        })
        for (const image of matching) {
          operations.push({
            type: 'node.patch',
            id: image.id,
            patch: { src: assetSrc(saved) },
          })
        }
      } catch (cause) {
        console.warn('[canvas] Could not save pasted image:', source, cause)
      }
    }
    if (operations.length > 0) {
      transact({
        id: canvasId('tx'),
        label: 'Save pasted images',
        operations,
      })
    }
  }

  const pasteFromHtml = async (html: string, fallbackText = '') => {
    if (readOnly || !html.trim()) return
    try {
      const width =
        activePage && parent?.type === 'page'
          ? parent.viewport.width
          : activePage && parent?.layout.width.unit === 'px'
            ? parent.layout.width.value
            : 1_440
      const imported = await importHtmlCssToCanvas({
        html,
        name: 'Paper Snapshot',
        width,
      })
      if (!activePage || !parent) {
        insertDocument(imported.document, 'Paste Paper Snapshot')
        void saveImportedImages(Object.values(imported.document.nodes))
        return
      }
      const placed = placeHtmlImport(document, imported.document, parent.id)
      if (
        placed.nodes.length === 0 ||
        !validatePaste(document, placed.nodes)
      ) {
        throw new Error('The pasted HTML did not produce valid Canvas nodes')
      }
      transact({
        id: canvasId('tx'),
        label: 'Paste Paper Snapshot',
        operations: placed.nodes.map((node) => ({ type: 'node.insert', node })),
      })
      session.select(
        placed.rootIds.map((nodeId) => ({ nodeId, instancePath: [] })),
      )
      void saveImportedImages(placed.nodes)
    } catch (cause) {
      console.warn('[canvas] HTML clipboard import failed:', cause)
      // Only fall back when plain text is our own canvas clipboard payload —
      // Paper's text/plain is not a useful substitute for a failed HTML import.
      if (parseClipboardPayload(fallbackText)) {
        pasteFromText(fallbackText)
        return
      }
      onPasteError?.(
        cause instanceof Error
          ? cause.message
          : 'Could not paste the HTML snapshot',
      )
    }
  }

  const copySelection = () => {
    const text = clipboardText()
    if (!text) return false
    void navigator.clipboard?.writeText(text).catch(() => undefined)
    return true
  }

  const cutSelection = () => {
    if (readOnly) return
    if (copySelection()) deleteSelection()
  }

  const pasteClipboard = async () => {
    let text = localClipboard
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          if (!item.types.includes('text/html')) continue
          const html = await (await item.getType('text/html')).text()
          const plain = item.types.includes('text/plain')
            ? await (await item.getType('text/plain')).text()
            : ''
          await pasteFromHtml(html, plain)
          return
        }
      }
      const fromSystem = await navigator.clipboard?.readText()
      if (fromSystem) text = fromSystem
    } catch {
      // Falls back to the in-memory copy.
    }
    pasteFromText(text)
  }

  const pasteText = (text: string) => {
    if (!parent || readOnly) return
    const children = orderedChildren(document, parent.id)
    insert(
      createTextNode(text.slice(0, 5_000), {
        parentId: parent.id,
        order: (children.at(-1)?.order ?? 0) + 1024,
        layout: defaultLayout(320, 42, {
          position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
          x: 48,
          y: 48,
          height: { unit: 'hug' },
        }),
      }),
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

  const codeRef =
    selection.length === 1 &&
    selection[0]!.instancePath.length === 0 &&
    document.nodes[selection[0]!.nodeId]?.type !== 'component'
      ? selection[0]!
      : null
  const copyCode = async (
    format: CanvasCodeFormat,
    width = 1_440,
  ) => {
    if (!codeRef) return
    await copyText(compileCanvasCode(document, codeRef, format, width))
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
    editText,
    canCopy,
    canCopyCode: !!codeRef,
    canEditText,
    clipboardText,
    copySelection,
    copyCode,
    cutSelection,
    pasteClipboard: () => void pasteClipboard(),
    pasteFromText,
    pasteFromHtml,
    addShape,
    addComponent,
    insertIcon,
    insertDocument,
    insertAsset,
    duplicateSelection,
    deleteSelection,
    groupSelection,
    ungroupSelection,
    reorderSelection,
    nudgeSelection,
  }
}

function CanvasToolButton({
  icon: Icon,
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ElementType
  label: string
  /** Chord shown beside the name, e.g. `⌘Z`. */
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            aria-pressed={active}
            data-active={active || undefined}
            className="shrink-0 rounded-md sm:[&_svg:not([class*='size-'])]:size-4 data-active:bg-accent data-active:text-foreground"
            onClick={onClick}
          >
            <Icon />
          </Button>
        }
      />
      <TooltipPopup side="top" sideOffset={8}>
        <span className="flex items-center gap-2 whitespace-nowrap">
          {label}
          {shortcut ? (
            <span className="text-muted-foreground">{shortcut}</span>
          ) : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  )
}

/** Assets, with the usage counts read off the live document. */
function CanvasAssets({ onInsert }: { onInsert: (asset: AssetMeta) => void }) {
  const document = useCanvasDocument()
  const usage = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const node of Object.values(document.nodes)) {
      if (node.type !== 'image') continue
      const id = node.src.match(/^\/api\/asset\/([\w-]+)$/)?.[1]
      if (id) counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  }, [document])
  return <AssetsPanel usage={usage} onInsert={onInsert} />
}

/**
 * The mobile strip. The docked panels do not exist at this width, so Layers and
 * Design have to be reachable here — the command menu behind them opens from a
 * keyboard chord that a touch device does not have. Insert tools collapse into
 * one menu so the row still fits without becoming a scroller.
 */
function CanvasMobileStrip({
  actions,
  interactionMode,
  onInteractionModeChange,
  onAddPage,
  onAssetsOpen,
  onOpenIconPicker,
  onOpenInspector,
  onOpenCommands,
  shortcutLabel,
}: {
  actions: CanvasEditorActions
  interactionMode: 'select' | 'pan'
  onInteractionModeChange: (mode: 'select' | 'pan') => void
  onAddPage: () => void
  onAssetsOpen: () => void
  onOpenIconPicker: () => void
  onOpenInspector: (which: 'layers' | 'design') => void
  onOpenCommands: () => void
  shortcutLabel: (id: BuiltInShortcutId) => string
}) {
  const insert = (run: () => void) => () => {
    run()
    onInteractionModeChange('select')
  }
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="horizontal"
      className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-panel-lg"
    >
      <CanvasToolButton
        icon={MousePointer2Icon}
        label="Select"
        active={interactionMode === 'select'}
        onClick={() => onInteractionModeChange('select')}
      />
      <CanvasToolButton
        icon={HandIcon}
        label="Hand"
        active={interactionMode === 'pan'}
        onClick={() => onInteractionModeChange('pan')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label="Insert"
            disabled={actions.readOnly}
            className="shrink-0 rounded-md"
          >
            <PlusIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-48">
          <DropdownMenuItem onClick={insert(onAddPage)}>
            <PanelsTopLeftIcon data-slot="icon" />
            New page
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!actions.parent} onClick={insert(actions.addFrame)}>
            <FrameIcon data-slot="icon" />
            Frame
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!actions.parent} onClick={insert(actions.addText)}>
            <TypeIcon data-slot="icon" />
            Text
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!actions.parent} onClick={insert(actions.addShape)}>
            <RectangleHorizontalIcon data-slot="icon" />
            Rectangle
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!actions.parent} onClick={insert(onOpenIconPicker)}>
            <ShapesIcon data-slot="icon" />
            Icon
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAssetsOpen}>
            <ImageIcon data-slot="icon" />
            Image
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!actions.parent} onClick={insert(actions.addComponent)}>
            <ComponentIcon data-slot="icon" />
            Component
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CanvasToolDivider />
      <CanvasToolButton
        icon={LayersIcon}
        label="Layers"
        onClick={() => onOpenInspector('layers')}
      />
      <CanvasToolButton
        icon={SlidersHorizontalIcon}
        label="Design"
        onClick={() => onOpenInspector('design')}
      />
      <CanvasToolDivider />
      <CanvasToolButton
        icon={Undo2Icon}
        label="Undo"
        shortcut={shortcutLabel('undo')}
        disabled={actions.readOnly || !actions.history.canUndo}
        onClick={() => actions.history.undo()}
      />
      <CanvasToolButton
        icon={EllipsisIcon}
        label="More"
        onClick={onOpenCommands}
      />
    </div>
  )
}

/** Floating chrome: a centred tool bar, plus a zoom pill in the corner. */
function CanvasToolStrip({
  actions,
  interactionMode,
  onInteractionModeChange,
  onPreview,
  onAddPage,
  onAssetsOpen,
  onOpenIconPicker,
  onOpenInspector,
  onOpenCommands,
  shortcutLabel,
  controls,
  zoom,
  isMobile,
}: {
  actions: CanvasEditorActions
  interactionMode: 'select' | 'pan'
  onInteractionModeChange: (mode: 'select' | 'pan') => void
  onPreview: () => void
  onAddPage: () => void
  onAssetsOpen: () => void
  onOpenIconPicker: () => void
  onOpenInspector: (which: 'layers' | 'design') => void
  onOpenCommands: () => void
  shortcutLabel: (id: BuiltInShortcutId) => string
  controls: RefObject<CanvasSurfaceControls | null>
  zoom: number
  isMobile: boolean
}) {
  const selectionCount = actions.selection.length
  if (isMobile) {
    return (
      <CanvasMobileStrip
        actions={actions}
        interactionMode={interactionMode}
        onInteractionModeChange={onInteractionModeChange}
        onAddPage={onAddPage}
        onAssetsOpen={onAssetsOpen}
        onOpenIconPicker={onOpenIconPicker}
        onOpenInspector={onOpenInspector}
        onOpenCommands={onOpenCommands}
        shortcutLabel={shortcutLabel}
      />
    )
  }
  return (
    <>
      <div
        role="toolbar"
        aria-label="Tools"
        aria-orientation="horizontal"
        className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-lg bg-surface p-0.5 shadow-panel-lg"
      >
        <CanvasToolButton
          icon={MousePointer2Icon}
          label="Select"
          shortcut={shortcutLabel('tool.select')}
          active={interactionMode === 'select'}
          onClick={() => onInteractionModeChange('select')}
        />
        <CanvasToolButton
          icon={HandIcon}
          label="Hand"
          shortcut={shortcutLabel('tool.hand')}
          active={interactionMode === 'pan'}
          onClick={() => onInteractionModeChange('pan')}
        />
        <CanvasToolButton
          icon={EyeIcon}
          label="Preview interactions"
          onClick={onPreview}
        />
        <CanvasToolDivider />
        <CanvasToolButton
          icon={PanelsTopLeftIcon}
          label="New page"
          disabled={actions.readOnly}
          onClick={() => {
            onAddPage()
            onInteractionModeChange('select')
          }}
        />
        <CanvasToolButton
          icon={FrameIcon}
          label="Frame"
          disabled={actions.readOnly || !actions.parent}
          onClick={() => {
            actions.addFrame()
            onInteractionModeChange('select')
          }}
        />
        <CanvasToolButton
          icon={TypeIcon}
          label="Text"
          shortcut={shortcutLabel('tool.text')}
          disabled={actions.readOnly || !actions.parent}
          onClick={() => {
            actions.addText()
            onInteractionModeChange('select')
          }}
        />
        <CanvasToolButton
          icon={RectangleHorizontalIcon}
          label="Rectangle"
          shortcut={shortcutLabel('tool.box')}
          disabled={actions.readOnly || !actions.parent}
          onClick={() => {
            actions.addShape()
            onInteractionModeChange('select')
          }}
        />
        <CanvasToolButton
          icon={ShapesIcon}
          label="Icon"
          disabled={actions.readOnly || !actions.parent}
          onClick={onOpenIconPicker}
        />
        <CanvasToolButton
          icon={ImageIcon}
          label="Image"
          shortcut={shortcutLabel('tool.image')}
          disabled={actions.readOnly}
          onClick={onAssetsOpen}
        />
        <CanvasToolButton
          icon={ComponentIcon}
          label="Component"
          disabled={actions.readOnly || !actions.parent}
          onClick={() => {
            actions.addComponent()
            onInteractionModeChange('select')
          }}
        />
        <CanvasToolDivider />
        <CanvasToolButton
          icon={Undo2Icon}
          label="Undo"
          shortcut={shortcutLabel('undo')}
          disabled={actions.readOnly || !actions.history.canUndo}
          onClick={() => actions.history.undo()}
        />
        <CanvasToolButton
          icon={Redo2Icon}
          label="Redo"
          shortcut={shortcutLabel('redo')}
          disabled={actions.readOnly || !actions.history.canRedo}
          onClick={() => actions.history.redo()}
        />
      </div>

      <div className="pointer-events-auto absolute bottom-3 end-3 flex items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-panel-lg max-md:hidden">
        <CanvasToolButton
          icon={ZoomOutIcon}
          label="Zoom out"
          onClick={() => controls.current?.zoomOut()}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="lg"
                variant="ghost"
                aria-label="Reset zoom"
                className="min-w-11 px-1.5 font-semibold tabular-nums sm:text-xs"
                onClick={() => controls.current?.zoomReset()}
              >
                {Math.round(zoom * 100)}%
              </Button>
            }
          />
          <TooltipPopup side="top" sideOffset={8}>
            <span className="flex items-center gap-2 whitespace-nowrap">
              Reset zoom
              <span className="text-muted-foreground">{shortcutLabel('zoomReset')}</span>
            </span>
          </TooltipPopup>
        </Tooltip>
        <CanvasToolButton
          icon={ZoomInIcon}
          label="Zoom in"
          onClick={() => controls.current?.zoomIn()}
        />
        <CanvasToolButton
          icon={MaximizeIcon}
          label={selectionCount > 0 ? 'Zoom to selection' : 'Zoom to fit'}
          onClick={() =>
            selectionCount > 0
              ? controls.current?.zoomToSelection()
              : controls.current?.zoomToFit()
          }
        />
      </div>
    </>
  )
}

function CanvasToolDivider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-line" />
}
