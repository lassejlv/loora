import { ElementFrame } from './element-frame'
import type { CanvasElement, CanvasPage } from '#/lib/canvas'
import { pageElements } from '#/lib/pages'
import { cn } from '#/lib/utils'

export function PageFrame({
  page,
  elements,
  framePrefix,
  interactive = false,
  selectedItemId,
  onSelectItem,
}: {
  page: CanvasPage
  elements: CanvasElement[]
  framePrefix: string
  interactive?: boolean
  selectedItemId?: string | null
  onSelectItem?: (itemId: string, elementId: string) => void
}) {
  return (
    <div className="w-full bg-white">
      {pageElements(page, elements).map(({ item, element }) => (
        <section
          key={item.id}
          aria-label={element?.name ?? 'Missing block'}
          className={cn(
            'relative w-full overflow-hidden',
            selectedItemId === item.id && 'ring-2 ring-inset ring-cx-accent',
          )}
          style={{ height: item.height }}
          onPointerDown={(event) => {
            if (!onSelectItem || !element) return
            event.stopPropagation()
            onSelectItem(item.id, element.id)
          }}
        >
          {element && !element.hidden ? (
            <ElementFrame
              elementId={element.id}
              frameId={`${framePrefix}:${item.id}`}
              code={element.code}
              interactive={interactive}
            />
          ) : (
            <div className="grid h-full place-items-center border border-dashed border-destructive/40 bg-destructive/5 px-4 text-center text-xs text-destructive">
              {element ? `${element.name} is hidden` : 'Referenced block is missing'}
            </div>
          )}
        </section>
      ))}
      {page.items.length === 0 ? (
        <div className="grid h-48 place-items-center border border-dashed text-xs text-muted-foreground">
          Add blocks to this Page
        </div>
      ) : null}
    </div>
  )
}
