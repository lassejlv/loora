import { useEffect, useMemo, useState } from 'react'
import {
  CopyIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import type { CanvasElement, CanvasPage } from '#/lib/canvas'
import { hasMissingPageElements, pageId } from '#/lib/pages'
import { PanelEmpty, PanelShell } from '#/components/panel-shell'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { PublishButton } from '#/components/publish-button'
import { cn } from '#/lib/utils'

function PageNameInput({
  page,
  onCommit,
}: {
  page: CanvasPage
  onCommit: (name: string) => void
}) {
  const [name, setName] = useState(page.name)

  useEffect(() => setName(page.name), [page.id, page.name])

  const commit = () => {
    const next = name.trim()
    if (!next) {
      setName(page.name)
      return
    }
    if (next !== page.name) onCommit(next)
  }

  return (
    <Input
      value={name}
      aria-label="Page name"
      onChange={(event) => setName(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setName(page.name)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function PagesPanel({
  pages,
  elements,
  selectedPageId,
  selectedElementIds,
  designId,
  draftId,
  onSelectPage,
  onCreatePage,
  onUpdatePage,
  onDeletePage,
  onDuplicatePage,
  onOpenPage,
  onClose,
}: {
  pages: CanvasPage[]
  elements: CanvasElement[]
  selectedPageId: string | null
  selectedElementIds: string[]
  designId: string
  draftId: string | null
  onSelectPage: (id: string) => void
  onCreatePage: () => void
  onUpdatePage: (id: string, patch: Partial<Omit<CanvasPage, 'id'>>) => void
  onDeletePage: (id: string) => void
  onDuplicatePage: (id: string) => void
  onOpenPage: (id: string) => void
  onClose?: () => void
}) {
  const selected = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null
  const elementsById = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  )
  const [dragItemId, setDragItemId] = useState<string | null>(null)
  const publishReady =
    selected !== null &&
    selected.items.length > 0 &&
    !hasMissingPageElements(selected, elements)

  const addSelected = () => {
    if (!selected || selectedElementIds.length === 0) return
    const additions = selectedElementIds
      .map((elementId) => elementsById.get(elementId))
      .filter((element): element is CanvasElement => !!element)
      .map((element) => ({
        id: pageId('pi'),
        elementId: element.id,
        height: Math.max(1, Math.round(element.h * (selected.w / element.w))),
      }))
    onUpdatePage(selected.id, { items: [...selected.items, ...additions] })
  }

  const moveItem = (overId: string) => {
    if (!selected || !dragItemId || dragItemId === overId) return
    const next = [...selected.items]
    const from = next.findIndex((item) => item.id === dragItemId)
    const to = next.findIndex((item) => item.id === overId)
    if (from < 0 || to < 0) return
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onUpdatePage(selected.id, { items: next })
    setDragItemId(null)
  }

  return (
    <PanelShell
      title="Pages"
      description="Stack reusable blocks into complete pages."
      onClose={onClose}
      actions={
        <Button size="icon-xs" variant="ghost" aria-label="Create Page" onClick={onCreatePage}>
          <PlusIcon data-slot="icon" />
        </Button>
      }
      bodyClassName="gap-3 p-2"
    >
      {pages.length === 0 ? (
        <PanelEmpty
          title="No Pages yet"
          description="Select one or more blocks, then create a Page."
          action={
            <Button size="sm" onClick={onCreatePage} disabled={selectedElementIds.length === 0}>
              <PlusIcon data-slot="icon" />
              Create from selection
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                className={cn(
                  'flex items-center rounded-md px-2 py-1.5 text-left text-xs',
                  page.id === selected?.id
                    ? 'bg-cx-accent/10 font-medium text-cx-accent'
                    : 'hover:bg-secondary',
                )}
                onClick={() => onSelectPage(page.id)}
              >
                <span className="min-w-0 flex-1 truncate">{page.name}</span>
                <span className="text-[10px] text-muted-foreground">{page.items.length}</span>
              </button>
            ))}
          </div>

          {selected ? (
            <div className="space-y-3 border-t pt-3">
              <PageNameInput
                page={selected}
                onCommit={(name) => onUpdatePage(selected.id, { name })}
              />

              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  className="flex-1"
                  onClick={addSelected}
                  disabled={selectedElementIds.length === 0}
                >
                  <PlusIcon data-slot="icon" />
                  Add selected
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Open responsive preview"
                  onClick={() => onOpenPage(selected.id)}
                >
                  <ExternalLinkIcon data-slot="icon" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Duplicate Page"
                  onClick={() => onDuplicatePage(selected.id)}
                >
                  <CopyIcon data-slot="icon" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Delete Page"
                  onClick={() => onDeletePage(selected.id)}
                >
                  <Trash2Icon data-slot="icon" />
                </Button>
              </div>

              {!draftId ? (
                <PublishButton
                  designId={designId}
                  pageId={selected.id}
                  compact={false}
                  disabled={!publishReady}
                />
              ) : null}
              {!draftId && !publishReady ? (
                <p className="text-[11px] text-muted-foreground">
                  Add visible blocks before publishing this Page.
                </p>
              ) : null}

              <div className="space-y-1">
                {selected.items.map((item) => {
                  const element = elementsById.get(item.elementId)
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => setDragItemId(item.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => moveItem(item.id)}
                      onDragEnd={() => setDragItemId(null)}
                      className="flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1"
                    >
                      <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {element?.name ?? 'Missing block'}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        aria-label={`${element?.name ?? 'Block'} height`}
                        value={Math.round(item.height)}
                        className="h-7 w-20 px-1.5 text-right text-xs"
                        onChange={(event) => {
                          const height = Number(event.target.value)
                          if (!Number.isFinite(height) || height < 1) return
                          onUpdatePage(selected.id, {
                            items: selected.items.map((candidate) =>
                              candidate.id === item.id ? { ...candidate, height } : candidate,
                            ),
                          })
                        }}
                      />
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${element?.name ?? 'block'} from Page`}
                        onClick={() =>
                          onUpdatePage(selected.id, {
                            items: selected.items.filter((candidate) => candidate.id !== item.id),
                          })
                        }
                      >
                        <Trash2Icon data-slot="icon" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </PanelShell>
  )
}
