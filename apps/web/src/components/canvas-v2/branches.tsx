import { useEffect, useMemo, useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitMergeIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
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
import type { CanvasSyncController } from '#/lib/canvas-v2-client'

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

interface CanvasV2BranchesProps {
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

function conflictLabel(conflict: BranchCanvasConflict) {
  const target =
    conflict.scope === 'document'
      ? 'Document'
      : conflict.scope === 'token'
        ? `Token ${conflict.targetId}`
        : `Node ${conflict.targetId}`
  return `${target} · ${conflict.path || 'deleted'}`
}

export function CanvasV2Branches({
  designId,
  activeDraftId,
  controller,
  branches,
  onBranchesChange,
  onSwitch,
}: CanvasV2BranchesProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [name, setName] = useState('')
  const [empty, setEmpty] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<
    Awaited<ReturnType<typeof orpc.draft.compare>> | null
  >(null)
  const [resolutions, setResolutions] = useState<Record<string, 'main' | 'draft'>>({})

  const active = branches.find((branch) => branch.id === activeDraftId) ?? null
  const openBranches = useMemo(
    () =>
      branches.filter(
        (branch) => branch.status === 'active' || branch.status === 'proposed',
      ),
    [branches],
  )

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

  const create = async () => {
    const branchName = name.trim()
    if (!branchName) return
    setWorking(true)
    setError(null)
    try {
      await controller.flush()
      const created = await orpc.draft.create({
        id: `dr${crypto.randomUUID().replaceAll('-', '')}`,
        designId,
        name: branchName,
        empty,
      })
      onBranchesChange([created, ...branches])
      setCreateOpen(false)
      setName('')
      setEmpty(false)
      await onSwitch(created.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create branch')
    } finally {
      setWorking(false)
    }
  }

  const review = async () => {
    if (!active) return
    setWorking(true)
    setError(null)
    try {
      await controller.flush()
      const next = await orpc.draft.compare({ designId, id: active.id })
      if (next.canvasVersion !== 2 || !next.draftDocument) {
        throw new Error('This branch must finish Canvas V2 migration before review.')
      }
      setComparison(next)
      setResolutions({})
      setReviewOpen(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not compare branch')
    } finally {
      setWorking(false)
    }
  }

  const apply = async () => {
    if (!comparison) return
    setWorking(true)
    setError(null)
    try {
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
      await onSwitch(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply branch')
    } finally {
      setWorking(false)
    }
  }

  const updateStatus = async (action: 'propose' | 'reopen' | 'close') => {
    if (!active) return
    setWorking(true)
    setError(null)
    try {
      await controller.flush()
      if (action === 'propose') {
        await orpc.draft.propose({
          designId,
          id: active.id,
          description: active.description,
        })
      } else if (action === 'reopen') {
        await orpc.draft.reopen({ designId, id: active.id })
      } else {
        await orpc.draft.close({ designId, id: active.id })
      }
      const next = await refresh()
      if (action === 'close' || !next.some((branch) => branch.id === active.id)) {
        await onSwitch(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update branch')
    } finally {
      setWorking(false)
    }
  }

  const conflicts = (comparison?.conflicts ?? []).filter(
    (conflict): conflict is BranchCanvasConflict =>
      'scope' in conflict && 'main' in conflict && 'draft' in conflict,
  )
  const unresolved = conflicts.filter((conflict) => !resolutions[conflict.id])

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
            <span className="truncate">
              {active?.name ?? 'Main'}
            </span>
            <ChevronDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="pointer-events-auto w-60">
          <DropdownMenuItem onClick={() => void onSwitch(null)}>
            <span className="min-w-0 flex-1 truncate">Main</span>
            {!activeDraftId ? <CheckIcon className="size-3.5" /> : null}
          </DropdownMenuItem>
          {openBranches.map((branch) => (
            <DropdownMenuItem
              key={branch.id}
              onClick={() => void onSwitch(branch.id)}
            >
              <span className="min-w-0 flex-1 truncate">
                {branch.name}
                {branch.status === 'proposed' ? ' · proposed' : ''}
              </span>
              {branch.id === activeDraftId ? (
                <CheckIcon className="size-3.5" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <PlusIcon data-slot="icon" />
            New branch
          </DropdownMenuItem>
          {active ? (
            <>
              <DropdownMenuItem onClick={() => void review()}>
                <GitMergeIcon data-slot="icon" />
                Review changes
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void updateStatus(
                    active.status === 'active' ? 'propose' : 'reopen',
                  )
                }
              >
                <RotateCcwIcon data-slot="icon" />
                {active.status === 'active'
                  ? 'Propose changes'
                  : 'Reopen branch'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void updateStatus('close')}
              >
                <Trash2Icon data-slot="icon" />
                Discard branch
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="fixed left-1/2 top-14 z-50 -translate-x-1/2 rounded-md border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive shadow-lg">
          {error}
        </p>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              Branch state lives in Loora’s app layer. The canvas package only receives a target
              document.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Input
              autoFocus
              value={name}
              placeholder="Branch name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void create()}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={empty}
                onChange={(event) => setEmpty(event.target.checked)}
              />
              Start with an empty canvas
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={working || !name.trim()} onClick={() => void create()}>
              Create branch
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogPopup className="h-[min(82svh,48rem)] max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review {comparison?.draft.name ?? active?.name}</DialogTitle>
            <DialogDescription>
              Node properties merge independently. Only edits to the same field need a choice.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="min-h-0 flex-1 overflow-y-auto">
            {comparison ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(comparison.summary).map(([label, count]) => (
                    <div key={label} className="rounded-lg border p-3 text-center">
                      <p className="text-xl font-semibold">{count}</p>
                      <p className="text-xs capitalize text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                {conflicts.length === 0 ? (
                  <p className="rounded-lg bg-secondary p-3 text-sm">
                    This branch can be applied automatically.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {conflicts.map((conflict) => (
                      <li key={conflict.id} className="rounded-lg border p-3">
                        <p className="text-sm font-medium">{conflictLabel(conflict)}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          Main: {JSON.stringify(conflict.main)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Branch: {JSON.stringify(conflict.draft)}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="xs"
                            variant={resolutions[conflict.id] === 'main' ? 'secondary' : 'outline'}
                            onClick={() =>
                              setResolutions((current) => ({
                                ...current,
                                [conflict.id]: 'main',
                              }))
                            }
                          >
                            Keep Main
                          </Button>
                          <Button
                            size="xs"
                            variant={resolutions[conflict.id] === 'draft' ? 'secondary' : 'outline'}
                            onClick={() =>
                              setResolutions((current) => ({
                                ...current,
                                [conflict.id]: 'draft',
                              }))
                            }
                          >
                            Use branch
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button
              disabled={working || unresolved.length > 0}
              onClick={() => void apply()}
            >
              Apply to Main
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
