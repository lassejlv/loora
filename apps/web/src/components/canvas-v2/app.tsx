import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  FilePlus2Icon,
  FolderIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  CheckIcon,
  ChevronDownIcon,
  FigmaIcon,
  RefreshCwIcon,
} from '#/components/icons'
import { CanvasEngine, type CanvasTransaction } from '@loora/canvas/engine'
import { CanvasV2Editor, type CanvasEditorController } from './editor'
import {
  CanvasV2Branches,
  type CanvasBranchSummary,
} from './branches'
import {
  CanvasSyncController,
  type CanvasSyncTarget,
} from '#/lib/canvas-v2-client'
import { createStarterCanvas } from '#/lib/canvas-v2-fixtures'
import { createDesign, type DesignSummary } from '#/lib/designs'
import { migrateCanvasDesign, type CanvasMigrationOutcome } from '#/lib/canvas-v2-migration'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  FigmaImportDialog,
  type FigmaImportDestination,
} from '#/components/figma-import-dialog'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

function CanvasV2DocSwitcher({
  documents,
  activeId,
  onSwitch,
  onNew,
  onImport,
  onRename,
  onDelete,
}: {
  documents: DesignSummary[]
  activeId: string
  onSwitch: (id: string) => void
  onNew: () => void
  onImport: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const active = documents.find((document) => document.id === activeId)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="pointer-events-auto flex min-w-0 max-w-40 items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] leading-none text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <span className="truncate">{active?.name ?? 'Untitled'}</span>
          <ChevronDownIcon className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="pointer-events-auto w-56"
      >
        <DropdownMenuItem asChild>
          <Link to="/app">
            <FolderIcon data-slot="icon" />
            All files
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {documents.map((document) => (
          <DropdownMenuItem
            key={document.id}
            onClick={() => onSwitch(document.id)}
          >
            <span className="min-w-0 flex-1 truncate">{document.name}</span>
            {document.id === activeId ? (
              <CheckIcon className="size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNew}>
          <FilePlus2Icon data-slot="icon" />
          New document
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport}>
          <FigmaIcon data-slot="icon" />
          Import from Figma
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon data-slot="icon" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon data-slot="icon" />
          Delete document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function previewController(): CanvasEditorController {
  const engine = new CanvasEngine(createStarterCanvas('preview', 'Loora Canvas V2'))
  return {
    engine,
    status: 'ready',
    pendingCount: 0,
    subscribe: () => () => {},
    enqueue: (_transaction: CanvasTransaction) => {},
  }
}

function urlDraftId() {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('draft')
}

function setUrlDraftId(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('draft', id)
  else url.searchParams.delete('draft')
  window.history.replaceState(null, '', url)
}

export function CanvasV2App({
  preview = false,
  designId,
}: {
  preview?: boolean
  /** The document this editor opens. `/app/design` remounts on change. */
  designId?: string
  userId?: string
}) {
  const navigate = useNavigate()
  const previewValue = useMemo(previewController, [])
  const [documents, setDocuments] = useState<DesignSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(designId ?? null)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [branches, setBranches] = useState<CanvasBranchSummary[]>([])
  const [controller, setController] = useState<CanvasSyncController | null>(null)
  const controllerRef = useRef<CanvasSyncController | null>(null)
  const [loading, setLoading] = useState(!preview)
  const [progress, setProgress] = useState('Opening Canvas V2')
  const [error, setError] = useState<string | null>(null)
  const [migration, setMigration] = useState<CanvasMigrationOutcome | null>(null)
  const [figmaOpen, setFigmaOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const openTarget = useCallback(async (target: CanvasSyncTarget) => {
    setLoading(true)
    setError(null)
    setProgress('Loading canvas')
    try {
      const found = await orpc.canvas.get({
        designId: target.designId,
        draftId: target.draftId,
      })
      let ready =
        found.status === 'ready'
          ? { document: found.document, revision: found.revision }
          : null
      if (!ready) {
        const outcome = await migrateCanvasDesign(target.designId, setProgress)
        setMigration(outcome)
        if (target.draftId) {
          const migrated = await orpc.canvas.get({
            designId: target.designId,
            draftId: target.draftId,
          })
          if (migrated.status !== 'ready') {
            throw new Error('Branch migration did not commit')
          }
          ready = {
            document: migrated.document,
            revision: migrated.revision,
          }
        } else {
          ready = { document: outcome.document, revision: outcome.revision }
        }
      }
      if (!ready.document) throw new Error('Canvas snapshot was not returned')
      const next = await CanvasSyncController.open(
        target,
        ready.document,
        ready.revision,
      )
      const previous = controllerRef.current
      controllerRef.current = next
      setController(next)
      setActiveDraftId(target.draftId)
      setUrlDraftId(target.draftId)
      if (previous) void previous.close()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Canvas V2 could not be opened'
      setError(message)
      if (message.includes('another tab')) {
        window.setTimeout(() => void openTarget(target), 1_500)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const switchTarget = useCallback(
    async (draftId: string | null) => {
      if (!activeId) return
      await controllerRef.current?.flush()
      await openTarget({ designId: activeId, draftId })
    },
    [activeId, openTarget],
  )

  const newDesign = useCallback(async () => {
    const created = await createDesign()
    await navigate({ to: '/app/design', search: { id: created.id } })
  }, [navigate])

  useEffect(() => {
    if (preview || !designId) return
    let cancelled = false
    void (async () => {
      try {
        const found = await orpc.design.list()
        if (cancelled) return
        setDocuments(found)
        setActiveId(designId)
        const foundBranches = await orpc.draft.list({
          designId,
          includeArchived: true,
        })
        if (cancelled) return
        setBranches(foundBranches)
        const requestedDraft = urlDraftId()
        const openDraft = foundBranches.find(
          (branch) =>
            branch.id === requestedDraft &&
            (branch.status === 'active' || branch.status === 'proposed'),
        )
        await openTarget({
          designId,
          draftId: openDraft?.id ?? null,
        })
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load designs')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [designId, openTarget, preview])

  useEffect(
    () => () => {
      if (controllerRef.current) void controllerRef.current.close()
    },
    [],
  )

  if (preview) {
    return (
      <div className="h-screen min-h-[42rem] w-full">
        <CanvasV2Editor controller={previewValue} name="Loora Canvas V2" />
      </div>
    )
  }

  if (error) {
    return (
      <main className="grid h-screen place-items-center bg-cx-canvas p-4">
        <div className="max-w-sm rounded-lg border bg-card p-4 text-center">
          <h1 className="text-base font-semibold">Canvas V2 could not open</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            {activeId ? (
              <Button
                onClick={() => void openTarget({ designId: activeId, draftId: null })}
              >
                <RefreshCwIcon />
                Retry
              </Button>
            ) : null}
            <Button variant="outline" render={<Link to="/app" />}>
              <FolderIcon />
              All files
            </Button>
          </div>
        </div>
      </main>
    )
  }

  if (loading || !activeId || !controller) {
    return (
      <main className="grid h-screen place-items-center bg-cx-canvas">
        <div className="text-center">
          <div className="mx-auto mb-3 size-5 animate-spin rounded-full border-2 border-cx-accent border-t-transparent" />
          <p className="text-sm font-medium">{progress}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {progress.includes('Migrating') ? 'Editing is paused while the migration lease is active.' : 'Preparing your structured document.'}
          </p>
        </div>
      </main>
    )
  }

  const active = documents.find((document) => document.id === activeId)
  const activeBranch =
    branches.find((branch) => branch.id === activeDraftId) ?? null
  const handleFigmaImport = async (
    result: Awaited<ReturnType<typeof orpc.figma.import>>,
    destination: FigmaImportDestination,
  ) => {
    if (destination === 'current') {
      await controller.adoptSnapshot(result.design.document, result.design.revision)
      setDocuments((current) =>
        current.map((entry) =>
          entry.id === result.design.id
            ? {
                ...entry,
                name: result.design.name,
                revision: result.design.revision,
                updatedAt: result.design.updatedAt,
              }
            : entry,
        ),
      )
      return
    }
    await controller.flush()
    setUrlDraftId(null)
    await navigate({ to: '/app/design', search: { id: result.design.id } })
  }
  const renameDesign = async () => {
    const name = renameName.trim()
    if (!name || activeDraftId) return
    await controller.flush()
    if (controller.pendingCount > 0) {
      throw new Error('Save or resolve pending changes before renaming.')
    }
    const renamed = await orpc.canvas.rename({
      designId: activeId,
      name,
      expectedRevision: controller.revision,
    })
    await controller.adoptSnapshot(renamed.document, renamed.revision)
    setDocuments((current) =>
      current.map((entry) =>
        entry.id === activeId
          ? { ...entry, name, revision: renamed.revision, updatedAt: Date.now() }
          : entry,
      ),
    )
    setRenameOpen(false)
  }
  const deleteDesign = async () => {
    await controller.flush()
    if (controller.pendingCount > 0) {
      throw new Error('Save or resolve pending changes before deleting.')
    }
    await orpc.design.delete({ id: activeId })
    await controller.close()
    controllerRef.current = null
    setController(null)
    setDeleteOpen(false)
    await navigate({ to: '/app' })
  }
  const switchDesign = (id: string) => {
    if (id === activeId) return
    setUrlDraftId(null)
    void controller.flush().then(() =>
      navigate({ to: '/app/design', search: { id } }),
    )
  }
  return (
    <div className="h-screen min-h-0">
      <CanvasV2Editor
        controller={controller}
        name={active?.name ?? controller.engine.document.name}
        readOnly={
          activeBranch?.status === 'applied' ||
          activeBranch?.status === 'closed'
        }
        topBar={
          <>
            <CanvasV2DocSwitcher
              documents={documents}
              activeId={activeId}
              onSwitch={switchDesign}
              onNew={() => void newDesign()}
              onImport={() => setFigmaOpen(true)}
              onRename={() => {
                setRenameName(active?.name ?? '')
                setRenameOpen(true)
              }}
              onDelete={() => setDeleteOpen(true)}
            />
            <span className="text-muted-foreground/50">/</span>
            <CanvasV2Branches
              designId={activeId}
              activeDraftId={activeDraftId}
              controller={controller}
              branches={branches}
              onBranchesChange={setBranches}
              onSwitch={switchTarget}
            />
          </>
        }
      />
      <FigmaImportDialog
        open={figmaOpen}
        onOpenChange={setFigmaOpen}
        currentDocument={{
          id: activeId,
          name: active?.name ?? controller.engine.document.name,
          draftId: activeDraftId,
          revision: controller.revision,
        }}
        prepareCurrentImport={async () => {
          await controller.flush()
          return { revision: controller.revision }
        }}
        onImported={(result, destination) => {
          void handleFigmaImport(result, destination)
        }}
      />
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename design</DialogTitle>
            <DialogDescription>
              The structured document and its generated output use this name.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && renameName.trim()) {
                  void renameDesign()
                }
              }}
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              disabled={!renameName.trim()}
              onClick={() => void renameDesign()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this design?</DialogTitle>
            <DialogDescription>
              This removes Main, every branch, history, chats, and public links.
              It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteDesign()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog open={!!migration} onOpenChange={(open) => !open && setMigration(null)}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Canvas upgraded to V2</DialogTitle>
            <DialogDescription>
              The legacy source is retained for rollback. Raster fallbacks preserve blocks that
              could not reach the 0.98 visual threshold.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="max-h-80 space-y-2 overflow-y-auto">
            {migration?.reports.map(({ target, report }) => (
              <div key={target} className="rounded-lg border px-3 py-2 text-sm">
                <p className="font-medium">{target}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {report.convertedElements} editable · {report.rasterFallbacks} raster fallback
                  {report.rasterFallbacks === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => setMigration(null)}>Continue</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
