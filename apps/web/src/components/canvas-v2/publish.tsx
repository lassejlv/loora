import { useState } from 'react'
import { CopyIcon, Globe2Icon, UnlinkIcon } from 'lucide-react'
import type { CanvasDocumentV2 } from '@loora/canvas/model'
import { useCanvasDocument, useCanvasSelection } from '@loora/canvas/react'
import type { CanvasSyncTarget } from '#/lib/canvas-v2-client'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import { orpc } from '#/lib/orpc-client'

/** Nearest enclosing Page, falling back to the first visible root Page. */
function enclosingPageId(
  document: CanvasDocumentV2,
  selectedId: string | undefined,
) {
  let node = selectedId ? document.nodes[selectedId] : undefined
  while (node) {
    if (node.type === 'page') return node.id
    node = node.parentId ? document.nodes[node.parentId] : undefined
  }
  return Object.values(document.nodes)
    .filter((candidate) => candidate.type === 'page' && !candidate.hidden)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0]?.id
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
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ id: string; expiresAt: number } | null>(null)
  const pageId = enclosingPageId(document, selection[0]?.nodeId)
  const page = pageId ? document.nodes[pageId] : null
  const url =
    link && typeof window !== 'undefined'
      ? `${window.location.origin}/p/${link.id}`
      : ''

  const openDialog = async () => {
    if (!pageId || target.draftId) return
    setOpen(true)
    setBusy(true)
    try {
      const links = await orpc.publish.list({ designId: target.designId })
      const existing = links.find((candidate) => candidate.pageId === pageId)
      setLink(existing ? { id: existing.id, expiresAt: existing.expiresAt } : null)
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (!pageId) return
    setBusy(true)
    try {
      await onFlush?.()
      setLink(
        await orpc.publish.create({
          designId: target.designId,
          pageId,
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const unpublish = async () => {
    if (!link) return
    setBusy(true)
    try {
      await orpc.publish.delete({ id: link.id })
      setLink(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size={iconOnly ? 'icon-sm' : 'xs'}
        variant="ghost"
        aria-label={iconOnly ? 'Publish as public link' : undefined}
        disabled={!pageId || !!target.draftId}
        title={
          target.draftId
            ? 'Apply the branch to Main before publishing'
            : 'Publish (public link, expires in 12h)'
        }
        onClick={() => void openDialog()}
      >
        <Globe2Icon />
        {iconOnly ? null : 'Publish'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Publish {page?.name ?? 'Page'}</DialogTitle>
            <DialogDescription>
              Creates a safe, read-only public runtime from the structured Page.
              The link expires after 12 hours.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            {link ? (
              <>
                <input
                  readOnly
                  aria-label="Public URL"
                  value={url}
                  className="h-9 w-full rounded-md border bg-muted px-3 text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Live link · static and safe to open. Expires in{' '}
                  {Math.max(
                    1,
                    Math.round((link.expiresAt - Date.now()) / 3_600_000),
                  )}
                  h
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {busy ? 'Checking existing links…' : 'This Page is not public.'}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            {link ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void unpublish()}
                >
                  <UnlinkIcon />
                  Unpublish
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void navigator.clipboard.writeText(url)}
                >
                  <CopyIcon />
                  Copy link
                </Button>
              </>
            ) : (
              <Button disabled={busy || !pageId} onClick={() => void publish()}>
                <Globe2Icon />
                Publish Page
              </Button>
            )}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
