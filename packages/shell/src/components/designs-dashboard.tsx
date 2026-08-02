import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  EllipsisIcon,
  FileCode2Icon,
  FilePlus2Icon,
  ListIcon,
  PencilIcon,
  Trash2Icon,
} from '@loora/ui/icons'
import {
  LayoutGridIcon,
  SearchIcon,
  XIcon,
} from '@loora/ui/icons'
import { authClient } from '@loora/auth/client'
import {
  AppAccountMenu,
  AppNavigation,
} from './app-navigation'
import { DesignThumbnail } from './design-thumbnail'
import { AppSettingsDialog } from './settings-dialog'
import { StatusBadge } from './status-badge'
import { UpgradeToProButton } from '@loora/editor/upgrade-to-pro'
import { clearWelcomeSeen } from './welcome-dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@loora/ui/dropdown-menu'
import { Input } from '@loora/ui/input'
import { Skeleton } from '@loora/ui/skeleton'
import { Spinner } from '@loora/ui/spinner'
import { orpc } from '@loora/rpc/client'
import { createDesign, relativeTime, type DesignSummary } from '@loora/editor/lib/designs'
import { formatChord } from '@loora/editor/lib/shortcuts'
import { cn } from '@loora/ui/utils'

const VIEW_STORAGE_KEY = 'loora:files-view'

type FilesView = 'grid' | 'list'

function initialView(): FilesView {
  if (typeof window === 'undefined') return 'grid'
  return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
}

interface SharedDesign {
  id: string
  name: string
  ownerUserId: string
  ownerName: string | null
  ownerEmail: string | null
  role: 'view' | 'edit'
  updatedAt: number
}

function byRecent(left: DesignSummary, right: DesignSummary) {
  return right.updatedAt - left.updatedAt
}

/** Platform-correct label for the search binding below (`⌘F` / `Ctrl+F`). */
function searchHint() {
  return formatChord({ key: 'f', meta: true })
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
            'flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground',
            className,
          )}
        >
          <EllipsisIcon className="size-3" />
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
    <div className="group relative flex flex-col gap-2 rounded-md bg-surface p-1.5 shadow-panel transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-panel-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <Link
        to="/design/$id"
        params={{ id: design.id }}
        aria-label={`Open ${design.name}`}
        className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      />
      <div className="pointer-events-none aspect-[4/3] overflow-hidden rounded-sm bg-cx-canvas shadow-panel">
        <DesignThumbnail designId={design.id} revision={design.revision} />
      </div>
      <div className="pointer-events-none min-w-0 px-0.5 pb-0.5">
        <p className="truncate text-xs font-medium leading-tight">
          {design.name}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          Edited {relativeTime(design.updatedAt)}
        </p>
      </div>
      <FileActions
        name={design.name}
        onRename={onRename}
        onDelete={onDelete}
        className="absolute end-2 top-2 bg-surface opacity-0 shadow-panel transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
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
    <div className="group relative flex items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-b-0 transition-colors hover:bg-surface-2">
      <Link
        to="/design/$id"
        params={{ id: design.id }}
        aria-label={`Open ${design.name}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
      />
      <div className="pointer-events-none size-7 shrink-0 overflow-hidden rounded-sm bg-cx-canvas shadow-panel">
        <DesignThumbnail designId={design.id} revision={design.revision} />
      </div>
      <p className="pointer-events-none min-w-0 flex-1 truncate text-xs font-medium">
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

const GRID_CLASSES = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'

/**
 * Placeholders in the shape of the real thing, so the first render does not
 * jump from one line of text into a full grid.
 */
function FilesLoading({ view }: { view: FilesView }) {
  const rows = Array.from({ length: view === 'grid' ? 8 : 6 }, (_, index) => index)
  if (view === 'list') {
    return (
      <div className="overflow-hidden rounded-lg bg-surface shadow-panel" aria-busy="true">
        {rows.map((row) => (
          <div key={row} className="flex items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-b-0">
            <Skeleton className="size-7 shrink-0 rounded-sm" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={GRID_CLASSES} aria-busy="true">
      {rows.map((row) => (
        <div key={row} className="flex flex-col gap-2 rounded-md bg-surface p-1.5 shadow-panel">
          <Skeleton className="aspect-[4/3] w-full rounded-sm" />
          <div className="flex flex-col gap-1 px-0.5 pb-0.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The file browser at `/app`. It owns creation, rename, and deletion; the
 * canvas itself lives at `/design/:id` and is never mounted from here.
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
  const [shared, setShared] = useState<SharedDesign[]>([])

  const loadDesigns = useCallback(async () => {
    setError(null)
    setDesigns(null)
    // The two lists are independent: somebody whose own plan has lapsed still
    // reaches the files other people shared with them.
    const [own, invited] = await Promise.allSettled([
      orpc.design.list(),
      orpc.design.listShared(),
    ])
    if (own.status === 'fulfilled') {
      setDesigns([...own.value].sort(byRecent))
    } else {
      setDesigns([])
      if (invited.status !== 'fulfilled' || invited.value.length === 0) {
        setError(
          own.reason instanceof Error
            ? own.reason.message
            : 'Your files could not be loaded',
        )
      }
    }
    setShared(invited.status === 'fulfilled' ? invited.value : [])
  }, [])

  useEffect(() => {
    void loadDesigns()
  }, [loadDesigns])

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
      await navigate({ to: '/design/$id', params: { id: created.id } })
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
        message.includes('UNSUPPORTED_CANVAS')
          ? 'This file uses an unsupported legacy Canvas format.'
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
    clearWelcomeSeen()
    await authClient.signOut()
  }

  const accountName = session?.user?.name ?? session?.user?.email ?? 'Account'

  return (
    <div className="flex h-screen min-h-0 bg-cx-canvas text-foreground">
      <aside className="hidden w-48 shrink-0 flex-col border-e border-line bg-surface md:flex">
        <Link to="/app" className="flex h-10 shrink-0 items-center gap-2 px-3">
          <img
            src="/logo192.png"
            alt=""
            width={16}
            height={16}
            className="size-4 shrink-0 rounded-sm"
          />
          <span className="text-xs font-semibold tracking-tight">loora</span>
        </Link>
        <AppNavigation
          active="recents"
          onSettings={() => setSettingsOpen(true)}
        />
        <div className="mt-auto flex flex-col gap-2 border-t border-line p-2">
          <StatusBadge className="-mb-1" />
          <UpgradeToProButton fullWidth size="sm" />
          <AppAccountMenu
            name={accountName}
            onSettings={() => setSettingsOpen(true)}
            onSignOut={() => void signOut()}
          />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-10 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 md:px-4">
          <div className="md:hidden">
            <AppAccountMenu
              compact
              name={accountName}
              onSettings={() => setSettingsOpen(true)}
              onSignOut={() => void signOut()}
            />
          </div>
          <h1 className="flex-1 text-sm font-semibold tracking-tight">
            Recents
          </h1>
          <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
            <Button
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              size="icon-xs"
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
            >
              <LayoutGridIcon />
            </Button>
            <Button
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="icon-xs"
              aria-label="List view"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              <ListIcon />
            </Button>
          </div>
          <div className="relative w-44">
            <SearchIcon className="pointer-events-none absolute start-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              aria-label="Search files"
              placeholder="Search recents"
              className="rounded-sm bg-surface-2 text-start [&_[data-slot=input]]:pe-8 [&_[data-slot=input]]:ps-7 [&_[data-slot=input]]:text-start"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {/* The ⌘F binding above is invisible otherwise; the hint retires
                once there is a query, where it would sit under the text. */}
            {query ? null : (
              <kbd className="pointer-events-none absolute end-1.5 top-1/2 z-10 -translate-y-1/2 rounded-sm border border-line px-1 text-2xs leading-4 text-muted-foreground">
                {searchHint()}
              </kbd>
            )}
          </div>
          <Button onClick={() => void newFile()} disabled={creating}>
            {creating ? <Spinner /> : <FilePlus2Icon />}
            New file
          </Button>
        </header>

        {error ? (
          <div className="mx-4 mt-4 flex items-center gap-2 rounded-md border border-destructive/32 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground md:mx-5">
            <span className="min-w-0 flex-1">{error}</span>
            <Button size="xs" variant="outline" onClick={() => void loadDesigns()}>
              Try again
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={() => setError(null)}>
              <XIcon />
            </Button>
          </div>
        ) : null}

        {shared.length > 0 ? (
          <section className="px-4 pt-4 md:px-4">
            <h2 className="mb-2 px-0.5 text-xs font-medium text-muted-foreground">
              Shared with me
            </h2>
            <div className="overflow-hidden rounded-lg bg-surface shadow-panel">
              {shared.map((entry) => (
                <Link
                  key={`${entry.ownerUserId}:${entry.id}`}
                  to="/design/$id"
                  params={{ id: entry.id }}
                  className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-accent/50"
                >
                  <FileCode2Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {entry.name}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {entry.ownerName || entry.ownerEmail}
                  </span>
                  <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs text-muted-foreground">
                    {entry.role === 'edit' ? 'Can edit' : 'Can view'}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
                    {relativeTime(entry.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className="min-h-0 flex-1 px-4 pt-4 pb-8 md:px-4">
          {designs === null ? (
            <FilesLoading view={view} />
          ) : visible.length === 0 ? (
            <div className="rounded-md border border-dashed border-line bg-surface px-4 py-12 text-center">
              <p className="text-sm font-medium">
                {designs.length === 0 ? 'No design files yet' : 'No files match that search'}
              </p>
              <p className="mx-auto mt-1.5 max-w-xs text-xs text-muted-foreground">
                {designs.length === 0
                  ? 'Start a file and open it on the canvas.'
                  : 'Try a different name.'}
              </p>
              {designs.length === 0 ? (
                <Button className="mt-5" onClick={() => void newFile()} disabled={creating}>
                  {creating ? <Spinner /> : <FilePlus2Icon />}
                  New file
                </Button>
              ) : null}
            </div>
          ) : view === 'grid' ? (
            <div className={GRID_CLASSES}>
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
            <div className="overflow-hidden rounded-lg bg-surface shadow-panel">
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

      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
