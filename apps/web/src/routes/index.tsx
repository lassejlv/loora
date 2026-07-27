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
  ArrowRightIcon,
  CheckIcon,
  CodeIcon,
  FigmaIcon,
  GitCompareIcon,
  GithubIcon,
  ImageIcon,
  KeyRoundIcon,
  LinkIcon,
  MessagesSquareIcon,
  MoonIcon,
  MousePointer2Icon,
  Share2Icon,
  SquareIcon,
  SunIcon,
  TerminalIcon,
  TypeIcon,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
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
          'Put an agent on an infinite canvas. It builds real UI in place — you steer, arrange, and ship from the board.',
      },
      { property: 'og:title', content: 'loora — The agent design harness' },
      {
        property: 'og:description',
        content:
          'Put an agent on an infinite canvas. It builds real UI in place — you steer, arrange, and ship from the board.',
      },
      { property: 'og:image', content: '/landing-cover.png' },
    ],
  }),
  component: LandingPage,
})

const CARD = 'rounded-2xl border border-border bg-card'
const PANEL = 'bg-cx-canvas'
const EYEBROW = 'font-mono text-[11px] lowercase tracking-[0.02em] text-muted-foreground/70'
const H2 = 'text-[28px] leading-[1.04] tracking-[-0.04em] sm:text-[40px]'
const BODY = 'text-[15px] leading-[1.55] text-muted-foreground'

/**
 * Page chrome rides the app's Tailwind tokens, which already theme themselves.
 * The mocks can't: motion interpolates colour values, and it can't interpolate
 * `var(--x)`, so anything animated needs a concrete hex per theme.
 */
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
  glow: 'rgba(30,61,234,0.13)',
  accentInk: '#ffffff',
}

const DARK: Palette = {
  accent: '#738af4',
  accentSoft: 'rgba(115,138,244,0.14)',
  accentFaint: 'rgba(115,138,244,0.07)',
  accentWire: 'rgba(115,138,244,0.40)',
  wireStrong: '#4a4f5c',
  wireMid: '#3c404b',
  wireSoft: '#31343d',
  surface: '#1c1e24',
  tint: '#232630',
  line: '#2e3138',
  dot: '#2e3038',
  page: '#101114',
  ok: '#34d399',
  dotAccent: 'rgba(115,138,244,0.40)',
  glow: 'rgba(115,138,244,0.20)',
  accentInk: '#101114',
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
 * Halftone field behind the hero: an accent-tinted dot grid masked so it packs
 * in behind the demo and dissolves upward, with a soft wash under it. Clipped to
 * the shell's top corners by its own overflow — the shell can't clip it itself
 * without breaking the sticky nav.
 */
function HeroField({ reduceMotion }: { reduceMotion: boolean | null }) {
  const palette = usePalette()
  const loop = !reduceMotion
  const fade =
    'radial-gradient(ellipse 58% 62% at 50% 88%, #000 0%, rgba(0,0,0,0.5) 42%, transparent 72%)'
  const dots = (color: string, r: string) =>
    `radial-gradient(circle, ${color} ${r}, transparent ${r})`

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[660px] overflow-hidden rounded-t-[20px] sm:h-[860px] sm:rounded-t-[28px]"
    >
      {/* wash, breathing */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 66% 60% at 50% 92%, ${palette.glow}, transparent 72%)`,
        }}
        animate={loop ? { opacity: [0.7, 1, 0.7], scale: [1, 1.07, 1] } : undefined}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* a light travelling under the dots, so the field never sits still */}
      <motion.div
        className="absolute -inset-y-32 left-0 w-[42%] opacity-70"
        style={{
          background: `radial-gradient(ellipse at center, ${palette.glow}, transparent 66%)`,
        }}
        animate={loop ? { x: ['-35%', '115%'] } : undefined}
        transition={{ duration: 16, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
      />

      {/* Two dot layers drifting at different rates and directions. Each shifts by
          exactly one tile, so the loop is seamless. */}
      <div className="absolute inset-0" style={{ maskImage: fade, WebkitMaskImage: fade }}>
        <motion.div
          className="absolute inset-[-30%]"
          style={{
            backgroundImage: dots(palette.dotAccent, '1.4px'),
            backgroundSize: '18px 18px',
          }}
          animate={loop ? { x: [0, 18], y: [0, 18] } : undefined}
          transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-[-30%]"
          style={{
            backgroundImage: dots(palette.accentSoft, '2.4px'),
            backgroundSize: '52px 52px',
          }}
          animate={loop ? { x: [0, -52], y: [0, 26] } : undefined}
          transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    </div>
  )
}

function reveal(reduce: boolean | null, delay = 0) {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.3 },
    transition: {
      duration: reduce ? 0.12 : 0.4,
      delay: reduce ? 0 : delay,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  }
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
 * These recreate what the board actually looks like: elements are sharp-cornered
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
 * Scripted loop, one duration per beat: type the prompt, agent picks it up, the
 * frame lands, code streams in, selection settles, a comment drops, the revision
 * applies, hold — then the next example.
 */
const PHASES = [2200, 700, 600, 1600, 900, 1800, 1600, 1300]
const LAST_PHASE = PHASES.length - 1

/**
 * Where the pointer sits during each phase, in percent of the scene, so the loop
 * reads like a screen recording rather than things happening by themselves.
 * `click` marks the beats where it actually acts on something.
 */
const CURSOR_MARKS = [
  { x: 45, y: 89, click: false }, // in the prompt field
  { x: 78, y: 89, click: true }, // send
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

  const typing = phase === 0
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

      {/* Floating prompt bar — the app's own chrome, so this one is rounded. */}
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
                {revised ? 'editElement' : 'createElement'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 shadow-[0_1px_2px_rgba(26,25,23,0.05),0_8px_24px_-16px_rgba(26,25,23,0.3)]">
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
          <motion.span
            className="h-4 w-px shrink-0 bg-[#1a1917]/50"
            animate={typing ? { opacity: [1, 0, 1] } : { opacity: 0 }}
            transition={typing ? { duration: 0.9, repeat: Infinity } : { duration: 0.15 }}
          />
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-medium"
            style={{ background: palette.accent, color: palette.accentInk }}
          >
            ↑
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The editor around the canvas. Static on purpose — it frames the demo so the
 * board reads as a real tool rather than a floating illustration, and the only
 * thing that should be moving is the work happening inside it.
 */
function AppChrome({ children }: { children: React.ReactNode }) {
  const palette = usePalette()
  const tools = [MousePointer2Icon, SquareIcon, ImageIcon, TypeIcon, CodeIcon]

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05),0_32px_64px_-32px_rgba(0,0,0,0.35)]">
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <img src="/logo192.png" alt="" width={20} height={20} className="size-5 rounded-full" />
          <span className="text-[13px] font-semibold tracking-[-0.02em]">
            loora<span style={{ color: palette.accent }}>.</span>
          </span>
        </div>

        <div className="hidden items-center gap-0.5 rounded-lg border border-border p-0.5 sm:flex">
          {tools.map((Tool, index) => (
            <span
              key={index}
              className="flex size-6 items-center justify-center rounded-md"
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
          <span className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex">
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
              className="rounded-md px-1.5 py-1 text-[11px]"
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
                    className="rounded-md border border-border px-1.5 py-1 font-mono text-[9px] text-muted-foreground"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <p className="px-1.5 text-[10px] text-muted-foreground/70">fill</p>
            <span className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 font-mono text-[9px] text-muted-foreground">
              <span
                className="size-2.5 rounded-[3px] border border-border"
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

/* ------------------------------------------------------------------------- *
 * Section mocks, on the same canvas language.
 * ------------------------------------------------------------------------- */

/** Uses the shared loop, gated on visibility, holding the last beat when reduced. */
function useMockLoop(durations: readonly number[], reduceMotion: boolean | null) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4 })
  const { tick } = useScriptedLoop(durations, !reduceMotion && inView)
  return { ref, phase: reduceMotion ? durations.length - 1 : tick }
}

const LIVE_PHASES = [1400, 900, 1100, 900, 1400, 1300]

/** Code on the left, the element it renders on the right — edit one, both move. */
function LiveUiMock({ reduceMotion }: { reduceMotion: boolean | null }) {
  const palette = usePalette()
  const { ref, phase } = useMockLoop(LIVE_PHASES, reduceMotion)
  const rendered = phase >= 1
  const editing = phase === 3
  const updated = phase >= 4

  const lines = [
    { w: '70%', accent: true },
    { w: '90%', accent: false },
    { w: '55%', accent: false },
    { w: updated ? '64%' : '80%', accent: updated },
    { w: '40%', accent: true },
  ]

  return (
    <div ref={ref} className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <div className="absolute inset-0 grid grid-cols-2">
        <div className="flex flex-col gap-1.5 border-r border-border bg-card p-4">
          <span className="font-mono text-[9px] text-muted-foreground/70">App.tsx</span>
          <div className="mt-1 flex flex-col gap-1.5">
            {lines.map((line, index) => (
              <motion.div
                key={index}
                className="-mx-1 rounded-sm px-1"
                initial={false}
                animate={{
                  opacity: phase >= 0 ? 1 : 0,
                  background:
                    editing && index === 3 ? palette.accentSoft : 'rgba(0,0,0,0)',
                }}
                transition={{ duration: 0.25, delay: phase === 0 ? index * 0.12 : 0 }}
              >
                <motion.div
                  className="h-1.5"
                  initial={false}
                  animate={{
                    width: line.w,
                    background: line.accent ? palette.accentWire : palette.wireSoft,
                  }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-center p-4">
          <AnimatePresence>
            {rendered && (
              <motion.div
                className="w-full border bg-card p-3"
                style={{ borderColor: palette.line }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex flex-col gap-1.5">
                  <Wire w="60%" h={10} tone="strong" />
                  <Wire w="95%" h={7} tone="soft" />
                  <motion.div
                    className="mt-1 h-4"
                    initial={false}
                    animate={{
                      width: updated ? 76 : 60,
                      background: updated ? palette.accent : palette.wireMid,
                    }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase >= 2 && (
              <motion.span
                className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 font-mono text-[8.5px] leading-none text-muted-foreground"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <span className="size-1 rounded-full" style={{ background: palette.ok }} />
                ok
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

const CONTROL_PHASES = [1300, 1200, 1100, 1000, 1500]

/** Selection follows the layer you pick, then gets resized and nudged by hand. */
function ControlMock({ reduceMotion }: { reduceMotion: boolean | null }) {
  const palette = usePalette()
  const { ref, phase } = useMockLoop(CONTROL_PHASES, reduceMotion)

  // Which layer is selected, and the box that selection puts on the canvas.
  const active = phase === 0 ? 0 : phase === 4 ? 2 : 1
  const box =
    phase === 0
      ? { top: '14%', height: '34%', width: '34%' }
      : phase === 1
        ? { top: '30%', height: '44%', width: '34%' }
        : phase === 2
          ? { top: '30%', height: '44%', width: '48%' }
          : phase === 3
            ? { top: '38%', height: '44%', width: '48%' }
            : { top: '52%', height: '30%', width: '48%' }

  return (
    <div ref={ref} className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <DotField />

      <div className="absolute left-[7%] top-[16%] z-10 flex w-[27%] flex-col gap-0.5 rounded-lg border border-border bg-card p-1.5">
        {['hero', 'pricing', 'footer'].map((layer, index) => (
          <motion.span
            key={layer}
            className="rounded px-1.5 py-1 font-mono text-[9px] leading-none"
            initial={false}
            animate={{
              background: index === active ? palette.accentSoft : 'rgba(0,0,0,0)',
              color: index === active ? palette.accent : 'rgba(128,128,128,0.9)',
            }}
            transition={{ duration: 0.25 }}
          >
            {layer}
          </motion.span>
        ))}
      </div>

      <motion.div
        className="absolute left-[44%] bg-card"
        style={{ border: `1px solid ${palette.accent}` }}
        initial={false}
        animate={box}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex flex-col gap-2 p-3">
          <Wire w="50%" h={12} tone="strong" />
          <Wire w="90%" h={8} tone="soft" />
        </div>
        {(
          ['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'] as const
        ).map((pos) => (
          <span
            key={pos}
            className={`absolute size-2 bg-card ${pos}`}
            style={{ border: `1.5px solid ${palette.accent}` }}
          />
        ))}
      </motion.div>
    </div>
  )
}

const COMMENT_PHASES = [900, 600, 1500, 1000, 1200, 1000, 1400]

/** Pin a spot, say what's wrong, and watch the next turn land on that spot. */
function CommentMock({ reduceMotion }: { reduceMotion: boolean | null }) {
  const palette = usePalette()
  const { ref, phase } = useMockLoop(COMMENT_PHASES, reduceMotion)
  const pinned = phase >= 1
  const noted = phase >= 2
  const working = phase === 3
  const fixed = phase >= 4
  const resolved = phase >= 5

  return (
    <div ref={ref} className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <DotField />

      <div
        className="absolute inset-x-[12%] inset-y-[16%] border bg-card p-3"
        style={{ borderColor: palette.line }}
      >
        <div className="flex flex-col gap-2">
          <Wire w="40%" h={12} tone="strong" />
          {/* the line the note is aimed at */}
          <motion.div
            className="h-2"
            initial={false}
            animate={{ width: fixed ? '62%' : '100%', background: palette.wireSoft }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.div
            className="h-2"
            initial={false}
            animate={{ width: fixed ? '44%' : '70%', background: palette.wireSoft }}
            transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      <AnimatePresence>
        {pinned && (
          <motion.div
            className="absolute left-[44%] top-[34%] flex items-start gap-1.5"
            initial={{ opacity: 0, scale: 0.8, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.span
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium shadow-sm"
              initial={false}
              animate={{ background: resolved ? palette.ok : palette.accent, color: palette.accentInk }}
              transition={{ duration: 0.3 }}
            >
              {resolved ? '✓' : '1'}
            </motion.span>

            <AnimatePresence>
              {noted && (
                <motion.span
                  className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-lg rounded-tl-sm border border-border bg-card px-2 py-1 text-[10px] leading-tight text-foreground shadow-sm"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <motion.span
                    initial={reduceMotion ? false : { clipPath: 'inset(0 100% 0 0)' }}
                    animate={{ clipPath: 'inset(0 0% 0 0)' }}
                    transition={{ duration: reduceMotion ? 0 : 0.6, ease: 'linear' }}
                  >
                    tighten this
                  </motion.span>
                  {working && (
                    <motion.span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: palette.accent }}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.1, repeat: Infinity }}
                    />
                  )}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Branch demo.
 *
 * Beats: idle on main, fork off, two commits land on the branch, compare, checks
 * pass, merge back, settled — then it loops. The viewBox is 16:10 like the
 * container, so drawn lanes and percentage-positioned labels line up.
 * ------------------------------------------------------------------------- */

const BRANCH_PHASES = [1100, 900, 700, 700, 1700, 1200, 900, 1600]

const BRANCH_STATUS = [
  null,
  'branch created',
  '1 change',
  '2 changes',
  'reviewing',
  'checks passed',
  'merging',
  'merged to main',
] as const

/** A commit dot that pops in on its beat. */
function CommitDot({
  cx,
  cy,
  on,
  accent,
}: {
  cx: number
  cy: number
  on: boolean
  accent?: boolean
}) {
  const palette = usePalette()
  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r="4.5"
      fill={palette.page}
      stroke={accent ? palette.accent : '#1a1917'}
      strokeOpacity={accent ? 1 : 0.28}
      strokeWidth="2"
      initial={false}
      animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.4 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: `${cx}px ${cy}px` }}
    />
  )
}

function BranchDemo({ reduceMotion }: { reduceMotion: boolean | null }) {
  const palette = usePalette()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4 })
  const { tick } = useScriptedLoop(BRANCH_PHASES, !reduceMotion && inView)

  // Reduced motion holds the merged state — the end of the story, not the start.
  const phase = reduceMotion ? BRANCH_PHASES.length - 1 : tick

  const forked = phase >= 1
  const merging = phase >= 6
  const merged = phase >= 7
  const status = BRANCH_STATUS[phase]

  return (
    <div ref={ref} className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <DotField />

      <svg viewBox="0 0 320 200" className="absolute inset-0 h-full w-full" fill="none">
        <path d="M20 54 H300" stroke="#1a1917" strokeOpacity="0.16" strokeWidth="2" />

        {/* fork out, then run along the branch lane */}
        <motion.path
          d="M84 54 C 108 54, 108 112, 132 112 H 196"
          stroke={palette.accent}
          strokeWidth="2"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: forked ? 1 : 0, opacity: merged ? 0.35 : 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* merge back into main */}
        <motion.path
          d="M196 112 C 220 112, 220 54, 244 54"
          stroke={palette.accent}
          strokeWidth="2"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: merging ? 1 : 0, opacity: merged ? 0.35 : 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
        />

        <CommitDot cx={40} cy={54} on />
        <CommitDot cx={84} cy={54} on />
        <CommitDot cx={152} cy={112} on={phase >= 2} accent />
        <CommitDot cx={176} cy={112} on={phase >= 3} accent />
        <CommitDot cx={244} cy={54} on={merged} accent />
        <CommitDot cx={288} cy={54} on={merged} />
      </svg>

      <span className="absolute left-[5%] top-[16%] font-mono text-[9px] text-muted-foreground/70">main</span>

      <AnimatePresence>
        {forked && (
          <motion.span
            className="absolute left-[41%] top-[62%] font-mono text-[9px]"
            style={{ color: palette.accent, opacity: merged ? 0.5 : 1 }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: merged ? 0.5 : 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            pricing-v2
          </motion.span>
        )}
      </AnimatePresence>

      {/* compare panel — the diff summary the branch carries */}
      <AnimatePresence>
        {phase >= 4 && !merged && (
          <motion.div
            className="absolute bottom-[7%] left-[5%] w-[38%] rounded-lg border border-border bg-card p-2 shadow-sm"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="font-mono text-[8.5px] leading-none text-muted-foreground/70">compare</p>
            <div className="mt-1.5 flex items-center gap-2 font-mono text-[9px] leading-none">
              <span className="text-emerald-600">+3</span>
              <span className="text-muted-foreground">~2</span>
              <span className="text-red-700">−1</span>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <Wire w="80%" h={5} tone="soft" />
              <Wire w="58%" h={5} tone="soft" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* one status chip that carries the story */}
      <div className="absolute bottom-[7%] right-[5%]">
        <AnimatePresence mode="wait">
          {status && (
            <motion.span
              key={status}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 font-mono text-[9px] leading-none text-muted-foreground shadow-sm"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: merged ? palette.ok : palette.accent }}
              />
              {status}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Copy.
 * ------------------------------------------------------------------------- */

const BEATS = [
  {
    title: 'Describe, don’t draw first',
    body: 'Tell the agent what you want. It builds editable, structured UI directly on the board.',
  },
  {
    title: 'Arrange like a design tool',
    body: 'Select, group, nudge, and peek at code when you want control.',
  },
  {
    title: 'Point and revise',
    body: 'Comment on a spot or keep chatting — the canvas stays the source of truth.',
  },
] as const

// Every line here has to be true of the shipped product — the router groups and
// agent tools are the source, not the pitch. Bodies are held to roughly one
// length so the grid doesn't end up with eight different amounts of dead space.
const MORE = [
  {
    label: 'github',
    icon: GithubIcon,
    title: 'It reads your repo',
    body: 'The agent searches and reads your real files, so new UI matches what’s there.',
  },
  {
    label: 'figma',
    icon: FigmaIcon,
    title: 'Import from Figma',
    body: 'Pull frames onto the board and keep going in live code, not a flat picture.',
  },
  {
    label: 'history',
    icon: GitCompareIcon,
    title: 'Versions with diffs',
    body: 'Commit as you go, compare any two points, and roll back what didn’t work.',
  },
  {
    label: 'mcp',
    icon: TerminalIcon,
    title: 'Drive it from your editor',
    body: 'loora is an MCP server — Claude and Cursor can build and branch without a browser.',
  },
  {
    label: 'chats',
    icon: MessagesSquareIcon,
    title: 'Agents in parallel',
    body: 'Run several chats at once. Steer mid-generation, or close the tab and come back.',
  },
  {
    label: 'share',
    icon: LinkIcon,
    title: 'Publish and hand off',
    body: 'Put a live element behind a public link, or share a read-only board.',
  },
  {
    label: 'assets',
    icon: ImageIcon,
    title: 'Images and export',
    body: 'Upload assets the agent can place, then export as JSON or standalone HTML.',
  },
  {
    label: 'models',
    icon: KeyRoundIcon,
    title: 'Bring your own account',
    body: 'Connect your ChatGPT account and generations run on your plan, not ours.',
  },
] as const

const CAPABILITIES = [
  {
    title: 'You keep the hands',
    body: 'Select, group, resize, reorder, and open the code when the agent needs a shove.',
    mock: ControlMock,
  },
  {
    title: 'Comments as coordinates',
    body: 'Pin a spot, say what’s wrong, and the next turn aims there. No more “make the header nicer.”',
    mock: CommentMock,
  },
] as const

const CONTRAST = [
  {
    label: 'Chat tools',
    body: 'Dump code into a file. You paste, wire up, and hope it matches the picture in your head.',
    tone: 'muted',
  },
  {
    label: 'loora',
    body: 'The agent builds on an infinite canvas. You rearrange, comment, and ship from the board.',
    tone: 'accent',
  },
] as const

function LandingPage() {
  const reduceMotion = useReducedMotion()
  const palette = useThemePalette()
  const [theme, setTheme] = useState<ThemePreference>('system')

  useEffect(() => setTheme(getThemePreference()), [])

  // Canvas shell locks body scroll (`overflow: hidden` + fixed height); unlock for this page.
  useEffect(() => {
    const root = document.documentElement
    const { body } = document
    const prev = {
      rootHeight: root.style.height,
      bodyHeight: body.style.height,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    }
    root.style.height = 'auto'
    body.style.height = 'auto'
    body.style.overflow = 'auto'
    body.style.overscrollBehavior = 'auto'
    return () => {
      root.style.height = prev.rootHeight
      body.style.height = prev.bodyHeight
      body.style.overflow = prev.bodyOverflow
      body.style.overscrollBehavior = prev.bodyOverscroll
    }
  }, [])

  // Keeps a `system` preference honest if the OS flips while the page is open.
  useEffect(() => watchSystemTheme(), [])

  const toggleTheme = () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    setThemePreference(next)
    setTheme(next)
  }

  return (
    <PaletteContext.Provider value={palette}>
      {/* Gutter + rounded shell, so the page reads as a card rather than running
          into the browser chrome. No overflow-hidden here: it would make the
          sticky nav stick inside this box instead of the viewport. */}
      <div className="min-h-dvh bg-[#e6e3dc] p-2 antialiased sm:p-3 dark:bg-black">
        <div className="relative min-h-[calc(100dvh-1rem)] rounded-[20px] border border-border bg-background text-foreground sm:min-h-[calc(100dvh-1.5rem)] sm:rounded-[28px]">
          <HeroField reduceMotion={reduceMotion} />

          <header className="sticky top-2 z-50 px-4 pt-3 sm:top-3 sm:pt-4">
            <nav className="mx-auto flex h-12 w-full max-w-[1080px] items-center justify-between rounded-full border border-border bg-background/80 pl-2 pr-2 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <img
                  src="/logo192.png"
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 rounded-full"
                />
                <p className="text-[17px] font-semibold tracking-[-0.03em]">
                  loora<span style={{ color: palette.accent }}>.</span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  {theme === 'dark' ? (
                    <SunIcon className="size-4" strokeWidth={1.75} />
                  ) : (
                    <MoonIcon className="size-4" strokeWidth={1.75} />
                  )}
                </button>
                <Button render={<Link to="/app" />} size="sm" className="rounded-full px-4">
                  Open the board
                </Button>
              </div>
            </nav>
          </header>

      <main className="relative z-10">
        <section className="mx-auto w-full max-w-[820px] px-5 pb-9 pt-10 text-center sm:pb-12 sm:pt-16">
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="inline-flex items-center rounded-full border border-border bg-card/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              The agent design harness
            </span>
          </motion.div>
          <motion.h1
            className="mt-5 text-[38px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[62px]"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.5,
              delay: reduceMotion ? 0 : 0.04,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            You don’t need a mockup
            <br />
            to see <span style={{ color: palette.accent }}>the real thing.</span>
          </motion.h1>
          <motion.p
            className={`mx-auto mt-5 max-w-[520px] ${BODY} sm:text-base`}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.5,
              delay: reduceMotion ? 0 : 0.08,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            Put an agent on an infinite canvas. It builds structured, responsive UI in place — you steer,
            arrange, and ship from the board.
          </motion.p>
          <motion.div
            className="mt-7 flex flex-col items-center justify-center gap-2.5 sm:flex-row"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.5,
              delay: reduceMotion ? 0 : 0.12,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <Button
              render={<Link to="/app" />}
              size="lg"
              className="group w-full rounded-full border-transparent px-5 hover:opacity-90 sm:w-auto"
              style={{ background: palette.accent, color: palette.accentInk }}
            >
              Open the board
              <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <a
              href="#board"
              className="inline-flex h-10 items-center justify-center rounded-full border border-border px-5 text-sm font-medium transition-colors hover:bg-foreground/5"
            >
              See it in action
            </a>
          </motion.div>

          <motion.ul
            className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.5,
              delay: reduceMotion ? 0 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {['Structured real UI', 'Infinite canvas', 'Branches and history'].map((claim) => (
              <li key={claim} className="flex items-center gap-1.5">
                <CheckIcon className="size-3.5" style={{ color: palette.accent }} strokeWidth={2.5} />
                {claim}
              </li>
            ))}
          </motion.ul>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5" aria-label="Product demo">
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.6,
              delay: reduceMotion ? 0 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <AppChrome>
              <CanvasDemo reduceMotion={reduceMotion} />
            </AppChrome>
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5 py-14 sm:py-20">
          <div
            className={`grid ${CARD} divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0`}
          >
            {BEATS.map((beat, index) => (
              <motion.div
                key={beat.title}
                className="p-5 sm:p-6"
                {...reveal(reduceMotion, 0.04 * index)}
              >
                <p className="text-[15px] font-medium tracking-[-0.02em]">{beat.title}</p>
                <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">{beat.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section
          id="board"
          className="mx-auto w-full max-w-[1080px] scroll-mt-20 px-5 pb-14 sm:pb-20"
        >
          <div className={`grid overflow-hidden ${CARD} sm:grid-cols-[0.9fr_1.1fr]`}>
            <motion.div
              className="flex flex-col justify-center p-6 sm:p-10"
              {...reveal(reduceMotion)}
            >
              <p className={EYEBROW}>branches</p>
              <h2 className="mt-3 text-[26px] font-medium leading-[1.05] tracking-[-0.04em] sm:text-[34px]">
                Try it on a branch.
                <br />
                Merge when it’s right.
              </h2>
              <p className={`mt-4 ${BODY}`}>
                Fork a design, let the agent loose on it, and leave main alone. Compare the two
                sides, resolve anything that collided, and apply when you’re happy.
              </p>
            </motion.div>
            <motion.div
              className="border-t border-border sm:border-l sm:border-t-0"
              {...reveal(reduceMotion, 0.06)}
            >
              <BranchDemo reduceMotion={reduceMotion} />
            </motion.div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5 pb-14 sm:pb-20">
          <motion.div className="mx-auto max-w-[620px] text-center" {...reveal(reduceMotion)}>
            <p className={EYEBROW}>what you get</p>
            <h2 className={`mt-3 font-medium ${H2}`}>A board that stays the source of truth.</h2>
          </motion.div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <motion.div
              className={`overflow-hidden ${CARD} sm:col-span-2 sm:grid sm:grid-cols-[1.1fr_0.9fr]`}
              {...reveal(reduceMotion)}
            >
              <div className="border-b border-border sm:border-b-0 sm:border-r">
                <LiveUiMock reduceMotion={reduceMotion} />
              </div>
              <div className="flex flex-col justify-center p-6 sm:p-8">
                <p className="text-[19px] font-medium tracking-[-0.03em] sm:text-[24px]">
                  Real UI, not mockups
                </p>
                <p className="mt-2.5 text-[14px] leading-[1.55] text-muted-foreground sm:text-[15px]">
                  Every element on the board is editable structured UI, with deterministic code generated when you need it,
                  rendered in place. Not a picture of a button. The button.
                </p>
              </div>
            </motion.div>

            {CAPABILITIES.map((item, index) => {
              const Mock = item.mock
              return (
                <motion.div
                  key={item.title}
                  className={`overflow-hidden ${CARD} transition-shadow hover:shadow-[0_1px_2px_rgba(26,25,23,0.04),0_16px_32px_-24px_rgba(26,25,23,0.24)]`}
                  {...reveal(reduceMotion, 0.06 + 0.05 * index)}
                >
                  <div className="border-b border-border">
                    <Mock reduceMotion={reduceMotion} />
                  </div>
                  <div className="p-5">
                    <p className="text-[16px] font-medium tracking-[-0.025em]">{item.title}</p>
                    <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">{item.body}</p>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5 pb-14 sm:pb-20">
          <motion.div className="mx-auto max-w-[620px] text-center" {...reveal(reduceMotion)}>
            <p className={EYEBROW}>and the rest of it</p>
            <h2 className={`mt-3 font-medium ${H2}`}>Wired into the work you already do.</h2>
          </motion.div>
          {/* gap-px over a hairline-coloured container draws the grid lines, which
              survives the 1→2→4 column change without nth-child bookkeeping. */}
          <motion.div
            className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4"
            {...reveal(reduceMotion)}
          >
            {MORE.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.label}
                  className="bg-card p-6 transition-colors hover:bg-foreground/3"
                >
                  <div className="flex items-center gap-2 text-muted-foreground/70">
                    <Icon className="size-[15px] shrink-0" strokeWidth={1.75} />
                    <span className="font-mono text-[10px]">{item.label}</span>
                  </div>
                  <p className="mt-3.5 text-[15px] font-medium tracking-[-0.02em]">{item.title}</p>
                  <p className="mt-1.5 text-[13px] leading-[1.55] text-muted-foreground">{item.body}</p>
                </div>
              )
            })}
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5 pb-14 sm:pb-20">
          <motion.h2
            className={`mx-auto max-w-[560px] text-center font-medium ${H2}`}
            {...reveal(reduceMotion)}
          >
            Design tools arrange. Chat tools dump. loora does both.
          </motion.h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {CONTRAST.map((row, index) => (
              <motion.div
                key={row.label}
                className={
                  row.tone === 'accent'
                    ? 'rounded-2xl border border-cx-accent/20 bg-cx-accent/4 p-6 sm:p-7'
                    : `${CARD} p-6 sm:p-7`
                }
                {...reveal(reduceMotion, 0.05 * index)}
              >
                <p
                  className={`font-mono text-[11px] ${row.tone === 'accent' ? 'text-cx-accent' : 'text-muted-foreground/70'}`}
                >
                  {row.label}
                </p>
                <p className="mt-3 text-[15px] leading-[1.5] text-foreground/80 sm:text-base">
                  {row.body}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5 pb-14 sm:pb-20">
          <motion.div
            className={`${PANEL} rounded-3xl border border-border px-6 py-14 text-center sm:px-10 sm:py-20`}
            {...reveal(reduceMotion)}
          >
            <h2 className="mx-auto max-w-[520px] text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[44px]">
              Open a board. Put an agent on it.
            </h2>
            <p className={`mx-auto mt-4 max-w-[440px] ${BODY}`}>
              No mockup theater. Real UI on an infinite canvas — describe, arrange, revise, ship.
            </p>
            <div className="mt-7 flex justify-center">
              <Button render={<Link to="/app" />} size="lg" className="rounded-full px-5">
                Open the board
              </Button>
            </div>
          </motion.div>
        </section>
      </main>

          <footer className="relative z-10 mx-auto flex w-full max-w-[1080px] items-center justify-between border-t border-border px-5 py-6 text-[13px] text-muted-foreground/70">
            <p className="font-medium text-foreground">
              loora<span style={{ color: palette.accent }}>.</span>
            </p>
            <p>The design harness.</p>
          </footer>
        </div>
      </div>
    </PaletteContext.Provider>
  )
}
