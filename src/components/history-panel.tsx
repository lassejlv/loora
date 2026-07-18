import { lazy, Suspense, useState } from 'react'
import { HistoryIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import type { Shape } from '#/lib/canvas'
import { loadHistory, relativeTime, type Commit } from '#/lib/history'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
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

export function HistoryPopover({
  docId,
  shapesRef,
  onRestore,
}: {
  docId: string
  shapesRef: React.RefObject<Shape[]>
  onRestore: (shapes: Shape[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Commit[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [viewing, setViewing] = useState<Commit | null>(null)

  const viewingIndex = viewing ? history.findIndex((commit) => commit.id === viewing.id) : -1
  const previous = viewingIndex >= 0 ? history[viewingIndex + 1] : undefined

  const loadVersions = async () => {
    try {
      let versions = await orpc.history.list({ designId: docId })

      if (versions.length === 0) {
        const local = [...loadHistory(docId)].reverse()
        for (const commit of local) {
          await orpc.history.commit({
            id: commit.id,
            designId: docId,
            message: commit.message,
            shapes: commit.shapes,
          })
        }
        if (local.length > 0) versions = await orpc.history.list({ designId: docId })
      }

      setHistory(versions)
    } catch (error) {
      console.error('[history] Failed to load versions:', error)
      setHistory(loadHistory(docId))
    }
  }

  return (
    <>
      <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void loadVersions()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Version history"
            title="Version history"
          >
            <HistoryIcon data-slot="icon" />
          </Button>
        }
      />
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const msg = message.trim()
            if (!msg) return
            setSaving(true)
            try {
              const commit = await orpc.history.commit({
                id: `c${nanoid()}`,
                designId: docId,
                message: msg,
                shapes: shapesRef.current,
              })
              if (commit) setHistory((current) => [commit, ...current])
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
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!message.trim() || saving}>
            {saving ? 'Saving…' : 'Commit'}
          </Button>
        </form>

        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No versions yet. Commit to save a restorable snapshot of this document.
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {history.map((c) => (
              <li key={c.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{c.message}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {relativeTime(c.at)}
                    {c.added > 0 && <span className="text-success"> +{c.added}</span>}
                    {c.removed > 0 && <span className="text-destructive-foreground"> −{c.removed}</span>}
                    {c.changed > 0 && <span> ~{c.changed}</span>}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setViewing(c)
                    setOpen(false)
                  }}
                >
                  View changes
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
      </Popover>

      <Dialog open={viewing !== null} onOpenChange={(next) => !next && setViewing(null)}>
        <DialogPopup className="h-[min(85svh,56rem)] max-w-5xl overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{viewing?.message ?? 'Version changes'}</DialogTitle>
            <DialogDescription>
              {previous ? `Compared with “${previous.message}”.` : 'Compared with an empty canvas.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 border-y">
            {viewing && (
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">
                    Loading changes…
                  </div>
                }
              >
                <DesignDiff
                  oldShapes={previous?.shapes ?? []}
                  newShapes={viewing.shapes}
                  oldKey={previous?.id ?? `${viewing.id}:empty`}
                  newKey={viewing.id}
                />
              </Suspense>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
            <Button
              onClick={() => {
                if (!viewing) return
                onRestore(viewing.shapes)
                setViewing(null)
              }}
            >
              Restore this version
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
