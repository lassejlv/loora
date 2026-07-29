import { useEffect, useMemo, useState } from 'react'
import { ListTreeIcon, PencilIcon, Trash2Icon } from '#/components/icons'
import {
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitMergeIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
} from '#/components/icons'
import type { CanvasDocument } from '@loora/canvas/model'
import { diffDocuments } from '@loora/canvas/merge'
import { orpc } from '#/lib/orpc-client'
import { CanvasDocumentPreview } from '#/components/canvas-preview'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { Textarea } from '#/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import { relativeTime } from '#/lib/designs'
import { cn } from '#/lib/utils'
import type { CanvasSyncController } from '#/lib/canvas-client'

export interface CanvasBranchSummary {
  id: string
  name: string
  description: string
  status: 'active' | 'proposed' | 'applied' | 'closed'
  baseRevision: number
  revision: number
  proposedAt: number | null
  appliedAt: number | null
  closedAt: number | null
  createdAt: number
  updatedAt: number
}

interface CanvasBranchesProps {
  designId: string
  activeDraftId: string | null
  controller: CanvasSyncController
  branches: CanvasBranchSummary[]
  onBranchesChange: (branches: CanvasBranchSummary[]) => void
  onSwitch: (draftId: string | null) => Promise<void>
}

interface BranchCanvasConflict {
  id: string
  scope: 'node' | 'token' | 'document'
  targetId: string
  path: string
  base: unknown
  main: unknown
  draft: unknown
}

type Comparison = Awaited<ReturnType<typeof orpc.draft.compare>>

const STATUS_LABEL: Record<CanvasBranchSummary['status'], string> = {
  active: 'Active',
  proposed: 'Proposed',
  applied: 'Applied',
  closed: 'Discarded',
}

function isOpen(branch: CanvasBranchSummary) {
  return branch.status === 'active' || branch.status === 'proposed'
}

/** Conflicting values are structured, so they are shown, not dumped. */
function formatValue(value: unknown) {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return value || '""'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const text = JSON.stringify(value)
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

/** The layer's name beats its id — the id means nothing to whoever branched. */
function conflictTitle(
  conflict: BranchCanvasConflict,
  main: CanvasDocument | null,
  draft: CanvasDocument | null,
) {
  if (conflict.scope === 'document') return `Document · ${conflict.path || 'settings'}`
  if (conflict.scope === 'token') return `Token ${conflict.targetId}`
  const node = draft?.nodes[conflict.targetId] ?? main?.nodes[conflict.targetId]
  const name = node ? `${node.name}` : conflict.targetId
  return conflict.path ? `${name} · ${conflict.path}` : `${name} · whole layer`
}

function countLabel(diff: { added: number; removed: number; changed: number }) {
  const total = diff.added + diff.removed + diff.changed
  if (total === 0) return 'no changes'
  return `+${diff.added} −${diff.removed} · ${diff.changed} edited`
}

export function CanvasBranches({
  designId,
  activeDraftId,
  controller,
  branches,
  onBranchesChange,
  onSwitch,
}: CanvasBranchesProps) {
  const [manageOpen, setManageOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [empty, setEmpty] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, 'main' | 'draft'>>({})
  const [side, setSide] = useState<'draft' | 'main'>('draft')

  const active = branches.find((branch) => branch.id === activeDraftId) ?? null
  const openBranches = useMemo(() => branches.filter(isOpen), [branches])
  const archived = useMemo(() => branches.filter((branch) => !isOpen(branch)), [branches])

  const refresh = async () => {
    const next = await orpc.draft.list({ designId, includeArchived: true })
    onBranchesChange(next)
    return next
  }

  useEffect(() => {
    setComparison(null)
    setResolutions({})
    setError(null)
  }, [activeDraftId, designId])

  const run = async (label: string, action: () => Promise<void>) => {
    setWorking(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : label)
    } finally {
      setWorking(false)
    }
  }

  const create = () =>
    run('Could not create branch', async () => {
      const branchName = name.trim()
      if (!branchName) return
      await controller.flush()
      const created = await orpc.draft.create({
        id: `dr${crypto.randomUUID().replaceAll('-', '')}`,
        designId,
        name: branchName,
        description: description.trim(),
        empty,
      })
      onBranchesChange([created, ...branches])
      setCreateOpen(false)
      setName('')
      setDescription('')
      setEmpty(false)
      await onSwitch(created.id)
    })

  const review = (branch: CanvasBranchSummary) =>
    run('Could not compare branch', async () => {
      await controller.flush()
      const next = await orpc.draft.compare({ designId, id: branch.id })
      if (next.canvasVersion !== 2 || !next.draftDocument) {
        throw new Error('This branch uses an unsupported legacy format.')
      }
      setComparison(next)
      setResolutions({})
      setSide('draft')
      setReviewOpen(true)
    })

  const apply = () =>
    run('Could not apply branch', async () => {
      if (!comparison) return
      const result = await orpc.draft.apply({
        designId,
        id: comparison.draft.id,
        expectedMainRevision: comparison.mainRevision,
        expectedDraftRevision: comparison.draft.revision,
        resolutions,
      })
      if (!result.applied) {
        setComparison({
          ...comparison,
          conflicts: result.conflicts,
          unresolved: result.unresolved,
        })
        return
      }
      await refresh()
      setReviewOpen(false)
      if (comparison.draft.id === activeDraftId) await onSwitch(null)
    })

  const setStatus = (
    branch: CanvasBranchSummary,
    action: 'propose' | 'reopen' | 'close',
  ) =>
    run('Could not update branch', async () => {
      await controller.flush()
      if (action === 'propose') {
        await orpc.draft.propose({
          designId,
          id: branch.id,
          description: branch.description,
        })
      } else if (action === 'reopen') {
        await orpc.draft.reopen({ designId, id: branch.id })
      } else {
        await orpc.draft.close({ designId, id: branch.id })
      }
      await refresh()
      setConfirmId(null)
      if (action === 'close' && branch.id === activeDraftId) await onSwitch(null)
    })

  const rename = (branch: CanvasBranchSummary) =>
    run('Could not rename branch', async () => {
      const next = renameValue.trim()
      setRenamingId(null)
      if (!next || next === branch.name) return
      await orpc.draft.rename({ designId, id: branch.id, name: next })
      await refresh()
    })

  const conflicts = (comparison?.conflicts ?? []).filter(
    (conflict): conflict is BranchCanvasConflict =>
      'scope' in conflict && 'main' in conflict && 'draft' in conflict,
  )
  const unresolved = conflicts.filter((conflict) => !resolutions[conflict.id])
  const mainDocument = (comparison?.mainDocument ?? null) as CanvasDocument | null
  const draftDocument = (comparison?.draftDocument ?? null) as CanvasDocument | null
  const baseDocument = (comparison?.baseDocument ?? null) as CanvasDocument | null
  // What Main did while the branch was open — the reason a merge can conflict
  // at all, and the one number the old review never showed.
  const mainDrift = useMemo(
    () => (baseDocument && mainDocument ? diffDocuments(baseDocument, mainDocument) : null),
    [baseDocument, mainDocument],
  )

  const resolveAll = (choice: 'main' | 'draft') =>
    setResolutions((current) => {
      const next = { ...current }
      for (const conflict of conflicts) next[conflict.id] = choice
      return next
    })

  const branchRow = (branch: CanvasBranchSummary) => {
    const ahead = branch.revision - branch.baseRevision
    return (
      <li key={branch.id} className="flex items-start gap-2 px-3 py-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 size-1.5 shrink-0 rounded-full',
            branch.status === 'active'
              ? 'bg-cx-accent'
              : branch.status === 'proposed'
                ? 'bg-amber-500'
                : 'bg-border',
          )}
        />
        <div className="min-w-0 flex-1">
          {renamingId === branch.id ? (
            <Input
              autoFocus
              size="sm"
              aria-label="Branch name"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={() => void rename(branch)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void rename(branch)
                if (event.key === 'Escape') setRenamingId(null)
              }}
            />
          ) : (
            <p className="flex items-center gap-2 text-xs font-medium">
              <span className="min-w-0 truncate">{branch.name}</span>
              {branch.id === activeDraftId ? (
                <span className="shrink-0 rounded bg-secondary px-1 text-[11px] font-normal">
                  Open
                </span>
              ) : null}
              {branch.status !== 'active' ? (
                <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                  {STATUS_LABEL[branch.status]}
                </span>
              ) : null}
            </p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {ahead > 0 ? `${ahead} revision${ahead === 1 ? '' : 's'} ahead · ` : ''}
            {branch.status === 'applied' && branch.appliedAt
              ? `applied ${relativeTime(branch.appliedAt)}`
              : branch.status === 'closed' && branch.closedAt
                ? `discarded ${relativeTime(branch.closedAt)}`
                : `updated ${relativeTime(branch.updatedAt)}`}
          </p>
          {branch.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">
              {branch.description}
            </p>
          ) : null}
          {confirmId === branch.id ? (
            <div className="mt-2 flex items-center gap-2">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                Discard it? You can restore it from Archived.
              </p>
              <Button size="xs" variant="ghost" onClick={() => setConfirmId(null)}>
                Cancel
              </Button>
              <Button
                size="xs"
                variant="destructive"
                disabled={working}
                onClick={() => void setStatus(branch, 'close')}
              >
                Discard
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isOpen(branch) ? (
            <>
              {branch.id === activeDraftId ? null : (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={working}
                  onClick={() => void onSwitch(branch.id)}
                >
                  Open
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                disabled={working}
                onClick={() => void review(branch)}
              >
                <GitMergeIcon />
                Review
              </Button>
            </>
          ) : branch.status === 'closed' ? (
            <Button
              size="xs"
              variant="outline"
              disabled={working}
              onClick={() => void setStatus(branch, 'reopen')}
            >
              <RotateCcwIcon />
              Restore
            </Button>
          ) : null}
          {isOpen(branch) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`More for ${branch.name}`}
                >
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => {
                    setRenameValue(branch.name)
                    // The menu restores focus to its trigger as it closes; the
                    // field has to appear after that or it blurs on arrival.
                    window.setTimeout(() => setRenamingId(branch.id), 0)
                  }}
                >
                  <PencilIcon data-slot="icon" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void setStatus(
                      branch,
                      branch.status === 'active' ? 'propose' : 'reopen',
                    )
                  }
                >
                  {branch.status === 'active' ? (
                    <SendIcon data-slot="icon" />
                  ) : (
                    <RotateCcwIcon data-slot="icon" />
                  )}
                  {branch.status === 'active' ? 'Mark as proposed' : 'Back to active'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmId(branch.id)}
                >
                  <Trash2Icon data-slot="icon" />
                  Discard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            variant="ghost"
            className="pointer-events-auto max-w-44 font-normal text-muted-foreground"
            aria-label="Branch"
            disabled={working}
          >
            <GitBranchIcon />
            <span className="truncate">{active?.name ?? 'Main'}</span>
            <ChevronDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="pointer-events-auto w-60">
          <DropdownMenuItem onClick={() => void onSwitch(null)}>
            <span className="min-w-0 flex-1 truncate">Main</span>
            {!activeDraftId ? <CheckIcon className="size-3.5" /> : null}
          </DropdownMenuItem>
          {openBranches.map((branch) => (
            <DropdownMenuItem key={branch.id} onClick={() => void onSwitch(branch.id)}>
              <span className="min-w-0 flex-1 truncate">
                {branch.name}
                {branch.status === 'proposed' ? ' · proposed' : ''}
              </span>
              {branch.id === activeDraftId ? <CheckIcon className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <PlusIcon data-slot="icon" />
            New branch
          </DropdownMenuItem>
          {active ? (
            <DropdownMenuItem onClick={() => void review(active)}>
              <GitMergeIcon data-slot="icon" />
              Review changes
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setManageOpen(true)}>
            <ListTreeIcon data-slot="icon" />
            Manage branches
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogPopup className="max-w-2xl p-0" bottomStickOnMobile={false}>
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>Branches</DialogTitle>
            <DialogDescription>
              A branch is a private copy of this design. Applying one merges it
              into Main field by field; only edits to the same field need a
              decision.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(64svh,32rem)] min-h-0 overflow-y-auto">
            <ul className="divide-y">
              <li className="flex items-center gap-2 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-foreground"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">Main</p>
                  <p className="text-xs text-muted-foreground">
                    The published, shared document.
                  </p>
                </div>
                {activeDraftId ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={working}
                    onClick={() => void onSwitch(null)}
                  >
                    Open
                  </Button>
                ) : (
                  <span className="rounded bg-secondary px-1 text-[11px]">Open</span>
                )}
              </li>
              {openBranches.map(branchRow)}
            </ul>
            {archived.length > 0 ? (
              <>
                <p className="border-t px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Archived
                </p>
                <ul className="divide-y border-t">{archived.map(branchRow)}</ul>
              </>
            ) : null}
            {branches.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                No branches yet. Main is the only target.
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="border-t px-4 py-2 text-xs text-destructive-foreground">
              {error}
            </p>
          ) : null}
          <DialogFooter className="border-t">
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setManageOpen(false)
                setCreateOpen(true)
              }}
            >
              <PlusIcon />
              New branch
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              You are branched from Main as it is right now. Main can keep
              moving; the two are merged when you apply.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Input
              autoFocus
              aria-label="Branch name"
              value={name}
              placeholder="Branch name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void create()}
            />
            <Textarea
              aria-label="What this branch is for"
              value={description}
              placeholder="What is this branch for? (optional)"
              className="min-h-16 text-sm"
              onChange={(event) => setDescription(event.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={empty}
                onChange={(event) => setEmpty(event.target.checked)}
              />
              Start with an empty canvas
            </label>
            {error ? (
              <p className="text-xs text-destructive-foreground">{error}</p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={working || !name.trim()} onClick={() => void create()}>
              {working ? <Spinner /> : null}
              Create branch
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogPopup className="max-w-5xl p-0" bottomStickOnMobile={false}>
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>
              Apply {comparison?.draft.name ?? active?.name} to Main
            </DialogTitle>
            <DialogDescription>
              Nodes and properties merge independently. Only edits to the same
              field on both sides need a decision.
            </DialogDescription>
          </DialogHeader>

          <div className="grid h-[min(76svh,40rem)] grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col overflow-y-auto border-e">
              <div className="space-y-2 border-b p-3">
                <div className="rounded-lg border p-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    This branch, since it started
                  </p>
                  <p className="mt-0.5 text-sm">
                    {comparison ? countLabel(comparison.summary) : '—'}
                  </p>
                </div>
                <div className="rounded-lg border p-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Main, since you branched
                  </p>
                  <p className="mt-0.5 text-sm">
                    {mainDrift ? countLabel(mainDrift) : '—'}
                  </p>
                </div>
              </div>

              <div className="min-h-0 flex-1 p-3">
                {conflicts.length === 0 ? (
                  <p className="rounded-lg bg-secondary p-3 text-xs">
                    Nothing collides. This branch applies cleanly.
                  </p>
                ) : (
                  <>
                    <div className="mb-2 flex items-center gap-1">
                      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                        {unresolved.length === 0
                          ? `${conflicts.length} resolved`
                          : `${unresolved.length} of ${conflicts.length} need a choice`}
                      </p>
                      <Button size="xs" variant="ghost" onClick={() => resolveAll('main')}>
                        All Main
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => resolveAll('draft')}>
                        All branch
                      </Button>
                    </div>
                    <ul className="space-y-2">
                      {conflicts.map((conflict) => {
                        const title = conflictTitle(conflict, mainDocument, draftDocument)
                        return (
                        <li key={conflict.id} className="rounded-lg border p-2.5">
                          <p className="truncate text-xs font-medium">{title}</p>
                          <div className="mt-2 space-y-1">
                            <button
                              type="button"
                              aria-label={`Keep Main for ${title}`}
                              aria-pressed={resolutions[conflict.id] === 'main'}
                              className={cn(
                                'block w-full rounded-md border px-2 py-1.5 text-left text-xs',
                                resolutions[conflict.id] === 'main'
                                  ? 'border-cx-accent bg-secondary'
                                  : 'hover:bg-secondary/60',
                              )}
                              onClick={() =>
                                setResolutions((current) => ({
                                  ...current,
                                  [conflict.id]: 'main',
                                }))
                              }
                            >
                              <span className="block text-[11px] text-muted-foreground">
                                Main
                              </span>
                              <span className="block truncate font-mono">
                                {formatValue(conflict.main)}
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Use this branch for ${title}`}
                              aria-pressed={resolutions[conflict.id] === 'draft'}
                              className={cn(
                                'block w-full rounded-md border px-2 py-1.5 text-left text-xs',
                                resolutions[conflict.id] === 'draft'
                                  ? 'border-cx-accent bg-secondary'
                                  : 'hover:bg-secondary/60',
                              )}
                              onClick={() =>
                                setResolutions((current) => ({
                                  ...current,
                                  [conflict.id]: 'draft',
                                }))
                              }
                            >
                              <span className="block text-[11px] text-muted-foreground">
                                This branch
                              </span>
                              <span className="block truncate font-mono">
                                {formatValue(conflict.draft)}
                              </span>
                            </button>
                          </div>
                        </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
                <Button
                  size="xs"
                  variant={side === 'draft' ? 'secondary' : 'ghost'}
                  onClick={() => setSide('draft')}
                >
                  This branch
                </Button>
                <Button
                  size="xs"
                  variant={side === 'main' ? 'secondary' : 'ghost'}
                  onClick={() => setSide('main')}
                >
                  Main
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-cx-canvas">
                <CanvasDocumentPreview
                  document={side === 'draft' ? draftDocument : mainDocument}
                />
              </div>
              <div className="shrink-0 space-y-2 border-t p-3">
                {error ? (
                  <p className="text-xs text-destructive-foreground">{error}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Applying writes the merged document to Main and checkpoints
                    it first. The branch is marked applied.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setReviewOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={working || unresolved.length > 0}
                    onClick={() => void apply()}
                  >
                    {working ? <Spinner /> : <GitMergeIcon />}
                    {unresolved.length > 0
                      ? `${unresolved.length} to resolve`
                      : 'Apply to Main'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </>
  )
}
