import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ImagePlusIcon,
  LinkIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { orpc } from '#/lib/orpc-client'
import { relativeTime } from '#/lib/designs'
import { cn } from '#/lib/utils'

export interface AssetMeta {
  id: string
  name: string
  mediaType: string
  size: number
  /** Upload time in ms; absent on older payloads. */
  at?: number
}

/** Payload a canvas drop reads to place an asset it was handed. */
export const ASSET_DRAG_TYPE = 'application/x-loora-asset'

/** Matches the server cap, so an oversized file is refused before it is read. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024

type SortKey = 'newest' | 'name' | 'size'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  return dataUrl.split(',')[1] ?? ''
}

/** Rejects what the server would reject anyway, with a reason worth reading. */
function rejection(file: File) {
  if (!file.type.startsWith('image/')) return `${file.name} is not an image`
  if (file.size > MAX_ASSET_BYTES) {
    return `${file.name} is ${formatSize(file.size)}; the limit is 5 MB`
  }
  return null
}

export function AssetsPanel({
  onInsert,
  usage,
}: {
  onInsert: (asset: AssetMeta) => void
  /** How many nodes reference each asset, so a delete can warn first. */
  usage?: Record<string, number>
}) {
  const [assets, setAssets] = useState<AssetMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [dropping, setDropping] = useState(false)
  const [pending, setPending] = useState<AssetMeta | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    let cancelled = false
    orpc.asset
      .list()
      .then((items) => {
        if (!cancelled) setAssets(items)
      })
      .catch((cause) => {
        console.error('[assets] Failed to list assets:', cause)
        if (!cancelled) setErrors(['Could not load assets.'])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const upload = async (files: File[]) => {
    const candidates = files.filter((file) => file.size > 0)
    if (candidates.length === 0) return
    const refused = candidates.map(rejection).filter((reason): reason is string => !!reason)
    const accepted = candidates.filter((file) => !rejection(file))
    setErrors(refused)
    if (accepted.length === 0) return

    setProgress({ done: 0, total: accepted.length })
    for (const [index, file] of accepted.entries()) {
      try {
        const saved = await orpc.asset.upload({
          name: file.name,
          mediaType: file.type,
          data: await fileToBase64(file),
        })
        setAssets((current) => [{ ...saved, at: Date.now() }, ...current])
      } catch (cause) {
        setErrors((current) => [
          ...current,
          `${file.name}: ${cause instanceof Error ? cause.message : 'upload failed'}`,
        ])
      }
      setProgress({ done: index + 1, total: accepted.length })
    }
    setProgress(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Dropping images anywhere on the panel uploads them; the empty state has
  // been promising exactly that.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      dragDepth.current += 1
      setDropping(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDropping(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      dragDepth.current = 0
      setDropping(false)
      void upload([...event.dataTransfer.files])
    }
    root.addEventListener('dragenter', onDragEnter)
    root.addEventListener('dragover', onDragOver)
    root.addEventListener('dragleave', onDragLeave)
    root.addEventListener('drop', onDrop)
    return () => {
      root.removeEventListener('dragenter', onDragEnter)
      root.removeEventListener('dragover', onDragOver)
      root.removeEventListener('dragleave', onDragLeave)
      root.removeEventListener('drop', onDrop)
    }
  }, [])

  // Pasting a screenshot while the panel is open uploads it too.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      void upload(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const remove = (asset: AssetMeta) => {
    setAssets((current) => current.filter((item) => item.id !== asset.id))
    setPending(null)
    void orpc.asset.delete({ id: asset.id }).catch((cause) => {
      console.error('[assets] Failed to delete asset:', cause)
      setErrors((current) => [...current, `${asset.name} could not be deleted.`])
      setAssets((current) => [asset, ...current])
    })
  }

  const copyUrl = async (asset: AssetMeta) => {
    const url = `${window.location.origin}/api/asset/${asset.id}`
    try {
      await navigator.clipboard?.writeText(url)
      setCopied(asset.id)
      window.setTimeout(() => setCopied(null), 1_500)
    } catch {
      setErrors((current) => [...current, 'The link could not be copied.'])
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? assets.filter((asset) => asset.name.toLowerCase().includes(needle))
      : assets
    return [...filtered].sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name)
      if (sort === 'size') return right.size - left.size
      return (right.at ?? 0) - (left.at ?? 0)
    })
  }, [assets, query, sort])

  const totalSize = assets.reduce((sum, asset) => sum + asset.size, 0)
  const pendingUsage = pending ? usage?.[pending.id] ?? 0 : 0

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col gap-3 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Assets</h2>
          <p className="text-xs text-muted-foreground">
            Click an image to place it, or drop files anywhere here.
          </p>
        </div>
        <div className="relative w-44">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search assets"
            placeholder="Search"
            className="ps-6"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="Sort assets"
          value={sort}
          className="h-7 rounded-md border bg-background px-2 text-xs outline-none"
          onChange={(event) => setSort(event.target.value as SortKey)}
        >
          <option value="newest">Newest</option>
          <option value="name">Name</option>
          <option value="size">Largest</option>
        </select>
        <Button
          size="sm"
          disabled={progress !== null}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlusIcon data-slot="icon" />
          {progress ? `Uploading ${progress.done}/${progress.total}` : 'Upload'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => void upload([...(event.target.files ?? [])])}
        />
      </div>

      {errors.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-destructive-foreground">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3"
          aria-busy="true"
          aria-label="Loading assets"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <button
          type="button"
          className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-secondary/50"
          onClick={() => fileInputRef.current?.click()}
        >
          {assets.length === 0
            ? 'No assets yet — drop in some images.'
            : 'No assets match that search.'}
        </button>
      ) : (
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 overflow-y-auto">
          {visible.map((asset) => {
            const used = usage?.[asset.id] ?? 0
            return (
              <div key={asset.id} className="group relative">
                <button
                  type="button"
                  draggable
                  className={cn(
                    'block w-full cursor-grab overflow-hidden rounded-lg border bg-white outline-none',
                    'hover:border-cx-accent focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  title={`Place ${asset.name}`}
                  onClick={() => onInsert(asset)}
                  onDragStart={(event) => {
                    // The canvas reads the structured payload; the URL is there
                    // for anything else the file lands on.
                    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(asset))
                    event.dataTransfer.setData(
                      'text/plain',
                      `${window.location.origin}/api/asset/${asset.id}`,
                    )
                    event.dataTransfer.effectAllowed = 'copy'
                    const image = event.currentTarget.querySelector('img')
                    if (image) event.dataTransfer.setDragImage(image, 24, 24)
                  }}
                  style={{
                    // Transparent art needs something behind it to read against.
                    backgroundImage:
                      'linear-gradient(45deg,#0000000d 25%,transparent 25%,transparent 75%,#0000000d 75%),linear-gradient(45deg,#0000000d 25%,transparent 25%,transparent 75%,#0000000d 75%)',
                    backgroundSize: '12px 12px',
                    backgroundPosition: '0 0, 6px 6px',
                  }}
                >
                  <img
                    src={`/api/asset/${asset.id}`}
                    alt={asset.name}
                    className="aspect-square w-full object-contain"
                    loading="lazy"
                    onLoad={(event) =>
                      setDimensions((current) =>
                        current[asset.id]
                          ? current
                          : {
                              ...current,
                              [asset.id]: `${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`,
                            },
                      )
                    }
                  />
                </button>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span
                    className="min-w-0 truncate text-[11px] text-muted-foreground"
                    title={asset.name}
                  >
                    {asset.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {formatSize(asset.size)}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                  {dimensions[asset.id] ? <span>{dimensions[asset.id]}</span> : null}
                  {asset.at ? <span>{relativeTime(asset.at)}</span> : null}
                  {used > 0 ? (
                    <span className="ms-auto rounded bg-secondary px-1 text-foreground/70">
                      {used} use{used === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
                <div className="absolute end-1 top-1 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Copy link to ${asset.name}`}
                    title={copied === asset.id ? 'Copied' : 'Copy link'}
                    className="size-6 shadow-sm"
                    onClick={() => void copyUrl(asset)}
                  >
                    <LinkIcon data-slot="icon" className="size-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Delete ${asset.name}`}
                    className="size-6 shadow-sm"
                    onClick={() => setPending(asset)}
                  >
                    <Trash2Icon data-slot="icon" className="size-3" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {assets.length > 0 ? (
        <p className="shrink-0 text-[11px] text-muted-foreground">
          {assets.length} asset{assets.length === 1 ? '' : 's'} ·{' '}
          {formatSize(totalSize)}
        </p>
      ) : null}

      {dropping ? (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-cx-accent bg-cx-accent/8 text-sm font-medium">
          Drop images to upload
        </div>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{pending?.name}”?</DialogTitle>
            <DialogDescription>
              {pendingUsage > 0
                ? `This image is placed in ${pendingUsage} node${pendingUsage === 1 ? '' : 's'}. Those will render as broken images.`
                : 'This removes the file from your assets. It cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => pending && remove(pending)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
