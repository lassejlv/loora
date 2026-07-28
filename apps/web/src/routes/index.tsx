import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react'
import {
  CodeIcon,
  ImageIcon,
  MousePointer2Icon,
  Share2Icon,
  SquareIcon,
  TypeIcon,
} from 'lucide-react'
import { MoonIcon, SunIcon } from '#/components/icons'
import {
  getThemePreference,
  setThemePreference,
  watchSystemTheme,
  type ThemePreference,
} from '#/lib/theme'

export const Route = createFileRoute('/')({
  ssr: false,
  // The editor used to live here; legacy `/?design=…` links still land on `/`.
  beforeLoad: ({ search }) => {
    const params = search as Record<string, unknown>
    const id =
      typeof params.design === 'string'
        ? params.design
        : typeof params.d === 'string'
          ? params.d
          : null
    if (!id) return
    throw redirect({
      to: '/app/design',
      search: {
        id,
        draft: typeof params.draft === 'string' ? params.draft : undefined,
      },
    })
  },
  head: () => ({
    meta: [
      { title: 'loora — The agent design harness' },
      {
        name: 'description',
        content:
          'An infinite canvas of real, structured UI — open to your own agent over MCP. Design in the browser, drive it from your editor, ship the design.',
      },
      { property: 'og:title', content: 'loora — The agent design harness' },
      {
        property: 'og:description',
        content:
          'An infinite canvas of real, structured UI — open to your own agent over MCP. Design in the browser, drive it from your editor, ship the design.',
      },
      { property: 'og:image', content: '/landing-cover.png' },
    ],
  }),
  component: LandingPage,
})

const PANEL = 'bg-cx-canvas'

type Palette = {
  accent: string
  accentSoft: string
  accentFaint: string
  accentWire: string
  wireStrong: string
  wireMid: string
  wireSoft: string
  surface: string
  tint: string
  line: string
  dot: string
  page: string
  ok: string
  dotAccent: string
  glow: string
  /** Text that sits on the accent — dark mode's accent is light, so it isn't white. */
  accentInk: string
}

const LIGHT: Palette = {
  accent: '#1e3dea',
  accentSoft: 'rgba(30,61,234,0.10)',
  accentFaint: 'rgba(30,61,234,0.05)',
  accentWire: 'rgba(30,61,234,0.35)',
  wireStrong: '#c6c6c6',
  wireMid: '#d2d2d2',
  wireSoft: '#dedede',
  surface: '#ffffff',
  tint: '#f4f4f2',
  line: '#e4e4e2',
  dot: '#d3d1c9',
  page: '#fafaf8',
  ok: '#059669',
  dotAccent: 'rgba(30,61,234,0.34)',
  // Neutral on purpose: an accent-tinted wash reads as a blue shadow behind the hero.
  glow: 'rgba(26,25,23,0.05)',
  accentInk: '#ffffff',
}

const DARK: Palette = {
  accent: '#1e3dea',
  accentSoft: 'rgba(30,61,234,0.14)',
  accentFaint: 'rgba(30,61,234,0.07)',
  accentWire: 'rgba(30,61,234,0.40)',
  wireStrong: '#5a5a5f',
  wireMid: '#47474c',
  wireSoft: '#343438',
  surface: '#19191b',
  tint: '#1f1f21',
  line: '#343436',
  dot: '#29292c',
  page: '#0f0f11',
  ok: '#34d399',
  dotAccent: 'rgba(30,61,234,0.40)',
  glow: 'rgba(227,228,230,0.05)',
  accentInk: '#ffffff',
}

const PaletteContext = createContext<Palette>(LIGHT)

const usePalette = () => useContext(PaletteContext)

/** Tracks the `dark` class so the mocks re-render with matching colours. */
function useThemePalette(): Palette {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark ? DARK : LIGHT
}


/**
 * Drives a looping storyboard: one duration per beat, advancing only while
 * `active` so an offscreen demo costs nothing. `lap` counts completed loops,
 * which is how the canvas demo rotates its example prompts.
 */
function useScriptedLoop(durations: readonly number[], active: boolean) {
  const [tick, setTick] = useState(0)
  const [lap, setLap] = useState(0)

  useEffect(() => {
    if (!active) return
    const id = setTimeout(() => {
      if (tick + 1 >= durations.length) {
        setLap((current) => current + 1)
        setTick(0)
      } else {
        setTick(tick + 1)
      }
    }, durations[tick])
    return () => clearTimeout(id)
  }, [tick, active, durations])

  return { tick, lap }
}

/* ------------------------------------------------------------------------- *
 * Canvas primitives.
 *
 * These recreate what the canvas actually looks like: elements are sharp-cornered
 * white rectangles on a dotted field, their contents are flat grey wireframe
 * blocks, and a selected element carries a blue outline with four 8px square
 * handles. Nothing here is rounded — rounding is for app chrome, not elements.
 * ------------------------------------------------------------------------- */

type WireTone = 'strong' | 'mid' | 'soft'

const WIRE_KEY = { strong: 'wireStrong', mid: 'wireMid', soft: 'wireSoft' } as const

function Wire({
  w,
  h = 10,
  tone = 'mid',
  className = '',
}: {
  w: string
  h?: number
  tone?: WireTone
  className?: string
}) {
  const palette = usePalette()
  return (
    <div className={className} style={{ width: w, height: h, background: palette[WIRE_KEY[tone]] }} />
  )
}

/** Streams a wireframe block in on a delay, the way generated code lands. */
function StreamWire({
  step,
  on,
  children,
}: {
  step: number
  on: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: on ? 1 : 0 }}
      transition={{ duration: 0.2, delay: on ? step * 0.1 : 0 }}
    >
      {children}
    </motion.div>
  )
}

function DotField({ y }: { y?: MotionValue<number> }) {
  const palette = usePalette()
  return (
    <motion.div
      aria-hidden="true"
      className="absolute inset-[-10%]"
      style={{
        backgroundImage: `radial-gradient(circle, ${palette.dot} 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
        y,
      }}
    />
  )
}

/** Four corner handles: element-surface fill, 1.5px accent stroke, square. */
function Handles() {
  const palette = usePalette()
  return (
    <>
      {(
        ['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'] as const
      ).map((pos) => (
        <motion.span
          key={pos}
          className={`absolute size-2 bg-card ${pos}`}
          style={{ border: `1.5px solid ${palette.accent}` }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * Example scenes. Each is the inside of one generated element.
 * ------------------------------------------------------------------------- */

/** The layout from the cover: nav row, rule, then a two-column hero. */
function HeroScene({ on, revised }: { on: boolean; revised: boolean }) {
  const palette = usePalette()
  return (
    <div className="flex h-full flex-col">
      <StreamWire step={0} on={on}>
        <div className="flex items-center justify-between px-[4%] py-[3.5%]">
          <span className="block size-[7%] min-h-3 min-w-3 rounded-full" style={{ background: palette.wireStrong }} />
          <div className="flex items-center gap-[3%]">
            {[0, 1, 2, 3].map((item) => (
              <Wire key={item} w="34px" h={9} tone="mid" />
            ))}
          </div>
          <Wire w="46px" h={16} tone="mid" />
        </div>
        <div className="h-px w-full" style={{ background: palette.line }} />
      </StreamWire>

      <div className="flex flex-1 items-center gap-[5%] px-[4%] py-[4%]">
        <div className="flex flex-1 flex-col gap-[7px]">
          <StreamWire step={1} on={on}>
            <Wire w={revised ? '62%' : '86%'} h={22} tone="strong" />
          </StreamWire>
          <StreamWire step={2} on={on}>
            <Wire w={revised ? '54%' : '76%'} h={12} />
          </StreamWire>
          <StreamWire step={3} on={on}>
            <Wire w="58%" h={12} />
          </StreamWire>
          <StreamWire step={4} on={on}>
            <div className="mt-[6px]">
              <Wire w="42%" h={18} tone="mid" />
            </div>
          </StreamWire>
        </div>
        <StreamWire step={5} on={on}>
          <div className="h-full w-full" style={{ minWidth: 64 }}>
            <div className="h-full w-full" style={{ background: palette.wireSoft, aspectRatio: '1 / 1' }} />
          </div>
        </StreamWire>
      </div>
    </div>
  )
}

function PricingScene({ on, revised }: { on: boolean; revised: boolean }) {
  const palette = usePalette()
  return (
    <div className="flex h-full flex-col gap-[3%] p-[4%]">
      <StreamWire step={0} on={on}>
        <Wire w="34%" h={16} tone="strong" />
      </StreamWire>
      <div className="grid flex-1 grid-cols-3 gap-[3%]">
        {[0, 1, 2].map((col) => (
          <motion.div
            key={col}
            className="flex flex-col gap-[6px] p-[8%]"
            initial={false}
            animate={{
              opacity: on ? 1 : 0,
              background: revised && col === 1 ? palette.accentFaint : palette.tint,
              boxShadow:
                revised && col === 1 ? `inset 0 0 0 1px ${palette.accent}` : `inset 0 0 0 1px ${palette.line}`,
            }}
            transition={{ duration: 0.28, delay: on ? 0.12 + col * 0.1 : 0 }}
          >
            <Wire w="70%" h={9} tone={revised && col === 1 ? 'strong' : 'mid'} />
            <Wire w="46%" h={16} tone="strong" />
            <div className="mt-auto flex flex-col gap-[4px]">
              <Wire w="100%" h={7} tone="soft" />
              <Wire w="80%" h={7} tone="soft" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function SettingsScene({ on, revised }: { on: boolean; revised: boolean }) {
  const palette = usePalette()
  return (
    <div className="flex h-full gap-[4%] p-[4%]">
      <div className="flex w-[28%] flex-col gap-[5px]">
        {[0, 1, 2, 3].map((row) => (
          <motion.div
            key={row}
            className="px-[8%] py-[6px]"
            initial={false}
            animate={{
              opacity: on ? 1 : 0,
              background: revised && row === 1 ? palette.accentSoft : 'transparent',
            }}
            transition={{ duration: 0.25, delay: on ? row * 0.07 : 0 }}
          >
            <Wire w="82%" h={8} tone={revised && row === 1 ? 'strong' : 'soft'} />
          </motion.div>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-[9px] border-l pl-[5%]" style={{ borderColor: palette.line }}>
        <StreamWire step={0} on={on}>
          <Wire w="44%" h={14} tone="strong" />
        </StreamWire>
        {[0, 1, 2].map((row) => (
          <StreamWire key={row} step={row + 1} on={on}>
            <div className="flex items-center justify-between">
              <Wire w="38%" h={9} />
              <Wire w="22%" h={14} tone="soft" />
            </div>
          </StreamWire>
        ))}
        <StreamWire step={4} on={on}>
          <div className="mt-auto flex justify-end">
            <Wire w="34%" h={16} tone="mid" />
          </div>
        </StreamWire>
      </div>
    </div>
  )
}

const EXAMPLES = [
  {
    prompt: 'a hero with a nav and an image on the right',
    name: 'hero',
    note: 'tighten the headline',
    Scene: HeroScene,
  },
  {
    prompt: 'pricing section, three tiers',
    name: 'pricing',
    note: 'make the middle one stand out',
    Scene: PricingScene,
  },
  {
    prompt: 'settings page with a sidebar',
    name: 'settings',
    note: 'highlight the active row',
    Scene: SettingsScene,
  },
] as const

/**
 * Scripted loop, one duration per beat: the request arrives over MCP, the tool
 * call runs, the frame lands, content streams in, selection settles, a comment
 * drops, the revision applies, hold — then the next example.
 */
const PHASES = [2200, 700, 600, 1600, 900, 1800, 1600, 1300]
const LAST_PHASE = PHASES.length - 1

/**
 * Where the pointer sits during each phase, in percent of the scene, so the loop
 * reads like a screen recording rather than things happening by themselves.
 * `click` marks the beats where it actually acts on something.
 */
const CURSOR_MARKS = [
  { x: 24, y: 72, click: false }, // idle on the canvas while the request lands
  { x: 40, y: 66, click: false },
  { x: 70, y: 60, click: false },
  { x: 72, y: 55, click: false },
  { x: 62, y: 30, click: true }, // select the frame
  { x: 56, y: 49, click: true }, // drop the comment
  { x: 66, y: 40, click: false },
  { x: 52, y: 70, click: false },
] as const

function RecordingCursor({ phase }: { phase: number }) {
  const palette = usePalette()
  const mark = CURSOR_MARKS[phase]
  return (
    <motion.div
      className="pointer-events-none absolute z-30"
      initial={false}
      animate={{ left: `${mark.x}%`, top: `${mark.y}%` }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <AnimatePresence>
        {mark.click && (
          <motion.span
            key={phase}
            className="absolute -left-2.5 -top-2.5 size-6 rounded-full"
            style={{ border: `1.5px solid ${palette.accent}` }}
            initial={{ opacity: 0.55, scale: 0.4 }}
            animate={{ opacity: 0, scale: 1.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <svg
        width="15"
        height="19"
        viewBox="0 0 15 19"
        fill="none"
        className="drop-shadow-[0_1px_2px_rgba(26,25,23,0.35)]"
      >
        <path
          d="M1 1L1 14.5L4.6 11.2L7.1 17L9.6 15.9L7.2 10.4L11.9 10.2L1 1Z"
          fill="#fff"
          stroke="#1a1917"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  )
}

function CanvasDemo({ reduceMotion }: { reduceMotion: boolean | null }) {
  const palette = usePalette()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.3 })
  const { tick, lap } = useScriptedLoop(PHASES, !reduceMotion && inView)
  const index = lap % EXAMPLES.length

  // Layered scroll drift, small and springless. Anchored at `start start` so the
  // scene sits exactly where it was authored when the page is at rest.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const enabled = !reduceMotion
  const dotsY = useTransform(scrollYProgress, [0, 1], enabled ? [0, 14] : [0, 0])
  const asideY = useTransform(scrollYProgress, [0, 1], enabled ? [0, 40] : [0, 0])
  const mainY = useTransform(scrollYProgress, [0, 1], enabled ? [0, -18] : [0, 0])

  // Reduced motion gets the finished frame and no timers at all.
  const phase = reduceMotion ? LAST_PHASE : tick
  const example = EXAMPLES[index]
  const { Scene } = example

  const working = phase >= 1 && phase < 4
  const framed = phase >= 2
  const streaming = phase >= 3
  const selected = phase >= 4
  const commented = phase >= 5
  const revised = phase >= 6

  return (
    <div ref={ref} className={`relative aspect-[4/3] w-full overflow-hidden ${PANEL} sm:aspect-[16/10]`}>
      <DotField y={dotsY} />

      {/* The unselected neighbour, as on the cover. */}
      <motion.div
        className="absolute left-[9%] top-[29%] h-[38%] w-[19%] border bg-card"
        style={{ y: asideY, borderColor: palette.line }}
      >
        <div className="flex flex-col gap-[8px] p-[9%]">
          <Wire w="80%" h={14} tone="strong" />
          <Wire w="66%" h={10} />
          <Wire w="46%" h={10} />
          <div className="mt-[6px] h-[52%] w-full" style={{ background: palette.wireSoft }} />
        </div>
      </motion.div>

      {/* The element being generated. */}
      <motion.div
        className="absolute left-[34%] top-[21%] h-[57%] w-[57%]"
        style={{ y: mainY }}
      >
        <AnimatePresence>
          {framed && (
            <motion.div
              key={`${index}-frame`}
              className="relative h-full w-full"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <AnimatePresence>
                {selected && (
                  <motion.span
                    className="absolute -top-6 left-0 rounded-md px-2 py-0.5 text-[11px] font-medium leading-tight sm:text-[13px]"
                    style={{ background: palette.accent, color: palette.accentInk }}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {example.name}
                  </motion.span>
                )}
              </AnimatePresence>

              <motion.div
                className="h-full w-full bg-card"
                animate={{ borderColor: selected ? palette.accent : palette.line }}
                transition={{ duration: 0.25 }}
                style={{ borderWidth: 1, borderStyle: 'solid' }}
              >
                <Scene on={streaming} revised={revised} />
              </motion.div>

              <AnimatePresence>{selected && <Handles />}</AnimatePresence>

              <AnimatePresence>
                {commented && (
                  <motion.div
                    className="absolute left-[38%] top-[44%] z-10 flex items-start gap-1.5"
                    initial={{ opacity: 0, scale: 0.8, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium shadow-sm"
                      style={{ background: palette.accent, color: palette.accentInk }}
                    >
                      1
                    </span>
                    <span className="whitespace-nowrap rounded-lg rounded-tl-sm border border-border bg-card px-2 py-1 text-[10px] leading-tight text-foreground shadow-sm sm:text-[11px]">
                      {example.note}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {!reduceMotion && <RecordingCursor phase={phase} />}

      {/* Live MCP request strip — the app's own chrome, so this one is rounded. */}
      <div className="absolute inset-x-4 bottom-4 z-20 sm:inset-x-auto sm:left-1/2 sm:w-[62%] sm:-translate-x-1/2">
        <AnimatePresence>
          {(working || revised) && (
            <motion.div
              className="mb-2 flex w-fit items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 shadow-sm"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.22 }}
            >
              <motion.span
                className="size-1.5 rounded-full"
                style={{ background: palette.accent }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.1, repeat: Infinity }}
              />
              <span className="font-mono text-[10px] leading-none" style={{ color: palette.accent }}>
                {revised ? 'patchNodes' : 'insertNodes'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 shadow-[0_1px_2px_rgba(26,25,23,0.05),0_8px_24px_-16px_rgba(26,25,23,0.3)]">
          <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase leading-none text-muted-foreground">
            mcp
          </span>
          <AnimatePresence mode="wait">
            <motion.p
              key={index}
              className="min-w-0 flex-1 truncate text-[12px] text-foreground sm:text-[13px]"
              initial={reduceMotion ? { opacity: 0 } : { clipPath: 'inset(0 100% 0 0)' }}
              animate={reduceMotion ? { opacity: 1 } : { clipPath: 'inset(0 0% 0 0)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.12 : 1.6, ease: 'linear' }}
            >
              {example.prompt}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/**
 * The editor around the canvas. Static on purpose — it frames the demo so the
 * canvas reads as a real tool rather than a floating illustration, and the only
 * thing that should be moving is the work happening inside it.
 */
function AppChrome({ children }: { children: React.ReactNode }) {
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

const FEATURES = [
  {
    product: 'MCP',
    description: 'Drive the canvas from Claude or Cursor without a browser.',
    href: 'https://mcp.loora.design',
    link: 'MCP server',
  },
  {
    product: 'Branches',
    description: 'Fork a design, work it out in isolation, merge when it is right.',
  },
  {
    product: 'GitHub',
    description: 'Give your agent read access to the real files behind a design.',
  },
  {
    product: 'Figma',
    description: 'Pull frames onto the canvas and keep going in live code.',
  },
  {
    product: 'History',
    description: 'Commit as you go, compare any two points, roll back.',
  },
  {
    product: 'Publish',
    description: 'Put a live element behind a public link, or share read-only.',
  },
] as const

/** Keep in sync with `SubscriptionScreen` / Polar products. */
const PLANS = [
  {
    plan: 'Pro',
    price: '$20',
    includes: 'Canvas, branches, MCP, exports, publish',
    note: '3-day free trial',
    cta: 'Start free trial',
  },
  {
    plan: 'Studio',
    price: '$49',
    includes: 'Pro plus higher publish bandwidth',
    note: 'For teams',
    cta: 'Choose Studio',
  },
] as const

function NavSep() {
  return <span className="select-none text-muted-foreground/40">|</span>
}

function LandingPage() {
  const reduceMotion = useReducedMotion()
  const palette = useThemePalette()
  const [theme, setTheme] = useState<ThemePreference>('system')

  // App shell locks body scroll for the canvas editor (`overflow: hidden` in
  // styles.css). Clearing the inline style is a no-op — the stylesheet still
  // wins. Force document scroll while this route is mounted, then restore.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'auto'
    body.style.overflow = 'auto'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [])

  useEffect(() => {
    setTheme(getThemePreference())
    return watchSystemTheme()
  }, [])

  const toggleTheme = () => {
    const dark = document.documentElement.classList.contains('dark')
    const pref: ThemePreference = dark ? 'light' : 'dark'
    setThemePreference(pref)
    setTheme(pref)
  }

  const link = { color: palette.accent }

  return (
    <PaletteContext.Provider value={palette}>
      <div className="min-h-dvh bg-background font-mono text-[14px] leading-[1.7] text-foreground antialiased">
        <header className="border-b border-border">
          <nav className="mx-auto flex h-12 w-full max-w-[720px] items-center justify-between px-5">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="flex items-center gap-2 font-semibold">
                <img src="/logo192.png" alt="" width={18} height={18} className="size-[18px]" />
                loora
              </span>
              <span className="hidden items-center gap-3 sm:flex">
                <NavSep />
                <a href="#canvas" className="text-muted-foreground transition-colors hover:text-foreground">
                  Canvas
                </a>
                <NavSep />
                <a href="#features" className="text-muted-foreground transition-colors hover:text-foreground">
                  Features
                </a>
                <NavSep />
                <a href="#pricing" className="text-muted-foreground transition-colors hover:text-foreground">
                  Pricing
                </a>
              </span>
            </div>
            <div className="flex items-center gap-3 text-[13px]">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {theme === 'dark' ||
                (theme === 'system' &&
                  typeof document !== 'undefined' &&
                  document.documentElement.classList.contains('dark')) ? (
                  <SunIcon className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <MoonIcon className="size-3.5" strokeWidth={1.75} />
                )}
              </button>
              <NavSep />
              <Link
                to="/app"
                className="px-2.5 py-1 font-medium text-white"
                style={{ background: palette.accent }}
              >
                Get started
              </Link>
            </div>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[720px] px-5 pb-20 pt-12 sm:pt-16">
          <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
            <span aria-hidden="true" style={link}>
              |
            </span>
            <span>The agent design harness.</span>
          </h1>

          <p className="mt-6 text-muted-foreground">
            Loora is an infinite canvas of structured, responsive UI — and it is open to the agent
            you already use. Connect Claude or Cursor over{' '}
            <a
              href="https://mcp.loora.design"
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:underline"
              style={link}
            >
              MCP
            </a>{' '}
            and it edits the same document you do.
          </p>
          <p className="mt-4 text-muted-foreground">
            Every element is editable structured UI, never a code blob. Arrange it by hand, fork a{' '}
            <a href="#features" className="underline-offset-2 hover:underline" style={link}>
              branch
            </a>
            , merge when it&apos;s right, then export or publish.
          </p>

          <p className="mt-6">
            <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
              Get started
            </Link>
          </p>

          <div id="canvas" className="mt-12 scroll-mt-16">
            <AppChrome>
              <CanvasDemo reduceMotion={reduceMotion} />
            </AppChrome>
          </div>

          <h2 id="features" className="mt-16 scroll-mt-16 text-[15px] font-semibold">
            Build on loora
          </h2>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
              <thead>
                <tr>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Product
                  </th>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Description
                  </th>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Explore
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((row) => (
                  <tr key={row.product}>
                    <td className="border border-dashed border-border px-3 py-2 font-medium">
                      {row.product}
                    </td>
                    <td className="border border-dashed border-border px-3 py-2 text-muted-foreground">
                      {row.description}
                    </td>
                    <td className="border border-dashed border-border px-3 py-2">
                      {'href' in row && row.href ? (
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-2 hover:underline"
                          style={link}
                        >
                          {row.link}
                        </a>
                      ) : (
                        <Link
                          to="/app"
                          className="underline-offset-2 hover:underline"
                          style={link}
                        >
                          Open
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-14 text-[15px] font-semibold">How it works</h2>
          <p className="mt-4 text-muted-foreground">
            Add the Loora MCP server to your agent once. From then on it can read the canvas and
            insert, patch, move, and delete nodes through the same typed transactions the editor
            uses — so nothing it makes is a black box you have to accept whole.
          </p>
          <p className="mt-4 text-muted-foreground">
            Design tools arrange. Chat tools dump. Loora is the surface in between: your agent
            builds on an infinite canvas, and you rearrange, branch, and ship the design.
          </p>

          <h2 id="pricing" className="mt-16 scroll-mt-16 text-[15px] font-semibold">
            Pricing
          </h2>
          <p className="mt-4 text-muted-foreground">
            Both plans include the full editor, saving, history, exports, branches, MCP, and
            publish. You bring your own agent, so there are no AI credits to buy or run out of.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
              <thead>
                <tr>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Plan
                  </th>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Price
                  </th>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Includes
                  </th>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Notes
                  </th>
                  <th className="border border-dashed border-border px-3 py-2 font-semibold">
                    Start
                  </th>
                </tr>
              </thead>
              <tbody>
                {PLANS.map((row) => (
                  <tr key={row.plan}>
                    <td className="border border-dashed border-border px-3 py-2 font-medium">
                      {row.plan}
                    </td>
                    <td className="border border-dashed border-border px-3 py-2">
                      {row.price}
                      <span className="text-muted-foreground">/month</span>
                    </td>
                    <td className="border border-dashed border-border px-3 py-2 text-muted-foreground">
                      {row.includes}
                    </td>
                    <td className="border border-dashed border-border px-3 py-2 text-muted-foreground">
                      {row.note}
                    </td>
                    <td className="border border-dashed border-border px-3 py-2">
                      <Link
                        to="/app"
                        className="underline-offset-2 hover:underline"
                        style={link}
                      >
                        {row.cta}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-muted-foreground">
            Pro is free for 3 days, then $20/month unless canceled. Everything is unlocked during
            the trial, including the MCP server.
          </p>

          <p className="mt-10">
            <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
              Open a design →
            </Link>
          </p>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex w-full max-w-[720px] flex-wrap items-center gap-x-3 gap-y-2 px-5 py-6 text-[12px] text-muted-foreground">
            <span className="font-semibold text-foreground">loora</span>
            <NavSep />
            <Link to="/app" className="transition-colors hover:text-foreground">
              Get started
            </Link>
            <NavSep />
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
            <NavSep />
            <a
              href="https://github.com/lassejlv/loora"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <NavSep />
            <a
              href="https://mcp.loora.design"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              MCP
            </a>
          </div>
        </footer>
      </div>
    </PaletteContext.Provider>
  )
}
