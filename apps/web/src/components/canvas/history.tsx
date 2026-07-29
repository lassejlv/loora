import { useEffect, useMemo, useState } from 'react'
import { HistoryIcon, RotateCcwIcon } from '#/components/icons'
import type { CanvasDocument } from '@loora/canvas/model'
import { diffDocuments } from '@loora/canvas/merge'
import { useCanvasDocument } from '@loora/canvas/react'
import { orpc } from '#/lib/orpc-client'
import { CanvasDocumentPreview } from '#/components/canvas-preview'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { relativeTime } from '#/lib/designs'
import { cn } from '#/lib/utils'
import type { CanvasEditorController } from './editor'

type VersionPage = Awaited<ReturnType<typeof orpc.history.list>>
type Version = VersionPage['items'][number]

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
})
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

/** Checkpoints read as a timeline, so they are grouped the way one is read. */
function groupByDay(versions: Version[]) {
  const groups: { day: string; items: Version[] }[] = []
  for (const version of versions) {
    const day = dayFormatter.format(new Date(version.at))
    const last = groups.at(-1)
    if (last?.day === day) last.items.push(version)
    else groups.push({ day, items: [version] })
  }
  return groups
}

export function CanvasHistory({
  controller,
  readOnly,
  iconOnly = false,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  controller: CanvasEditorController
  readOnly: boolean
  iconOnly?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
}) {
  const document = useCanvasDocument()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [versions, setVersions] = useState<Version[]>([])
  const [cursor, setCursor] = useState<VersionPage['nextCursor']>(null)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    id: string
    document: CanvasDocument
  } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async (next?: VersionPage['nextCursor']) => {
    if (!controller.target) return
    setLoading(true)
    try {
      const page = await orpc.history.list({
        designId: controller.target.designId,
        draftId: controller.target.draftId,
        limit: 20,
        ...(next ? { cursor: next } : {}),
      })
      setVersions((current) => (next ? [...current, ...page.items] : page.items))
      setCursor(page.nextCursor)
      if (!next) setSelectedId(page.items[0]?.id ?? null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not load history'),
    )
  }, [open])

  // The selected checkpoint's document drives both the preview and the diff.
  useEffect(() => {
    if (!open || !selectedId || !controller.target) return
    const version = versions.find((item) => item.id === selectedId)
    if (!version || version.canvasVersion !== 2) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    void orpc.history
      .compareCanvas({
        designId: controller.target.designId,
        draftId: controller.target.draftId,
        id: selectedId,
      })
      .then((result) => {
        if (cancelled) return
        setPreview({
          id: selectedId,
          document: result.current.document as CanvasDocument,
        })
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedId, versions.length])

  /** What restoring this checkpoint would do to the document on screen. */
  const drift = useMemo(
    () =>
      preview?.document ? diffDocuments(document, preview.document) : null,
    [document, preview],
  )

  const checkpoint = async (label: string, refresh = true) => {
    if (!controller.target) return
    await controller.flush?.()
    await orpc.history.commitCanvas({
      id: `v${crypto.randomUUID().replaceAll('-', '')}`,
      designId: controller.target.designId,
      draftId: controller.target.draftId,
      message: label,
      document,
      skipIfUnchanged: true,
    })
    if (refresh) await load()
  }

  const commit = async () => {
    setWorking(true)
    setError(null)
    try {
      await checkpoint(message.trim() || 'Manual checkpoint')
      setMessage('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create checkpoint')
    } finally {
      setWorking(false)
    }
  }

  const restore = async (version: Version) => {
    if (
      !controller.target ||
      controller.revision === undefined ||
      !controller.adoptSnapshot
    ) {
      return
    }
    if (version.canvasVersion !== 2) {
      setError('This checkpoint uses an unsupported legacy format.')
      return
    }
    setWorking(true)
    setProgress(null)
    setError(null)
    try {
      await controller.flush?.()
      // The current state is checkpointed first, so a restore is never the end
      // of the work it replaced.
      setProgress('Saving the current state')
      await checkpoint('Before restore', false)
      setProgress('Restoring checkpoint')
      const result = await orpc.history.restoreCanvas({
        designId: controller.target.designId,
        draftId: controller.target.draftId,
        id: version.id,
        expectedRevision: controller.revision,
      })
      await controller.adoptSnapshot(
        result.document as CanvasDocument,
        result.revision,
      )
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore version')
    } finally {
      setWorking(false)
      setProgress(null)
    }
  }

  const selected = versions.find((version) => version.id === selectedId) ?? null
  const groups = useMemo(() => groupByDay(versions), [versions])

  if (!controller.target) return null
  return (
    <>
      {showTrigger ? (
        <Button
          size={iconOnly ? 'icon-sm' : 'xs'}
          variant="ghost"
          aria-label={iconOnly ? 'History' : undefined}
          title="Version history"
          onClick={() => setOpen(true)}
        >
          <HistoryIcon />
          {iconOnly ? null : 'History'}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-3xl p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Every checkpoint is a whole document. Restoring one saves the
              current state first.
            </DialogDescription>
          </DialogHeader>

          <div className="grid h-[min(64svh,32rem)] grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-e">
              <div className="flex shrink-0 items-center gap-1 border-b p-2">
                <Input
                  size="sm"
                  aria-label="Checkpoint name"
                  placeholder="Name this checkpoint"
                  value={message}
                  disabled={readOnly}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !working) void commit()
                  }}
                />
                <Button
                  size="sm"
                  disabled={working || readOnly}
                  onClick={() => void commit()}
                >
                  Save
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {versions.length === 0 && !loading ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No checkpoints yet.
                  </p>
                ) : null}
                {groups.map((group) => (
                  <section key={group.day}>
                    <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {group.day}
                    </p>
                    {group.items.map((version) => (
                      <button
                        key={version.id}
                        type="button"
                        aria-pressed={version.id === selectedId}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                          version.id === selectedId
                            ? 'bg-secondary'
                            : 'hover:bg-secondary/60',
                        )}
                        onClick={() => setSelectedId(version.id)}
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {version.message}
                          </span>
                          {version.canvasVersion !== 2 ? (
                            <span className="shrink-0 rounded bg-background px-1 text-[11px] text-muted-foreground">
                              Legacy
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="text-xs text-muted-foreground"
                          title={new Date(version.at).toLocaleString()}
                        >
                          {timeFormatter.format(new Date(version.at))} ·{' '}
                          {relativeTime(version.at)}
                        </span>
                        <span className="text-[11px] text-muted-foreground/70">
                          +{version.added} −{version.removed} · {version.changed} changed
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
                {cursor ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="mt-1 w-full"
                    disabled={loading}
                    onClick={() => void load(cursor)}
                  >
                    {loading ? <Spinner /> : null}
                    Load older
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden border-b bg-cx-canvas">
                {selected && selected.canvasVersion !== 2 ? (
                  <div className="grid size-full place-items-center px-8 text-center">
                    <p className="text-xs text-muted-foreground">
                      This checkpoint uses an unsupported legacy format.
                    </p>
                  </div>
                ) : previewing && preview?.id !== selectedId ? (
                  <div className="grid size-full place-items-center">
                    <Spinner />
                  </div>
                ) : preview?.id === selectedId ? (
                  <CanvasDocumentPreview document={preview.document} />
                ) : (
                  <div className="grid size-full place-items-center px-8 text-center">
                    <p className="text-xs text-muted-foreground">
                      {selected ? 'No preview for this checkpoint.' : 'Select a checkpoint.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="shrink-0 space-y-2 p-3">
                {error ? (
                  <p className="text-xs text-destructive-foreground">{error}</p>
                ) : null}
                {progress ? (
                  <p className="text-xs text-muted-foreground">{progress}</p>
                ) : null}
                {selected ? (
                  <>
                    <p className="text-sm font-medium">{selected.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {drift
                        ? drift.added + drift.removed + drift.changed === 0
                          ? 'Identical to the document on screen.'
                          : `Restoring changes ${drift.added} added, ${drift.removed} removed, ${drift.changed} edited against what is on screen.`
                        : 'Saved ' + relativeTime(selected.at) + '.'}
                    </p>
                  </>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                  <Button
                    disabled={
                      !selected ||
                      selected.canvasVersion !== 2 ||
                      working ||
                      readOnly
                    }
                    onClick={() => selected && void restore(selected)}
                  >
                    {working ? <Spinner /> : <RotateCcwIcon />}
                    Restore
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
