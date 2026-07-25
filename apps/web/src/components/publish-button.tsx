import { useState } from 'react'
import { GlobeIcon } from 'lucide-react'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'

// Selection-bar entry point for 12h public links. The existing-link lookup is
// lazy (on open) so clicking around the canvas doesn't fire a request per
// selection change.

type LinkState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; link: { id: string; expiresAt: number } | null }
  | { status: 'error' }

export function PublishButton({
  designId,
  elementId,
  pageId,
  compact = true,
  disabled = false,
}: {
  designId: string
  elementId?: string
  pageId?: string
  compact?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LinkState>({ status: 'idle' })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setState({ status: 'loading' })
    orpc.publish
      .list({ designId })
      .then((links) => {
        const found = links.find((link) =>
          elementId ? link.elementId === elementId : link.pageId === pageId,
        )
        setState({ status: 'ready', link: found ? { id: found.id, expiresAt: found.expiresAt } : null })
      })
      .catch(() => setState({ status: 'error' }))
  }

  const publish = async () => {
    if (busy) return
    setBusy(true)
    try {
      const created = await orpc.publish.create({ designId, elementId, pageId })
      setState({ status: 'ready', link: created })
    } catch {
      setState({ status: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const unpublish = async (id: string) => {
    if (busy) return
    setBusy(true)
    try {
      await orpc.publish.delete({ id })
      setState({ status: 'ready', link: null })
    } catch {
      setState({ status: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Field stays selectable for a manual copy.
    }
  }

  const link = state.status === 'ready' ? state.link : null
  const url = link ? `${window.location.origin}/p/${link.id}` : null

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? 'icon-sm' : 'sm'}
            aria-label="Publish as public link"
            title="Publish (public link, expires in 12h)"
            disabled={disabled}
          />
        }
      >
        <GlobeIcon data-slot="icon" />
        {!compact ? 'Publish Page' : null}
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} className="w-80 p-3">
        {state.status === 'loading' || state.status === 'idle' ? (
          <p className="cx-shimmer text-xs">Checking link…</p>
        ) : state.status === 'error' ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-destructive-foreground">Something went wrong.</p>
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onOpenChange(true)}>
              Retry
            </Button>
          </div>
        ) : link && url ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">Live link</p>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => void copyUrl(url)}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Anyone with the link can view · expires in{' '}
                {Math.max(1, Math.round((link.expiresAt - Date.now()) / 3_600_000))}h
              </p>
              <button
                type="button"
                disabled={busy}
                className="text-[11px] font-medium text-destructive-foreground hover:underline disabled:opacity-50"
                onClick={() => void unpublish(link.id)}
              >
                Delete link
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">Publish this {pageId ? 'Page' : 'element'}</p>
            <p className="text-[11px] text-muted-foreground">
              Creates a public link anyone can view. Content stays live and the link expires after
              12 hours — or delete it here anytime.
            </p>
            <Button size="sm" className="h-7 self-start px-3 text-xs" disabled={busy} onClick={() => void publish()}>
              {busy ? 'Publishing…' : 'Create link'}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
