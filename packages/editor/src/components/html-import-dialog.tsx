import { useState } from 'react'
import { FileCode2Icon } from '@loora/ui/icons'
import type { CanvasDocument } from '@loora/canvas/model'
import { importHtmlCssToCanvas } from '../lib/canvas-html-import'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import { Spinner } from '@loora/ui/spinner'
import { Textarea } from '@loora/ui/textarea'

export function HtmlImportDialog({
  open,
  onOpenChange,
  onImport,
  defaultWidth,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (document: CanvasDocument) => void
  defaultWidth: number
}) {
  const [name, setName] = useState('Imported HTML')
  const [html, setHtml] = useState('')
  const [css, setCss] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const importSource = async () => {
    setWorking(true)
    setError(null)
    setResult(null)
    try {
      const imported = await importHtmlCssToCanvas({
        name,
        html,
        css,
        width: defaultWidth,
      })
      onImport(imported.document)
      setResult(
        imported.warnings.length > 0
          ? `Imported as a new page with ${imported.warnings.length} simplification${imported.warnings.length === 1 ? '' : 's'}.`
          : 'Imported as a new editable page.',
      )
      setHtml('')
      setCss('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'HTML could not be imported')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setError(null)
          setResult(null)
        }
      }}
    >
      <DialogPopup className="max-w-4xl p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Import HTML & CSS</DialogTitle>
          <DialogDescription>
            Scripts and network requests are blocked. Computed layout and
            styles become editable Canvas nodes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3 p-4">
          <Input
            aria-label="Imported page name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Imported page"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium">HTML</span>
              <Textarea
                aria-label="HTML"
                className="font-mono"
                value={html}
                onChange={(event) => setHtml(event.target.value)}
                placeholder="<main>…</main>"
                rows={16}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium">CSS</span>
              <Textarea
                aria-label="CSS"
                className="font-mono"
                value={css}
                onChange={(event) => setCss(event.target.value)}
                placeholder=".hero { display: flex; … }"
                rows={16}
              />
            </label>
          </div>
          {error ? (
            <p className="text-xs text-destructive-foreground">{error}</p>
          ) : result ? (
            <p className="text-xs text-muted-foreground">{result}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter className="border-t px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={working || !html.trim()}
            onClick={() => void importSource()}
          >
            {working ? <Spinner /> : <FileCode2Icon />}
            Import page
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
