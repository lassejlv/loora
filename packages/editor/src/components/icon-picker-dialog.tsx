import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@loora/ui/tabs'
import { Button } from '@loora/ui/button'
import {
  getIcons,
  type IconEntry,
  type IconLibraryId,
} from '../lib/icon-libraries'
import type { VectorDescriptor } from '../lib/svg-to-vector'

const PAGE_SIZE = 72

export function IconPickerDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (entry: IconEntry) => void
}) {
  const [library, setLibrary] = useState<IconLibraryId>('lucide')
  const [query, setQuery] = useState('')
  const reduceMotion = useReducedMotion()

  const icons = useMemo(() => {
    const all = getIcons(library)
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((icon) => icon.name.toLowerCase().includes(q))
  }, [library, query])

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const visible = icons.slice(0, visibleCount)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Load the next page whenever the sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!open || !sentinel || visibleCount >= icons.length) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => count + PAGE_SIZE)
      }
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [open, visibleCount, icons.length])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setQuery('')
          setVisibleCount(PAGE_SIZE)
        }
      }}
    >
      <DialogPopup className="max-w-2xl p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Insert icon</DialogTitle>
          <DialogDescription>
            Search {library === 'lucide' ? 'Lucide' : 'Hugeicons'} and insert an
            editable vector icon onto the canvas.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3 p-4">
          <Tabs
            value={library}
            onValueChange={(value) => {
              setLibrary(value as IconLibraryId)
              setVisibleCount(PAGE_SIZE)
            }}
          >
            <TabsList>
              <TabsTrigger value="lucide">Lucide</TabsTrigger>
              <TabsTrigger value="hugeicons">Hugeicons</TabsTrigger>
            </TabsList>
            <TabsContent value={library} />
          </Tabs>
          <Input
            aria-label="Search icons"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setVisibleCount(PAGE_SIZE)
            }}
            placeholder="Search icons…"
          />
          <div className="h-[min(50svh,24rem)] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No icons match “{query}”.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1">
                {visible.map((icon, index) => (
                  <motion.button
                    key={icon.id}
                    type="button"
                    title={icon.name}
                    className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    // Only newly mounted icons animate — React keeps the ones
                    // already on screen, so a loaded page fades in on its own.
                    initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      duration: reduceMotion ? 0.12 : 0.18,
                      ease: [0.4, 0, 0.2, 1],
                      delay: reduceMotion ? 0 : ((index % PAGE_SIZE) % 12) * 0.012,
                    }}
                    onClick={() => {
                      onInsert(icon)
                      onOpenChange(false)
                    }}
                  >
                    {icon.render(22)}
                  </motion.button>
                ))}
              </div>
            )}
            {visibleCount < icons.length ? (
              <div
                ref={sentinelRef}
                aria-hidden="true"
                className="h-px"
              />
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter className="border-t px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

export type { VectorDescriptor }