import { useState } from 'react'
import { MessageSquarePlusIcon } from 'lucide-react'
import {
  useCanvasDocument,
  useCanvasSelection,
} from '@loora/canvas/react'
import type {
  CanvasCommentPin,
  CanvasDocumentV2,
} from '@loora/canvas/model'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'

export function composeCanvasComment(
  document: CanvasDocumentV2,
  text: string,
  pin: CanvasCommentPin,
) {
  const node = document.nodes[pin.target.nodeId]
  const instancePath =
    pin.target.instancePath.length > 0
      ? ` through instances ${pin.target.instancePath.join(' / ')}`
      : ''
  return `${text.trim()}

---
Canvas comment pinned to NodeRef:
- ${node?.name ?? 'Unknown node'} (${pin.target.nodeId})${instancePath}
- local position: ${Math.round(pin.x * 100)}% from the left, ${Math.round(pin.y * 100)}% from the top
- ref: ${JSON.stringify(pin.target)}`
}

export function CanvasV2Comment({
  onComment,
}: {
  onComment: (message: string) => void
}) {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [x, setX] = useState(50)
  const [y, setY] = useState(50)
  const target = selection[0] ?? null

  const submit = () => {
    if (!target || !text.trim()) return
    onComment(
      composeCanvasComment(document, text, {
        target,
        x: Math.max(0, Math.min(1, x / 100)),
        y: Math.max(0, Math.min(1, y / 100)),
      }),
    )
    setText('')
    setOpen(false)
  }

  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Pin comment"
        disabled={!target}
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlusIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Comment on selection</DialogTitle>
            <DialogDescription>
              The agent receives an exact NodeRef and local coordinates.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <textarea
              autoFocus
              value={text}
              placeholder="What should change here?"
              className="min-h-24 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none"
              onChange={(event) => setText(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs">
                <span>Left %</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={x}
                  onChange={(event) => setX(Number(event.target.value))}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span>Top %</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={y}
                  onChange={(event) => setY(Number(event.target.value))}
                />
              </label>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button disabled={!target || !text.trim()} onClick={submit}>
              Send to agent
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
}
