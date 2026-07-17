import { useState } from 'react'
import { HistoryIcon } from 'lucide-react'
import type { Shape } from '#/lib/canvas'
import { commitDoc, loadHistory, relativeTime, type Commit } from '#/lib/history'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'

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

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setHistory(loadHistory(docId))
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" title="Version history">
            <HistoryIcon data-slot="icon" />
            History
          </Button>
        }
      />
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const msg = message.trim()
            if (!msg) return
            setHistory(commitDoc(docId, msg, shapesRef.current))
            setMessage('')
          }}
        >
          <Input
            size="sm"
            placeholder="Describe this version…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!message.trim()}>
            Commit
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
                  variant="outline"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => {
                    onRestore(c.shapes)
                    setOpen(false)
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
