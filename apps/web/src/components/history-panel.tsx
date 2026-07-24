import { lazy, Suspense, useEffect, useState } from 'react'
import { HistoryIcon } from '#/components/icons'
import { nanoid } from 'nanoid'
import type { CanvasElement } from '#/lib/canvas'
import { loadHistory, relativeTime, type Commit, type CommitSummary } from '@loora/rpc/history'
import { PanelEmpty, PanelShell } from '#/components/panel-shell'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Drawer, DrawerPopup } from '#/components/ui/drawer'
import { orpc } from '#/lib/orpc-client'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'

const DesignDiff = lazy(() =>
  import('#/components/design-diff').then((module) => ({ default: module.DesignDiff })),
)

type ComparisonVersion = Pick<Commit, 'id' | 'message' | 'shapes' | 'at'>

export function HistoryPopover({
  docId,
  draftId,
  storageId,
  readOnly = false,
  open,
  onOpenChange,
  shapesRef,
  onRestore,
}: {
  docId: string
  draftId?: string | null
  storageId?: string
  readOnly?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  shapesRef: React.RefObject<CanvasElement[]>
  onRestore: (elements: CanvasElement[]) => void
}) {
  const localHistoryId = storageId ?? docId
  const [history, setHistory] = useState<CommitSummary[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [cursor, setCursor] = useState<{ at: number; id: string } | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [localVersions, setLocalVersions] = useState<Commit[] | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [comparison, setComparison] = useState<{
    current: ComparisonVersion
    previous: ComparisonVersion | null
  } | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)

  const viewingSummary = viewingId ? history.find((commit) => commit.id === viewingId) : null

  const loadVersions = async (append = false) => {
    if (historyLoading) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      let page = await orpc.history.list({
        designId: docId,
        draftId,
        limit: 20,
        cursor: append ? cursor ?? undefined : undefined,
      })

      if (!append && page.items.length === 0) {
        const local = [...loadHistory(localHistoryId)].reverse()
        if (local.length > 0) {
          await orpc.history.import({ designId: docId, draftId, commits: local })
          page = await orpc.history.list({ designId: docId, draftId, limit: 20 })
        }
      }

      setLocalVersions(null)
      setHistory((current) => (append ? [...current, ...page.items] : page.items))
      setCursor(page.nextCursor)
    } catch (error) {
      console.error('[history] Failed to load versions:', error)
      if (!append) {
        const local = loadHistory(localHistoryId)
        setLocalVersions(local)
        setHistory(local.map(({ shapes: _shapes, ...summary }) => summary))
        setCursor(null)
      }
      setHistoryError('Could not load saved versions.')
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (open) void loadVersions(false)
    // Reload when the drawer opens or the document changes while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docId, draftId, localHistoryId])

  const openDrawer = (next: boolean) => {
    onOpenChange(next)
  }

  const openVersion = async (id: string) => {
    setViewingId(id)
    setComparison(null)
    setViewError(null)
    onOpenChange(false)

    if (localVersions) {
      const index = localVersions.findIndex((commit) => commit.id === id)
      const current = localVersions[index]
      if (current) setComparison({ current, previous: localVersions[index + 1] ?? null })
      else setViewError('This local version is no longer available.')
      return
    }

    try {
      setComparison(await orpc.history.compare({ designId: docId, draftId, id }))
    } catch (error) {
      console.error('[history] Failed to load comparison:', error)
      setViewError('Could not load this version.')
    }
  }

  return (
    <>
      <Button
        variant={open ? 'secondary' : 'ghost'}
        size="icon"
        aria-label="Version history"
        title="Version history"
        aria-pressed={open}
        onClick={() => openDrawer(!open)}
      >
        <HistoryIcon data-slot="icon" />
      </Button>

      <Drawer open={open} onOpenChange={openDrawer} position="bottom">
        <DrawerPopup
          position="bottom"
          variant="inset"
          className="mx-auto h-[min(60svh,32rem)] w-full max-w-lg overflow-hidden rounded-2xl border"
        >
          <PanelShell
            title="History"
            description="Commit and restore versions of this document."
            onClose={() => openDrawer(false)}
            bodyClassName="gap-3 p-3"
          >
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                const msg = message.trim()
                if (!msg || readOnly) return
                setSaving(true)
                try {
                  const commit = await orpc.history.commit({
                    id: `c${nanoid()}`,
                    designId: docId,
                    draftId,
                    message: msg,
                    shapes: shapesRef.current,
                  })
                  if (commit) {
                    setLocalVersions(null)
                    setHistory((current) => [commit, ...current])
                  }
                  setMessage('')
                } catch (error) {
                  console.error('[history] Failed to commit version:', error)
                } finally {
                  setSaving(false)
                }
              }}
            >
              <Input
                size="sm"
                placeholder="Describe this version…"
                value={message}
                disabled={readOnly}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={readOnly || !message.trim() || saving}>
                {saving ? 'Saving…' : 'Commit'}
              </Button>
            </form>

            {historyLoading && history.length === 0 ? (
              <p className="cx-shimmer px-1 text-xs">Loading versions…</p>
            ) : history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-black/15 px-3 py-2">
                <PanelEmpty
                  className="py-6"
                  title="No versions yet"
                  description="Commit to save a restorable snapshot of this document."
                />
              </div>
            ) : (
              <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                {history.map((c) => (
                  <li
                    key={c.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{c.message}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {relativeTime(c.at)}
                        {c.added > 0 && <span className="text-success"> +{c.added}</span>}
                        {c.removed > 0 && (
                          <span className="text-destructive-foreground"> −{c.removed}</span>
                        )}
                        {c.changed > 0 && <span> ~{c.changed}</span>}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void openVersion(c.id)}>
                      View changes
                    </Button>
                  </li>
                ))}
                {cursor ? (
                  <li className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={historyLoading}
                      onClick={() => void loadVersions(true)}
                    >
                      {historyLoading ? 'Loading…' : 'Load older'}
                    </Button>
                  </li>
                ) : null}
              </ul>
            )}
            {historyError ? (
              <p className="text-xs text-destructive-foreground">{historyError}</p>
            ) : null}
          </PanelShell>
        </DrawerPopup>
      </Drawer>

      <Dialog
        open={viewingId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setViewingId(null)
            setComparison(null)
            setViewError(null)
          }
        }}
      >
        <DialogPopup className="h-[min(85svh,56rem)] max-w-5xl overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {comparison?.current.message ?? viewingSummary?.message ?? 'Version changes'}
            </DialogTitle>
            <DialogDescription>
              {comparison?.previous
                ? `Compared with “${comparison.previous.message}”.`
                : 'Compared with an empty canvas.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 border-y">
            {viewError ? (
              <div className="grid h-full place-items-center text-sm text-destructive-foreground">
                {viewError}
              </div>
            ) : comparison ? (
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">
                    Loading changes…
                  </div>
                }
              >
                <DesignDiff
                  oldShapes={comparison.previous?.shapes ?? []}
                  newShapes={comparison.current.shapes}
                  oldKey={comparison.previous?.id ?? `${comparison.current.id}:empty`}
                  newKey={comparison.current.id}
                />
              </Suspense>
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                Loading changes…
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
            <Button
              onClick={() => {
                if (!comparison) return
                onRestore(comparison.current.shapes)
                setViewingId(null)
                setComparison(null)
              }}
              disabled={!comparison || readOnly}
            >
              Restore this version
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
