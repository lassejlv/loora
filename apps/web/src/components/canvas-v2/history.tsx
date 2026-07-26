import { useEffect, useState } from 'react'
import { HistoryIcon } from 'lucide-react'
import type { CanvasDocumentV2 } from '@loora/canvas/model'
import { useCanvasDocument } from '@loora/canvas/react'
import { migrateCanvasVersion } from '#/lib/canvas-v2-migration'
import { orpc } from '#/lib/orpc-client'
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
import type { CanvasEditorController } from './editor'

type VersionPage = Awaited<ReturnType<typeof orpc.history.list>>
type Version = VersionPage['items'][number]

export function CanvasV2History({
  controller,
  readOnly,
  iconOnly = false,
}: {
  controller: CanvasEditorController
  readOnly: boolean
  iconOnly?: boolean
}) {
  const document = useCanvasDocument()
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<Version[]>([])
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!controller.target) return
    const page = await orpc.history.list({
      designId: controller.target.designId,
      draftId: controller.target.draftId,
      limit: 50,
    })
    setVersions(page.items)
  }

  useEffect(() => {
    if (!open) return
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not load history'),
    )
  }, [open])

  const commit = async () => {
    if (!controller.target) return
    setWorking(true)
    setError(null)
    try {
      await controller.flush?.()
      await orpc.history.commitV2({
        id: `v${crypto.randomUUID().replaceAll('-', '')}`,
        designId: controller.target.designId,
        draftId: controller.target.draftId,
        message: 'Manual checkpoint',
        document,
        skipIfUnchanged: true,
      })
      await load()
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
    setWorking(true)
    setProgress(null)
    setError(null)
    try {
      await controller.flush?.()
      if (version.canvasVersion !== 2) {
        await migrateCanvasVersion(
          controller.target,
          version.id,
          setProgress,
        )
        await load()
      }
      setProgress('Restoring checkpoint')
      const result = await orpc.history.restoreV2({
        designId: controller.target.designId,
        draftId: controller.target.draftId,
        id: version.id,
        expectedRevision: controller.revision,
      })
      await controller.adoptSnapshot(
        result.document as CanvasDocumentV2,
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

  if (!controller.target) return null
  return (
    <>
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Checkpoints store normalized Canvas V2 documents. Older
              checkpoints convert once when restored.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="max-h-[60svh] space-y-2 overflow-y-auto">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {progress ? (
              <p className="text-sm text-muted-foreground">{progress}</p>
            ) : null}
            {versions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No checkpoints yet.
              </p>
            ) : (
              versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{version.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(version.at).toLocaleString()} · +{version.added} −
                      {version.removed} · {version.changed} changed
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={working || readOnly}
                    onClick={() => void restore(version)}
                  >
                    {version.canvasVersion === 2
                      ? 'Restore'
                      : 'Migrate & restore'}
                  </Button>
                </div>
              ))
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button disabled={working || readOnly} onClick={() => void commit()}>
              Create checkpoint
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
