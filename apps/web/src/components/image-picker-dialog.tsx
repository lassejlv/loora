import { useEffect } from 'react'
import { AssetsPanel, type AssetMeta } from '#/components/assets-panel'

// Fullscreen overlay wrapping the assets panel — opened when the user clicks
// an image in an edit-mode frame to swap it for another asset.
export function ImagePickerDialog({
  onPick,
  onClose,
}: {
  onPick: (asset: AssetMeta) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Replace image"
        className="flex h-[min(70svh,32rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Replace image</p>
          <button
            type="button"
            aria-label="Close"
            className="rounded px-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <AssetsPanel onInsert={onPick} />
        </div>
      </div>
    </div>
  )
}
