import { usePalette } from '#/components/landing/palette'
import {
  CodeIcon,
  ImageIcon,
  MousePointer2Icon,
  Share2Icon,
  SquareIcon,
  TypeIcon,
} from '@loora/ui/icons'

/**
 * The editor around the canvas. Static on purpose — it frames the demo so the
 * canvas reads as a real tool rather than a floating illustration, and the only
 * thing that should be moving is the work happening inside it.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const palette = usePalette()
  const tools = [MousePointer2Icon, SquareIcon, ImageIcon, TypeIcon, CodeIcon]

  return (
    <div className="overflow-hidden border border-border bg-card">
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <img src="/logo192.png" alt="" width={20} height={20} className="size-5 rounded-full" />
          <span className="text-[13px] font-semibold tracking-[-0.02em]">
            loora<span style={{ color: palette.accent }}>.</span>
          </span>
        </div>

        <div className="hidden items-center gap-0.5 border border-border p-0.5 sm:flex">
          {tools.map((Tool, index) => (
            <span
              key={index}
              className="flex size-6 items-center justify-center"
              style={
                index === 0
                  ? { background: palette.accent, color: palette.accentInk }
                  : { color: 'var(--color-muted-foreground)' }
              }
            >
              <Tool className="size-3.5" strokeWidth={1.75} />
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 border border-border px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex">
            <Share2Icon className="size-3" strokeWidth={1.75} />
            Share
          </span>
          <span
            className="flex size-6 items-center justify-center rounded-full text-[10px] font-medium"
            style={{ background: palette.accent, color: palette.accentInk }}
          >
            L
          </span>
        </div>
      </div>

      <div className="flex">
        <aside className="hidden w-[132px] shrink-0 flex-col gap-0.5 border-r border-border p-2 lg:flex">
          <p className="px-1.5 pb-1 font-mono text-[9px] text-muted-foreground/70">layers</p>
          {['header', 'hero', 'pricing', 'footer'].map((layer, index) => (
            <span
              key={layer}
              className="px-1.5 py-1 text-[11px]"
              style={
                index === 1
                  ? { background: palette.accentSoft, color: palette.accent }
                  : { color: 'var(--color-muted-foreground)' }
              }
            >
              {layer}
            </span>
          ))}
        </aside>

        <div className="relative min-w-0 flex-1">{children}</div>

        <aside className="hidden w-[152px] shrink-0 flex-col gap-3 border-l border-border p-2 lg:flex">
          <p className="px-1.5 font-mono text-[9px] text-muted-foreground/70">properties</p>
          {[
            { label: 'layout', fields: ['W 1280', 'H auto'] },
            { label: 'spacing', fields: ['48'] },
            { label: 'type', fields: ['Archivo', '64 / bold'] },
          ].map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-1.5 text-[10px] text-muted-foreground/70">{group.label}</p>
              <div className="flex flex-wrap gap-1">
                {group.fields.map((field) => (
                  <span
                    key={field}
                    className="border border-border px-1.5 py-1 font-mono text-[9px] text-muted-foreground"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <p className="px-1.5 text-[10px] text-muted-foreground/70">fill</p>
            <span className="flex items-center gap-1.5 border border-border px-1.5 py-1 font-mono text-[9px] text-muted-foreground">
              <span
                className="size-2.5 border border-border"
                style={{ background: palette.accent }}
              />
              {palette.accent}
            </span>
          </div>
        </aside>
      </div>
    </div>
  )
}
