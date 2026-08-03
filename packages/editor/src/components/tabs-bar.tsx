import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  FileIcon,
  LayoutGridIcon,
  PlusIcon,
  XIcon,
} from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { Spinner } from '@loora/ui/spinner'
import { cn } from '@loora/ui/utils'
import { createDesign } from '../lib/designs'
import { forgetOpenDesign, useOpenDesigns } from '../lib/open-designs'

/**
 * The browser-style strip of open design files, shared by the dashboard and
 * the editor. Tabs live in localStorage per client, like open browser tabs.
 */
export function OpenTabsBar({ activeId = null }: { activeId?: string | null }) {
  const tabs = useOpenDesigns()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    forgetOpenDesign(id)
    if (id !== activeId) return
    const fallback = tabs[index + 1] ?? tabs[index - 1]
    if (fallback) {
      void navigate({ to: '/design/$id', params: { id: fallback.id } })
    } else {
      void navigate({ to: '/app' })
    }
  }

  const newFile = async () => {
    if (creating) return
    setCreating(true)
    try {
      const created = await createDesign()
      await navigate({ to: '/design/$id', params: { id: created.id } })
    } catch {
      // The dashboard and editor both surface creation failures of their own.
    } finally {
      setCreating(false)
    }
  }

  return (
    <nav
      aria-label="Open files"
      className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface px-2"
    >
      <Link
        to="/app"
        aria-current={activeId ? undefined : 'page'}
        className={cn(
          'flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
          !activeId && 'border-line bg-surface-2 text-foreground',
        )}
      >
        <LayoutGridIcon className="size-3.5 shrink-0" />
        Dashboard
      </Link>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex h-7 shrink-0 items-center rounded-md border border-transparent pe-1 ps-2 text-muted-foreground hover:bg-secondary hover:text-foreground',
                active && 'border-line bg-surface-2 text-foreground',
              )}
            >
              <Link
                to="/design/$id"
                params={{ id: tab.id }}
                aria-current={active ? 'page' : undefined}
                className="flex min-w-0 items-center gap-1.5 text-xs font-medium"
              >
                <FileIcon className="size-3.5 shrink-0" />
                <span className="max-w-40 truncate">{tab.name}</span>
              </Link>
              <button
                type="button"
                aria-label={`Close ${tab.name}`}
                className={cn(
                  'ms-1 flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-foreground/10',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                )}
                onClick={() => closeTab(tab.id)}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          )
        })}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="New tab"
        disabled={creating}
        onClick={() => void newFile()}
      >
        {creating ? <Spinner /> : <PlusIcon />}
      </Button>
    </nav>
  )
}
