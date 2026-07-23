import { GithubIcon, ImageIcon, SquareIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { MentionItem, MentionKind } from '#/lib/mentions'

export const MENTION_KIND_META: Record<
  MentionKind,
  { title: string; icon: typeof SquareIcon }
> = {
  element: { title: 'Canvas elements', icon: SquareIcon },
  asset: { title: 'Assets', icon: ImageIcon },
  repo: { title: 'Repositories', icon: GithubIcon },
}

/** Compact inline chip for a mention inside a user chat bubble. */
export function MentionChip({ kind, label }: { kind: MentionKind; label: string }) {
  const Icon = MENTION_KIND_META[kind].icon
  return (
    <span className="mx-0.5 inline-flex translate-y-px items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 align-baseline text-xs font-medium text-foreground">
      <Icon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      <span className="max-w-48 truncate">@{label}</span>
    </span>
  )
}

/**
 * Flat-list mention picker rendered above the composer. Keyboard handling
 * stays in the textarea (arrows/enter/escape) so focus never leaves the input;
 * this component only renders the current items and active index.
 */
export function MentionMenu({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: MentionItem[]
  activeIndex: number
  onSelect: (item: MentionItem) => void
  onHover: (index: number) => void
}) {
  if (items.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute inset-x-3 bottom-full z-50 mb-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, index) => {
        const meta = MENTION_KIND_META[item.kind]
        const Icon = meta.icon
        const firstOfKind = index === 0 || items[index - 1]!.kind !== item.kind
        return (
          <div key={`${item.kind}:${item.id}`}>
            {firstOfKind ? (
              <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {meta.title}
              </p>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                index === activeIndex ? 'bg-accent text-accent-foreground' : '',
              )}
              // Fires before the textarea loses focus; click would land after blur.
              onPointerDown={(event) => {
                event.preventDefault()
                onSelect(item)
              }}
              onPointerMove={() => {
                if (index !== activeIndex) onHover(index)
              }}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint ? (
                <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
              ) : null}
            </button>
          </div>
        )
      })}
    </div>
  )
}
