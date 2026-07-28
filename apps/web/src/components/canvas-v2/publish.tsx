import { useEffect, useMemo, useState } from 'react'
import { UnlinkIcon } from 'lucide-react'
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Globe2Icon,
  RefreshCwIcon,
} from '#/components/icons'
import type { CanvasDocumentV2, PageNode } from '@loora/canvas/model'
import { useCanvasDocument, useCanvasSelection } from '@loora/canvas/react'
import type { CanvasSyncTarget } from '#/lib/canvas-v2-client'
import { CanvasDocumentPreview } from '#/components/canvas-preview'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import { Spinner } from '#/components/ui/spinner'
import { copyText } from '#/lib/copy-text'
import { orpc } from '#/lib/orpc-client'
import { cn } from '#/lib/utils'

type PublishLink = { id: string; expiresAt: number }
type Egress = Awaited<ReturnType<typeof orpc.publish.egress>>

function pagesOf(document: CanvasDocumentV2) {
  return Object.values(document.nodes)
    .filter((node): node is PageNode => node.type === 'page')
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

/** Nearest enclosing Page, so the dialog opens on whatever is selected. */
function enclosingPageId(
  document: CanvasDocumentV2,
  selectedId: string | undefined,
) {
  let node = selectedId ? document.nodes[selectedId] : undefined
  while (node) {
    if (node.type === 'page') return node.id
    node = node.parentId ? document.nodes[node.parentId] : undefined
  }
  return undefined
}

function remaining(ms: number) {
  if (ms <= 0) return 'expired'
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  if (hours === 0) return `${Math.max(1, minutes)}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function gigabytes(bytes: number) {
  const value = bytes / 1024 ** 3
  if (value >= 10) return value.toFixed(0)
  if (value >= 0.1) return value.toFixed(1)
  return value === 0 ? '0' : '<0.1'
}

export function CanvasV2Publish({
  target,
  onFlush,
  iconOnly = false,
}: {
  target: CanvasSyncTarget
  onFlush?: () => Promise<void>
  iconOnly?: boolean
}) {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [links, setLinks] = useState<Record<string, PublishLink>>({})
  const [egress, setEgress] = useState<Egress | null>(null)
  const [pageId, setPageId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const pages = useMemo(() => pagesOf(document), [document])
  const page = pages.find((candidate) => candidate.id === pageId) ?? null
  const link = pageId ? links[pageId] ?? null : null
  const url = link ? `${window.location.origin}/p/${link.id}` : ''
  const blocked = Boolean(target.draftId)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [live, usage] = await Promise.all([
        orpc.publish.list({ designId: target.designId }),
        orpc.publish.egress().catch(() => null),
      ])
      setLinks(
        Object.fromEntries(
          live
            .filter((item) => item.pageId)
            .map((item) => [item.pageId!, { id: item.id, expiresAt: item.expiresAt }]),
        ),
      )
      if (usage) setEgress(usage)
    } catch {
      setError('Could not load this design’s public links.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setCopied(false)
    setPageId(
      enclosingPageId(document, selection[0]?.nodeId) ??
        pages.find((candidate) => !candidate.hidden)?.id ??
        pages[0]?.id ??
        null,
    )
    void load()
  }, [open])

  // Expiry is the whole point of these links, so it counts down while open.
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    setNow(Date.now())
    return () => window.clearInterval(timer)
  }, [open])

  const publish = async () => {
    if (!page) return
    setBusy(true)
    setError(null)
    try {
      await onFlush?.()
      const created = await orpc.publish.create({
        designId: target.designId,
        pageId: page.id,
      })
      setLinks((current) => ({ ...current, [page.id]: created }))
      setNow(Date.now())
    } catch {
      setError(
        page.hidden
          ? 'A hidden Page cannot be published. Make it visible first.'
          : 'Could not publish this Page. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const unpublish = async () => {
    if (!page || !link) return
    setBusy(true)
    setError(null)
    try {
      await orpc.publish.delete({ id: link.id })
      setLinks((current) => {
        const next = { ...current }
        delete next[page.id]
        return next
      })
    } catch {
      setError('Could not take the link offline. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await copyText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Clipboard access was blocked. Copy the link by hand.')
    }
  }

  const liveCount = Object.keys(links).length
  const overLimit = Boolean(
    egress && !egress.unlimited && egress.usedBytes >= egress.limitBytes,
  )

  return (
    <>
      <Button
        size={iconOnly ? 'icon-sm' : 'xs'}
        variant="ghost"
        aria-label={iconOnly ? 'Publish as public link' : undefined}
        disabled={blocked}
        title={
          blocked
            ? 'Apply the branch to Main before publishing'
            : 'Publish (public link, expires in 12h)'
        }
        onClick={() => setOpen(true)}
      >
        <Globe2Icon />
        {iconOnly ? null : 'Publish'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-4xl p-0" bottomStickOnMobile={false}>
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>Publish</DialogTitle>
            <DialogDescription>
              A published Page is a read-only public runtime. Anyone with the
              link can open it without signing in, and it goes offline 12 hours
              after it was last published.
            </DialogDescription>
          </DialogHeader>

          <div className="grid h-[min(72svh,36rem)] grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-e">
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {loading && pages.length === 0 ? (
                  <div className="grid h-24 place-items-center">
                    <Spinner />
                  </div>
                ) : null}
                {pages.length === 0 && !loading ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    This design has no Pages yet.
                  </p>
                ) : null}
                {pages.map((candidate) => {
                  const live = links[candidate.id]
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      aria-pressed={candidate.id === pageId}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                        candidate.id === pageId
                          ? 'bg-secondary'
                          : 'hover:bg-secondary/60',
                      )}
                      onClick={() => setPageId(candidate.id)}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          live ? 'bg-cx-accent' : 'bg-border',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {candidate.name}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {live
                            ? `Live · ${remaining(live.expiresAt - now)} left`
                            : candidate.hidden
                              ? 'Hidden — cannot be published'
                              : 'Not public'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="shrink-0 space-y-1.5 border-t p-3">
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    Bandwidth{egress ? ` · ${egress.windowDays}d` : ''}
                  </span>
                  <span className={overLimit ? 'font-medium text-destructive-foreground' : 'font-medium'}>
                    {egress
                      ? egress.unlimited
                        ? `${gigabytes(egress.usedBytes)} GB · uncapped`
                        : `${gigabytes(egress.usedBytes)} / ${gigabytes(egress.limitBytes)} GB`
                      : '—'}
                  </span>
                </div>
                {egress && !egress.unlimited ? (
                  <div className="h-1 overflow-hidden rounded-full bg-input">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        overLimit ? 'bg-destructive' : 'bg-cx-accent',
                      )}
                      style={{
                        width: `${Math.min(100, (egress.usedBytes / egress.limitBytes) * 100)}%`,
                      }}
                    />
                  </div>
                ) : null}
                {overLimit ? (
                  <p className="text-[11px] text-destructive-foreground">
                    Limit reached — every published link is paused until usage
                    drops out of the window.
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {liveCount === 0
                      ? 'Nothing from this design is public.'
                      : `${liveCount} live ${liveCount === 1 ? 'link' : 'links'} in this design.`}
                  </p>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden border-b bg-cx-canvas">
                {page && !page.hidden ? (
                  <CanvasDocumentPreview document={document} pageId={page.id} />
                ) : (
                  <div className="grid size-full place-items-center px-8 text-center">
                    <p className="text-xs text-muted-foreground">
                      {page
                        ? 'This Page is hidden, so there is nothing to serve.'
                        : 'Select a Page.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="shrink-0 space-y-3 p-3">
                {link ? (
                  <>
                    <div className="flex items-center gap-1">
                      <input
                        readOnly
                        aria-label="Public URL"
                        value={url}
                        className="h-8 min-w-0 flex-1 rounded-md border bg-muted px-2 font-mono text-[11px] outline-none"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Open in a new tab"
                        onClick={() =>
                          window.open(url, '_blank', 'noopener,noreferrer')
                        }
                      >
                        <ExternalLinkIcon />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Live · expires in {remaining(link.expiresAt - now)}. The
                      link itself is the key, so treat it like a password —
                      publishing again extends this same link.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {page?.hidden
                      ? 'Make this Page visible to publish it.'
                      : 'This Page is not public. Publishing serves a snapshot of what is on it right now.'}
                  </p>
                )}
                {error ? (
                  <p className="text-xs text-destructive-foreground">{error}</p>
                ) : null}

                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                  <div className="ms-auto flex items-center gap-2">
                    {link ? (
                      <>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void unpublish()}
                        >
                          <UnlinkIcon />
                          Unpublish
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void publish()}
                        >
                          {busy ? <Spinner /> : <RefreshCwIcon />}
                          Extend
                        </Button>
                        <Button onClick={() => void copy()}>
                          {copied ? <CheckIcon /> : <CopyIcon />}
                          {copied ? 'Copied' : 'Copy link'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={busy || loading || !page || page.hidden}
                        onClick={() => void publish()}
                      >
                        {busy ? <Spinner /> : <Globe2Icon />}
                        Publish Page
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </>
  )
}
