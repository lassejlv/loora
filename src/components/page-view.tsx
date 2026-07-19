import { useEffect, useRef, useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  FileIcon,
  PlusIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import type { CanvasElement } from '#/lib/canvas'
import { elementId } from '#/lib/canvas'
import { pageTemplate } from '#/lib/element-templates'
import { ElementFrame } from '#/components/element-frame'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'

// Web Page mode: no canvas — one page (top-level element) fills the view,
// always live. Pages design at a fixed width (element.w); the view scales it
// and content scrolls vertically inside the element iframe.

type Zoom = number | 'fit'

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25] as const

function loadZoom(docId: string): Zoom {
  if (typeof localStorage === 'undefined') return 'fit'
  try {
    const raw = localStorage.getItem(`loora:pagezoom:${docId}`)
    if (raw === 'fit') return 'fit'
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0.1 && n <= 4) return n
  } catch {
    // corrupt entry: fall through
  }
  return 'fit'
}

export function PageView({
  elements,
  activePageId,
  onActivePageChange,
  onCreate,
  onUpdate,
  onDelete,
  docId,
}: {
  elements: CanvasElement[]
  activePageId: string | null
  onActivePageChange: (id: string) => void
  onCreate: (element: CanvasElement) => void
  onUpdate: (id: string, patch: Partial<CanvasElement>) => void
  onDelete: (id: string) => void
  docId: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<Zoom>(() => loadZoom(docId))
  const [containerW, setContainerW] = useState(0)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const page = elements.find((el) => el.id === activePageId) ?? elements[0]

  useEffect(() => {
    setZoom(loadZoom(docId))
  }, [docId])
  useEffect(() => {
    localStorage.setItem(`loora:pagezoom:${docId}`, String(zoom))
  }, [zoom, docId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setContainerW(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pad = 48
  const scale = page
    ? zoom === 'fit'
      ? Math.min(1, Math.max(0.1, (containerW - pad * 2) / page.w))
      : zoom
    : 1
  const zoomPct = Math.round(scale * 100)

  const stepZoom = (dir: 1 | -1) => {
    const next =
      dir === 1
        ? ZOOM_STEPS.find((step) => step > scale + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
        : [...ZOOM_STEPS].reverse().find((step) => step < scale - 0.01) ?? ZOOM_STEPS[0]
    setZoom(next)
  }

  const addPage = () => {
    const template = pageTemplate(elements.length + 1)
    const element: CanvasElement = {
      id: elementId(),
      name: template.name,
      // Keep canvas mode sane: new pages land in a horizontal row.
      x: elements.length * (template.w + 80),
      y: 0,
      w: template.w,
      h: template.h,
      code: template.code,
    }
    onCreate(element)
    onActivePageChange(element.id)
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-cx-canvas">
      {/* Page sheet */}
      {page ? (
        <div className="absolute inset-0 overflow-auto" style={{ padding: pad, paddingTop: 72 }}>
          <div
            className="mx-auto overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-black/10"
            style={{
              width: page.w * scale,
              height: `max(400px, calc(100% - 8px))`,
              minWidth: page.w * scale,
            }}
          >
            {/* Scale wrapper: iframe renders at the page's design width. */}
            <div
              style={{
                width: page.w,
                height: `${100 / scale}%`,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
              }}
            >
              <ElementFrame elementId={page.id} code={page.code} interactive />
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No pages yet.</p>
            <Button onClick={addPage}>
              <PlusIcon data-slot="icon" />
              Add a page
            </Button>
          </div>
        </div>
      )}

      {/* Page bar */}
      {page && (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex items-center justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
            {renaming ? (
              <input
                autoFocus
                defaultValue={page.name}
                className="w-40 rounded border bg-background px-1.5 py-0.5 text-sm outline-none"
                onBlur={(e) => {
                  const name = e.target.value.trim()
                  if (name) onUpdate(page.id, { name })
                  setRenaming(false)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                }}
              />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-secondary"
                  >
                    <FileIcon className="size-3.5 text-muted-foreground" />
                    {page.name || 'Page'}
                    <span className="text-xs text-muted-foreground">
                      {elements.length} {elements.length === 1 ? 'page' : 'pages'}
                    </span>
                    <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Pages</DropdownMenuLabel>
                  {elements.map((el) => (
                    <DropdownMenuItem key={el.id} onSelect={() => onActivePageChange(el.id)}>
                      <FileIcon />
                      <span className="min-w-0 flex-1 truncate">{el.name || 'Page'}</span>
                      {el.id === page.id && <CheckIcon className="size-3.5" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={addPage}>
                    <PlusIcon />
                    New page
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename page</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    Delete page
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {/* Zoom control */}
      {page && (
        <div className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-xl border bg-card p-1 shadow-sm">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => stepZoom(-1)}>
            <ZoomOutIcon data-slot="icon" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="w-11 rounded-md px-1 py-0.5 text-center font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {zoomPct}%
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-32">
              {ZOOM_STEPS.map((step) => (
                <DropdownMenuItem key={step} onSelect={() => setZoom(step)}>
                  <span className="flex-1">{Math.round(step * 100)}%</span>
                  {zoom === step && <CheckIcon className="size-3.5" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setZoom('fit')}>
                <span className={cn('flex-1')}>Fit width</span>
                {zoom === 'fit' && <CheckIcon className="size-3.5" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => stepZoom(1)}>
            <ZoomInIcon data-slot="icon" />
          </Button>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogPopup className="max-w-sm" bottomStickOnMobile={false}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page?</AlertDialogTitle>
            <AlertDialogDescription>
              “{page?.name ?? 'Page'}” and its content will be removed. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (page) {
                  const remaining = elements.filter((el) => el.id !== page.id)
                  onDelete(page.id)
                  if (remaining[0]) onActivePageChange(remaining[0].id)
                }
                setConfirmDelete(false)
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  )
}
