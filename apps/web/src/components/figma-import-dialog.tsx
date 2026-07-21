import { useEffect, useState } from 'react'
import { FigmaIcon, ImportIcon } from 'lucide-react'
import type { CanvasElement } from '@loora/db/canvas'
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
import { Input } from '#/components/ui/input'
import { orpc } from '#/lib/orpc-client'

const PENDING_KEY = 'loora:pending-figma-import'
const PENDING_DESTINATION_KEY = 'loora:pending-figma-destination'

type ImportResult = Awaited<ReturnType<typeof orpc.figma.import>>
export type FigmaImportDestination = 'new' | 'current'

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Could not import this Figma file.'
}

export function FigmaImportDialog({
  open,
  onOpenChange,
  onImported,
  currentDocument,
  initialDestination = 'new',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (result: ImportResult, destination: FigmaImportDestination) => void
  currentDocument: { id: string; name: string; shapes: CanvasElement[] }
  initialDestination?: FigmaImportDestination
}) {
  const [url, setUrl] = useState(() => window.sessionStorage.getItem(PENDING_KEY) ?? '')
  const [destination, setDestination] = useState<FigmaImportDestination>(() =>
    window.sessionStorage.getItem(PENDING_DESTINATION_KEY) === 'current' ? 'current' : 'new',
  )
  const [status, setStatus] = useState<Awaited<ReturnType<typeof orpc.figma.status>> | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    if (!open) return
    if (!window.sessionStorage.getItem(PENDING_DESTINATION_KEY)) {
      setDestination(initialDestination)
    }
    setLoadingStatus(true)
    setError('')
    const current = new URL(window.location.href)
    const oauthResult = current.searchParams.get('figma')
    if (oauthResult === 'failed') setError('Figma could not be connected. Try again.')
    if (oauthResult === 'cancelled') setError('Figma connection was cancelled.')
    void orpc.figma
      .status()
      .then(setStatus)
      .catch(() => setError('Could not check the Figma connection.'))
      .finally(() => setLoadingStatus(false))

    if (current.searchParams.has('figmaImport') || current.searchParams.has('figma')) {
      current.searchParams.delete('figmaImport')
      current.searchParams.delete('figma')
      window.history.replaceState(window.history.state, '', current)
    }
  }, [open, initialDestination])

  const handleImport = async () => {
    const source = url.trim()
    if (!source) return
    setError('')
    setResult(null)

    if (!status?.connected) {
      window.sessionStorage.setItem(PENDING_KEY, source)
      window.sessionStorage.setItem(PENDING_DESTINATION_KEY, destination)
      const returnTo = new URL(window.location.href)
      returnTo.searchParams.set('figmaImport', 'true')
      window.location.assign(
        `/api/figma/connect?returnTo=${encodeURIComponent(`${returnTo.pathname}${returnTo.search}`)}`,
      )
      return
    }

    setImporting(true)
    try {
      const imported = await orpc.figma.import({
        url: source,
        ...(destination === 'current' ? { target: currentDocument } : {}),
      })
      window.sessionStorage.removeItem(PENDING_KEY)
      window.sessionStorage.removeItem(PENDING_DESTINATION_KEY)
      setUrl('')
      setResult(imported)
      onImported(imported, destination)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!importing) {
          if (!next) {
            setResult(null)
            setError('')
          }
          onOpenChange(next)
        }
      }}
    >
      <DialogPopup
        className="max-w-lg"
        bottomStickOnMobile={false}
        showCloseButton={!importing}
      >
        <DialogHeader>
          <DialogTitle>Import from Figma</DialogTitle>
          <DialogDescription>
            Paste a Figma Design file or frame link. Loora creates an independent, editable copy.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {result ? (
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium">
                {destination === 'current' ? 'Added to' : 'Imported'} “{result.design.name}”
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {result.summary.frames} frame{result.summary.frames === 1 ? '' : 's'} across{' '}
                {result.summary.pages} page{result.summary.pages === 1 ? '' : 's'}
                {result.summary.fallbacks > 0
                  ? ` · ${result.summary.fallbacks} visual fallback${result.summary.fallbacks === 1 ? '' : 's'}`
                  : ''}
              </p>
              {result.summary.missingFonts.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Browser fallbacks were used for: {result.summary.missingFonts.join(', ')}.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                Figma link
                <Input
                  autoFocus
                  value={url}
                  disabled={importing}
                  placeholder="https://www.figma.com/design/…"
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && url.trim() && !importing) {
                      event.preventDefault()
                      void handleImport()
                    }
                  }}
                />
              </label>
              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-xs font-medium">Import destination</legend>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-checked:border-foreground/30 has-checked:bg-muted/50">
                  <input
                    type="radio"
                    name="figma-import-destination"
                    value="new"
                    checked={destination === 'new'}
                    disabled={importing}
                    className="mt-0.5 accent-foreground"
                    onChange={() => setDestination('new')}
                  />
                  <span>
                    <span className="block text-xs font-medium">New document</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Create a separate document for the imported design.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-checked:border-foreground/30 has-checked:bg-muted/50">
                  <input
                    type="radio"
                    name="figma-import-destination"
                    value="current"
                    checked={destination === 'current'}
                    disabled={importing}
                    className="mt-0.5 accent-foreground"
                    onChange={() => setDestination('current')}
                  />
                  <span>
                    <span className="block text-xs font-medium">Current document</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Add it beside the existing content in “{currentDocument.name}”.
                    </span>
                  </span>
                </label>
              </fieldset>
              <p className="text-xs leading-relaxed text-muted-foreground">
                A link containing <code className="font-mono">node-id</code> imports only that
                frame. Whole-file links import visible top-level layers from every page.
              </p>
              {status && !status.enabled ? (
                <p className="text-xs text-warning-foreground">
                  Figma importing is not configured on this server.
                </p>
              ) : null}
              {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          {result ? (
            <Button
              onClick={() => {
                setResult(null)
                setError('')
                onOpenChange(false)
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={importing}
                onClick={() => {
                  setError('')
                  onOpenChange(false)
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  loadingStatus ||
                  importing ||
                  !status ||
                  !url.trim() ||
                  status.enabled === false
                }
                onClick={() => void handleImport()}
              >
                {status?.connected ? (
                  <ImportIcon data-slot="icon" />
                ) : (
                  <FigmaIcon data-slot="icon" />
                )}
                {importing
                  ? 'Importing…'
                  : status?.connected
                    ? 'Import file'
                    : 'Connect Figma'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
