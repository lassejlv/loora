import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  ClockIcon,
  EllipsisIcon,
  FilePlus2Icon,
  LayoutGridIcon,
  ListIcon,
  LogOutIcon,
  PencilIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
} from 'lucide-react'
import { authClient } from '@loora/auth/client'
import { DesignThumbnail } from '#/components/design-thumbnail'
import { SettingsPanel } from '#/components/settings-panel'
import { clearWelcomeSeen } from '#/components/welcome-dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { orpc } from '#/lib/orpc-client'
import { createDesign, relativeTime, type DesignSummary } from '#/lib/designs'
import {
  cacheShortcuts,
  loadCachedShortcuts,
  normalizeConfig,
  type ShortcutConfig,
} from '#/lib/shortcuts'
import { cn } from '#/lib/utils'

const VIEW_STORAGE_KEY = 'loora:files-view'

type FilesView = 'grid' | 'list'

function initialView(): FilesView {
  if (typeof window === 'undefined') return 'grid'
  return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
}

function byRecent(left: DesignSummary, right: DesignSummary) {
  return right.updatedAt - left.updatedAt
}

function FileActions({
  name,
  onRename,
  onDelete,
  className,
}: {
  name: string
  onRename: () => void
  onDelete: () => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${name}`}
          className={cn(
            'flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground',
            className,
          )}
        >
          <EllipsisIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon data-slot="icon" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon data-slot="icon" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AccountMenu({
  name,
  onSettings,
  onSignOut,
  compact = false,
}: {
  name: string
  onSettings: () => void
  onSignOut: () => void
  compact?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className={cn(
            'flex items-center gap-2 rounded-md text-start hover:bg-secondary',
            compact ? 'p-1' : 'w-full px-2 py-1.5',
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cx-accent/12 text-xs font-semibold text-cx-accent">
            {name.slice(0, 1).toUpperCase()}
          </span>
          {compact ? null : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onClick={onSettings}>
          <SettingsIcon data-slot="icon" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOutIcon data-slot="icon" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FileCard({
  design,
  onRename,
  onDelete,
}: {
  design: DesignSummary
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative flex flex-col rounded-xl border bg-card p-3 transition-colors hover:border-foreground/24">
      <Link
        to="/app/design"
        search={{ id: design.id }}
        aria-label={`Open ${design.name}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      />
      <div className="pointer-events-none flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{design.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Edited {relativeTime(design.updatedAt)}
          </p>
        </div>
      </div>
      <FileActions
        name={design.name}
        onRename={onRename}
        onDelete={onDelete}
        className="absolute end-2 top-2 bg-card opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
      <div className="mt-3 aspect-[4/3] overflow-hidden rounded-lg border bg-cx-canvas">
        <DesignThumbnail designId={design.id} revision={design.revision} />
      </div>
    </div>
  )
}

function FileRow({
  design,
  onRename,
  onDelete,
}: {
  design: DesignSummary
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative flex items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-secondary/50">
      <Link
        to="/app/design"
        search={{ id: design.id }}
        aria-label={`Open ${design.name}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
      />
      <div className="pointer-events-none size-10 shrink-0 overflow-hidden rounded-md border bg-cx-canvas">
        <DesignThumbnail designId={design.id} revision={design.revision} />
      </div>
      <p className="pointer-events-none min-w-0 flex-1 truncate text-sm font-medium">
        {design.name}
      </p>
      <p className="pointer-events-none hidden shrink-0 text-xs text-muted-foreground sm:block">
        Edited {relativeTime(design.updatedAt)}
      </p>
      <FileActions
        name={design.name}
        onRename={onRename}
        onDelete={onDelete}
        className="relative shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
    </div>
  )
}

/**
 * The file browser at `/app`. It owns creation, rename, and deletion; the
 * canvas itself lives at `/app/design?id=…` and is never mounted from here.
 */
export function DesignsDashboard() {
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<FilesView>(initialView)
  const [creating, setCreating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DesignSummary | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DesignSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>(loadCachedShortcuts)
  const [agentSystemPrompt, setAgentSystemPrompt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void orpc.design
      .list()
      .then((found) => {
        if (!cancelled) setDesigns([...found].sort(byRecent))
      })
      .catch((cause) => {
        if (cancelled) return
        setDesigns([])
        setError(cause instanceof Error ? cause.message : 'Your files could not be loaded')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void orpc.preferences
      .get()
      .then((preferences) => {
        if (cancelled) return
        const next = normalizeConfig(preferences.shortcuts)
        setShortcutConfig(next)
        setAgentSystemPrompt(preferences.agentSystemPrompt)
        cacheShortcuts(next)
      })
      .catch(() => {
        if (!cancelled) setAgentSystemPrompt('')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = designs ?? []
    if (!needle) return all
    return all.filter((design) => design.name.toLowerCase().includes(needle))
  }, [designs, query])

  const newFile = async () => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await createDesign()
      await navigate({ to: '/app/design', search: { id: created.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be created')
      setCreating(false)
    }
  }

  const renameDesign = async () => {
    const target = renameTarget
    const name = renameName.trim()
    if (!target || !name || renaming) return
    setRenaming(true)
    try {
      const renamed = await orpc.canvas.rename({
        designId: target.id,
        name,
        expectedRevision: target.revision,
      })
      setDesigns((current) =>
        (current ?? [])
          .map((design) =>
            design.id === target.id
              ? { ...design, name, revision: renamed.revision, updatedAt: Date.now() }
              : design,
          )
          .sort(byRecent),
      )
      setRenameTarget(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The file could not be renamed'
      setError(
        message.includes('MIGRATION_REQUIRED')
          ? 'Open this file once so it upgrades to Canvas V2, then rename it.'
          : message,
      )
      setRenameTarget(null)
    } finally {
      setRenaming(false)
    }
  }

  const deleteDesign = async () => {
    const target = deleteTarget
    if (!target || deleting) return
    setDeleting(true)
    try {
      await orpc.design.delete({ id: target.id })
      setDesigns((current) => (current ?? []).filter((design) => design.id !== target.id))
      setDeleteTarget(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be deleted')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const signOut = async () => {
    // Do not leave one Loora account's ChatGPT cookie available after switching users.
    clearWelcomeSeen()
    await fetch('/api/chatgpt/logout', { method: 'POST' }).catch(() => undefined)
    await authClient.signOut()
  }

  const accountName = session?.user.name ?? session?.user.email ?? 'Account'

  return (
    <div className="flex h-screen min-h-0 bg-cx-canvas text-foreground">
      <aside className="hidden w-56 shrink-0 flex-col border-e bg-background/60 md:flex">
        <div className="p-2">
          <AccountMenu
            name={accountName}
            onSettings={() => setSettingsOpen(true)}
            onSignOut={() => void signOut()}
          />
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          <span
            aria-current="page"
            className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1.5 text-sm font-medium"
          >
            <ClockIcon className="size-4 text-muted-foreground" />
            Recents
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
            Settings
          </button>
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-wrap items-center gap-3 px-6 pt-6 pb-4">
          <div className="md:hidden">
            <AccountMenu
              compact
              name={accountName}
              onSettings={() => setSettingsOpen(true)}
              onSignOut={() => void signOut()}
            />
          </div>
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">Recents</h1>
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            <Button
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
            >
              <LayoutGridIcon />
            </Button>
            <Button
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="List view"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              <ListIcon />
            </Button>
          </div>
          <div className="relative w-56">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              aria-label="Search files"
              placeholder="Search recents"
              className="ps-6"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button onClick={() => void newFile()} disabled={creating}>
            {creating ? <Spinner /> : <FilePlus2Icon />}
            New file
          </Button>
        </header>

        {error ? (
          <div className="mx-6 mb-4 rounded-lg border border-destructive/32 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 px-6 pb-10">
          {designs === null ? (
            <p className="cx-shimmer text-sm">Loading your files…</p>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-16 text-center">
              <p className="text-sm font-medium">
                {designs.length === 0 ? 'No design files yet' : 'No files match that search'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {designs.length === 0
                  ? 'Start a file and the agent builds on the canvas with you.'
                  : 'Try a different name.'}
              </p>
              {designs.length === 0 ? (
                <Button className="mt-4" onClick={() => void newFile()} disabled={creating}>
                  {creating ? <Spinner /> : <FilePlus2Icon />}
                  New file
                </Button>
              ) : null}
            </div>
          ) : view === 'grid' ? (
            <div
              className={cn(
                'grid gap-4',
                'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
              )}
            >
              {visible.map((design) => (
                <FileCard
                  key={design.id}
                  design={design}
                  onRename={() => {
                    setRenameName(design.name)
                    setRenameTarget(design)
                  }}
                  onDelete={() => setDeleteTarget(design)}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {visible.map((design) => (
                <FileRow
                  key={design.id}
                  design={design}
                  onRename={() => {
                    setRenameName(design.name)
                    setRenameTarget(design)
                  }}
                  onDelete={() => setDeleteTarget(design)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              The structured document and its generated output use this name.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              value={renameName}
              aria-label="File name"
              onChange={(event) => setRenameName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && renameName.trim()) void renameDesign()
              }}
            />
          </DialogPanel>
          <DialogFooter>
            <Button disabled={!renameName.trim() || renaming} onClick={() => void renameDesign()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This removes Main, every branch, history, chats, and public links. It cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void deleteDesign()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogPopup showCloseButton={false} className="h-[min(70svh,36rem)] overflow-hidden p-0">
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            shortcutConfig={shortcutConfig}
            onShortcutConfigChange={(next) => {
              const normalized = normalizeConfig(next)
              setShortcutConfig(normalized)
              cacheShortcuts(normalized)
              void orpc.preferences.save({ shortcuts: normalized }).catch(() => undefined)
            }}
            agentSystemPrompt={agentSystemPrompt}
            onSaveAgentSystemPrompt={async (prompt) => {
              const saved = await orpc.preferences.saveAgentPrompt({ prompt })
              setAgentSystemPrompt(saved.agentSystemPrompt)
            }}
          />
        </DialogPopup>
      </Dialog>
    </div>
  )
}
