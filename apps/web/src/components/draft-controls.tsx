import { useState } from 'react'
import type { CanvasElement } from '#/lib/canvas'
import {
  mergeCanvas,
  type CanvasMergeConflict,
  type DraftStatus,
  type MergeChoice,
} from '@loora/db/drafts'
import { CheckIcon, ChevronDownIcon } from '#/components/icons'
import { EllipsisIcon, GitBranchIcon, PlusIcon } from 'lucide-react'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { DesignDiff } from '#/components/design-diff'
import { Spinner } from '#/components/ui/spinner'

export interface BranchSummary {
  id: string
  name: string
  description: string
  status: DraftStatus
  baseRevision: number
  revision: number
  proposedAt: number | null
  appliedAt: number | null
  closedAt: number | null
  createdAt: number
  updatedAt: number
}

type Comparison = Awaited<ReturnType<typeof orpc.draft.compare>>

const isOpenBranch = (branch: BranchSummary) =>
  branch.status === 'active' || branch.status === 'proposed'

const branchStatusLabel = (status: DraftStatus) => {
  if (status === 'proposed') return 'Reviewing'
  if (status === 'applied') return 'Merged'
  if (status === 'closed') return 'Discarded'
  return 'Active'
}

export function BranchControls({
  designId,
  branches,
  activeBranchId,
  runningBranchIds = [],
  onSwitch,
  onCreated,
  onChanged,
  onApplied,
  flush,
}: {
  designId: string
  branches: BranchSummary[]
  activeBranchId: string | null
  runningBranchIds?: string[]
  onSwitch: (branchId: string | null, skipFlush?: boolean) => void
  onCreated: (branch: BranchSummary) => void
  onChanged: () => Promise<void> | void
  onApplied: (shapes: CanvasElement[], revision: number, branchName: string) => void
  flush: () => Promise<void>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<BranchSummary | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, MergeChoice>>({})
  const [renameTarget, setRenameTarget] = useState<BranchSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  const [discardTarget, setDiscardTarget] = useState<BranchSummary | null>(null)

  const active = branches.find((branch) => branch.id === activeBranchId) ?? null
  const openBranches = branches.filter(isOpenBranch)
  const archivedBranches = branches.filter((branch) => !isOpenBranch(branch))
  const running = new Set(runningBranchIds)
  const activeBusy = active ? running.has(active.id) : false
  const unresolved = comparison?.conflicts.filter((conflict) => !resolutions[conflict.id]) ?? []
  const mergedPreview = comparison
    ? mergeCanvas(
        comparison.baseShapes,
        comparison.mainShapes,
        comparison.draftShapes,
        resolutions,
      ).shapes
    : []
  const hasChanges = comparison
    ? comparison.summary.added + comparison.summary.removed + comparison.summary.changed > 0
    : false

  const create = async () => {
    const name = createName.trim()
    if (!name) return
    setWorking(true)
    try {
      await flush()
      const created = await orpc.draft.create({
        id: `dr${crypto.randomUUID().replaceAll('-', '')}`,
        designId,
        name,
      })
      onCreated(created)
      setCreateOpen(false)
      setCreateName('')
    } finally {
      setWorking(false)
    }
  }

  const loadReview = async (branch = reviewTarget ?? active) => {
    if (!branch || running.has(branch.id)) return
    setWorking(true)
    setReviewTarget(branch)
    setReviewError(null)
    try {
      await flush()
      const next = await orpc.draft.compare({ designId, id: branch.id })
      setComparison(next)
      setResolutions({})
      setReviewOpen(true)
    } catch (error) {
      setComparison(null)
      setReviewError(error instanceof Error ? error.message : 'Could not review this branch.')
      setReviewOpen(true)
    } finally {
      setWorking(false)
    }
  }

  const apply = async () => {
    if (!comparison || !hasChanges) return
    setWorking(true)
    setReviewError(null)
    try {
      const result = await orpc.draft.apply({
        designId,
        id: comparison.draft.id,
        expectedMainRevision: comparison.mainRevision,
        expectedDraftRevision: comparison.draft.revision,
        resolutions,
      })
      if (!result.applied) {
        setReviewError('Resolve every conflict before merging this branch.')
        return
      }
      onApplied(result.shapes, result.revision, comparison.draft.name)
      await onChanged()
      setReviewOpen(false)
      setComparison(null)
      setReviewTarget(null)
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : 'Main or this branch changed. Refresh the review and try again.',
      )
    } finally {
      setWorking(false)
    }
  }

  const rename = async () => {
    if (!renameTarget || !renameName.trim()) return
    setWorking(true)
    try {
      await orpc.draft.rename({
        designId,
        id: renameTarget.id,
        name: renameName.trim(),
      })
      await onChanged()
      setRenameTarget(null)
      setRenameName('')
    } finally {
      setWorking(false)
    }
  }

  const discard = async () => {
    if (!discardTarget || running.has(discardTarget.id)) return
    setWorking(true)
    try {
      await flush()
      await orpc.draft.close({ designId, id: discardTarget.id })
      if (discardTarget.id === activeBranchId) onSwitch(null, true)
      await onChanged()
      setDiscardTarget(null)
    } finally {
      setWorking(false)
    }
  }

  const resumeLegacyBranch = async (branch: BranchSummary) => {
    setWorking(true)
    try {
      await orpc.draft.reopen({ designId, id: branch.id })
      await onChanged()
      onSwitch(branch.id)
      setManageOpen(false)
    } finally {
      setWorking(false)
    }
  }

  const beginRename = (branch: BranchSummary) => {
    setRenameTarget(branch)
    setRenameName(branch.name)
  }

  return (
    <>
      <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={
                active
                  ? 'flex min-w-0 max-w-56 items-center gap-1.5 rounded-lg border border-cx-accent/25 bg-cx-accent/8 px-2 py-1 text-sm font-medium text-foreground shadow-xs hover:bg-cx-accent/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  : 'flex min-w-0 max-w-48 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              }
            >
              <GitBranchIcon className={active ? 'size-3.5 text-cx-accent' : 'size-3.5'} />
              <span className="truncate">{active?.name ?? 'Main'}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-72">
            <DropdownMenuLabel>Branches</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onSwitch(null)}>
              <GitBranchIcon />
              <span className="min-w-0 flex-1 truncate">Main</span>
              {!activeBranchId ? <CheckIcon className="size-3.5" /> : null}
            </DropdownMenuItem>
            {openBranches.map((branch) => (
              <DropdownMenuItem key={branch.id} onClick={() => onSwitch(branch.id)}>
                <GitBranchIcon />
                <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                {branch.status === 'proposed' ? (
                  <span className="text-[10px] uppercase text-muted-foreground">Reviewing</span>
                ) : null}
                {running.has(branch.id) ? <Spinner className="size-3 text-cx-accent" /> : null}
                {branch.id === activeBranchId ? <CheckIcon className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              New branch from Main…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setManageOpen(true)}>
              <EllipsisIcon />
              Manage branches…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {active && isOpenBranch(active) ? (
          <>
            <span className="hidden text-xs text-muted-foreground md:inline">
              {activeBusy ? 'Agent running' : 'Isolated from Main'}
            </span>
            <Button
              size="xs"
              disabled={working || activeBusy}
              title={activeBusy ? 'Wait for the agent on this branch to finish.' : undefined}
              onClick={() => void loadReview(active)}
            >
              Review &amp; merge
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`More actions for ${active.name}`}
                  title="Branch actions"
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {active.status === 'active' ? (
                  <DropdownMenuItem onClick={() => beginRename(active)}>
                    Rename branch
                  </DropdownMenuItem>
                ) : null}
                {active.status === 'proposed' ? (
                  <DropdownMenuItem
                    disabled={working}
                    onClick={() => void resumeLegacyBranch(active)}
                  >
                    Resume editing
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  variant="destructive"
                  disabled={working || activeBusy}
                  onClick={() => setDiscardTarget(active)}
                >
                  Discard branch
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : active ? (
          <>
            <span className="text-xs text-muted-foreground">
              {branchStatusLabel(active.status)} · read-only
            </span>
            <Button size="xs" variant="outline" onClick={() => onSwitch(null)}>
              Back to Main
            </Button>
          </>
        ) : null}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              Starts from the latest Main canvas and stays isolated until you merge it.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={createName}
            maxLength={200}
            placeholder="Pricing experiment"
            aria-label="Branch name"
            onChange={(event) => setCreateName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!createName.trim() || working} onClick={() => void create()}>
              {working ? 'Creating…' : 'Create branch'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage branches</DialogTitle>
            <DialogDescription>
              Review active work or revisit merged and discarded branch snapshots.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto">
            <BranchList
              title="Active"
              empty="No active branches."
              branches={openBranches}
              running={running}
              onView={(branch) => {
                onSwitch(branch.id)
                setManageOpen(false)
              }}
              onReview={(branch) => {
                setManageOpen(false)
                void loadReview(branch)
              }}
              onRename={beginRename}
              onDiscard={setDiscardTarget}
              onResume={(branch) => void resumeLegacyBranch(branch)}
            />
            <BranchList
              title="History"
              empty="Merged and discarded branches will appear here."
              branches={archivedBranches}
              running={running}
              onView={(branch) => {
                onSwitch(branch.id)
                setManageOpen(false)
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameName('')
          }
        }}
      >
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename branch</DialogTitle>
            <DialogDescription>Use a name that describes the work happening here.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameName}
            maxLength={200}
            aria-label="Branch name"
            onChange={(event) => setRenameName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button disabled={!renameName.trim() || working} onClick={() => void rename()}>
              {working ? 'Renaming…' : 'Rename branch'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={discardTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null)
        }}
      >
        <AlertDialogPopup className="max-w-sm" bottomStickOnMobile={false}>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this branch?</AlertDialogTitle>
            <AlertDialogDescription>
              “{discardTarget?.name}” will leave active work, but its snapshot remains available in
              branch history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={working}
              onClick={() => void discard()}
            >
              {working ? 'Discarding…' : 'Discard branch'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          setReviewOpen(open)
          if (!open) {
            setComparison(null)
            setReviewTarget(null)
            setReviewError(null)
            setResolutions({})
          }
        }}
      >
        <DialogPopup className="h-[min(88svh,60rem)] max-w-6xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              Merge “{comparison?.draft.name ?? reviewTarget?.name ?? 'branch'}” into Main
            </DialogTitle>
            <DialogDescription>
              {comparison
                ? `${comparison.summary.added} added, ${comparison.summary.removed} removed, ${comparison.summary.changed} changed`
                : 'Compare this branch with the latest Main canvas.'}
            </DialogDescription>
          </DialogHeader>
          {reviewError ? (
            <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
              <span>{reviewError}</span>
              {reviewTarget ? (
                <Button size="xs" variant="outline" onClick={() => void loadReview(reviewTarget)}>
                  Refresh review
                </Button>
              ) : null}
            </div>
          ) : null}
          {comparison ? (
            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-h-0 overflow-hidden rounded-lg border">
                <DesignDiff
                  oldShapes={comparison.mainShapes}
                  newShapes={mergedPreview}
                  oldKey={`main:${comparison.mainRevision}`}
                  newKey={`branch:${comparison.draft.id}:${comparison.draft.revision}:${JSON.stringify(resolutions)}`}
                />
              </div>
              <div className="min-h-0 overflow-y-auto rounded-lg border p-3">
                <h3 className="text-sm font-medium">Merge checks</h3>
                {!hasChanges ? (
                  <p className="mt-2 text-xs text-muted-foreground">No changes to merge.</p>
                ) : comparison.conflicts.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    This branch can be merged automatically.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {comparison.conflicts.map((conflict) => (
                      <ConflictChoice
                        key={conflict.id}
                        conflict={conflict}
                        value={resolutions[conflict.id]}
                        onChange={(choice) =>
                          setResolutions((current) => ({ ...current, [conflict.id]: choice }))
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
              {working ? 'Loading review…' : 'Review unavailable.'}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !comparison ||
                !hasChanges ||
                (comparison.draft.status !== 'active' &&
                  comparison.draft.status !== 'proposed') ||
                unresolved.length > 0 ||
                working
              }
              onClick={() => void apply()}
            >
              {working ? 'Merging…' : 'Merge into Main'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}

function BranchList({
  title,
  empty,
  branches,
  running,
  onView,
  onReview,
  onRename,
  onDiscard,
  onResume,
}: {
  title: string
  empty: string
  branches: BranchSummary[]
  running: Set<string>
  onView: (branch: BranchSummary) => void
  onReview?: (branch: BranchSummary) => void
  onRename?: (branch: BranchSummary) => void
  onDiscard?: (branch: BranchSummary) => void
  onResume?: (branch: BranchSummary) => void
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {branches.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {branches.map((branch) => {
            const busy = running.has(branch.id)
            return (
              <li key={branch.id} className="flex items-center gap-3 px-3 py-2.5">
                <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onView(branch)}
                >
                  <span className="block truncate text-sm font-medium">{branch.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {busy ? 'Agent running' : branchStatusLabel(branch.status)}
                  </span>
                </button>
                {onReview && isOpenBranch(branch) ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onReview(branch)}
                  >
                    Review
                  </Button>
                ) : null}
                {onRename || onDiscard || (onResume && branch.status === 'proposed') ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`More actions for ${branch.name}`}
                      >
                        <EllipsisIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {onRename && branch.status === 'active' ? (
                        <DropdownMenuItem onClick={() => onRename(branch)}>
                          Rename branch
                        </DropdownMenuItem>
                      ) : null}
                      {onResume && branch.status === 'proposed' ? (
                        <DropdownMenuItem onClick={() => onResume(branch)}>
                          Resume editing
                        </DropdownMenuItem>
                      ) : null}
                      {onDiscard ? (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={busy}
                          onClick={() => onDiscard(branch)}
                        >
                          Discard branch
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ConflictChoice({
  conflict,
  value,
  onChange,
}: {
  conflict: CanvasMergeConflict
  value: MergeChoice | undefined
  onChange: (choice: MergeChoice) => void
}) {
  const label =
    conflict.kind === 'order'
      ? 'Layer order changed in both'
      : `"${conflict.draft?.name ?? conflict.main?.name ?? conflict.elementId}" changed in both`
  return (
    <li className="rounded-md border p-2">
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <Button
          size="sm"
          variant={value === 'main' ? 'secondary' : 'outline'}
          onClick={() => onChange('main')}
        >
          Keep Main
        </Button>
        <Button
          size="sm"
          variant={value === 'draft' ? 'secondary' : 'outline'}
          onClick={() => onChange('draft')}
        >
          Use branch
        </Button>
      </div>
    </li>
  )
}
