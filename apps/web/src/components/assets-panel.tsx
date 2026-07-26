import { useEffect, useRef, useState } from 'react'
import { ImagePlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { orpc } from '#/lib/orpc-client'
import { cn } from '#/lib/utils'

export interface AssetMeta {
  id: string
  name: string
  mediaType: string
  size: number
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  return dataUrl.split(',')[1]
}

export function AssetsPanel({
  onInsert,
}: {
  onInsert: (asset: AssetMeta) => void
}) {
  const [assets, setAssets] = useState<AssetMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    orpc.asset
      .list()
      .then((items) => {
        if (!cancelled) setAssets(items)
      })
      .catch((cause) => {
        console.error('[assets] Failed to list assets:', cause)
        if (!cancelled) setError('Could not load assets.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        const saved = await orpc.asset.upload({
          name: file.name,
          mediaType: file.type,
          data: await fileToBase64(file),
        })
        setAssets((current) => [saved, ...current])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const remove = (id: string) => {
    setAssets((current) => current.filter((asset) => asset.id !== id))
    void orpc.asset
      .delete({ id })
      .catch((cause) =>
        console.error('[assets] Failed to delete asset:', cause),
      )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Assets</h2>
          <p className="text-xs text-muted-foreground">
            Click an image to place it in the selected V2 container.
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlusIcon data-slot="icon" />
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => void upload(event.target.files)}
        />
      </div>

      {error ? (
        <p className="text-xs text-destructive-foreground">{error}</p>
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
      ) : assets.length === 0 ? (
        <button
          type="button"
          className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-dashed border-black/15 text-sm text-muted-foreground hover:bg-secondary/50"
          onClick={() => fileInputRef.current?.click()}
        >
          No assets yet — drop in some images.
        </button>
      ) : (
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 overflow-y-auto">
          {assets.map((asset) => (
            <div key={asset.id} className="group relative">
              <button
                type="button"
                className={cn(
                  'block w-full overflow-hidden rounded-lg border border-black/12 bg-white outline-none',
                  'hover:border-cx-accent focus-visible:ring-2 focus-visible:ring-ring',
                )}
                title={`Place ${asset.name}`}
                onClick={() => onInsert(asset)}
              >
                <img
                  src={`/api/asset/${asset.id}`}
                  alt={asset.name}
                  className="aspect-square w-full object-contain"
                  loading="lazy"
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
              <Button
                variant="outline"
                size="icon"
                aria-label={`Delete ${asset.name}`}
                className="absolute top-1 right-1 size-6 opacity-0 shadow-sm group-hover:opacity-100"
                onClick={() => remove(asset.id)}
              >
                <Trash2Icon data-slot="icon" className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
