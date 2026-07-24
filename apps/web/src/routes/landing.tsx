import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react'
import { Button } from '#/components/ui/button'
import { applyTheme, getThemePreference } from '#/lib/theme'

export const Route = createFileRoute('/landing')({
  ssr: false,
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

// The marketing surface runs its own light palette — the app's tokens follow the
// user's theme, and this page forces light regardless.
const CARD = 'rounded-2xl border border-[#1a1917]/8 bg-white'
const PANEL = 'bg-[#f1f0ec]'
const EYEBROW = 'font-mono text-[11px] lowercase tracking-[0.02em] text-[#9b978f]'
const H2 = 'text-[28px] leading-[1.04] tracking-[-0.04em] sm:text-[40px]'
const BODY = 'text-[15px] leading-[1.55] text-[#75726b]'
const ACCENT = '#2440e6'

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

/* ------------------------------------------------------------------------- *
 * Canvas primitives.
 *
 * These recreate what the board actually looks like: elements are sharp-cornered
 * white rectangles on a dotted field, their contents are flat grey wireframe
 * blocks, and a selected element carries a blue outline with four 8px square
 * handles. Nothing here is rounded — rounding is for app chrome, not elements.
 * ------------------------------------------------------------------------- */

const WIRE = { strong: '#c6c6c6', mid: '#d2d2d2', soft: '#dedede' } as const

type WireTone = keyof typeof WIRE

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
  return <div className={className} style={{ width: w, height: h, background: WIRE[tone] }} />
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
  return (
    <motion.div
      aria-hidden="true"
      className="absolute inset-[-10%]"
      style={{
        backgroundImage: 'radial-gradient(circle, #d3d1c9 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        y,
      }}
    />
  )
}

/** Four corner handles: white fill, 1.5px accent stroke, square. */
function Handles() {
  return (
    <>
      {(
        ['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'] as const
      ).map((pos) => (
        <motion.span
          key={pos}
          className={`absolute size-2 bg-white ${pos}`}
          style={{ border: `1.5px solid ${ACCENT}` }}
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
  return (
    <div className="flex h-full flex-col">
      <StreamWire step={0} on={on}>
        <div className="flex items-center justify-between px-[4%] py-[3.5%]">
          <span className="block size-[7%] min-h-3 min-w-3 rounded-full bg-[#c6c6c6]" />
          <div className="flex items-center gap-[3%]">
            {[0, 1, 2, 3].map((item) => (
              <Wire key={item} w="34px" h={9} tone="mid" />
            ))}
          </div>
          <Wire w="46px" h={16} tone="mid" />
        </div>
        <div className="h-px w-full bg-[#e6e6e4]" />
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
            <div className="h-full w-full" style={{ background: WIRE.soft, aspectRatio: '1 / 1' }} />
          </div>
        </StreamWire>
      </div>
    </div>
  )
}

function PricingScene({ on, revised }: { on: boolean; revised: boolean }) {
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
              background: revised && col === 1 ? 'rgba(36,64,230,0.05)' : '#f4f4f2',
              boxShadow:
                revised && col === 1 ? `inset 0 0 0 1px ${ACCENT}` : 'inset 0 0 0 1px #e6e6e4',
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
              background: revised && row === 1 ? 'rgba(36,64,230,0.1)' : 'transparent',
            }}
            transition={{ duration: 0.25, delay: on ? row * 0.07 : 0 }}
          >
            <Wire w="82%" h={8} tone={revised && row === 1 ? 'strong' : 'soft'} />
          </motion.div>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-[9px] border-l border-[#e6e6e4] pl-[5%]">
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
            style={{ border: `1.5px solid ${ACCENT}` }}
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
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.3 })
  const [tick, setTick] = useState(0)
  const [index, setIndex] = useState(0)

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

  useEffect(() => {
    if (reduceMotion || !inView) return
    const id = setTimeout(() => {
      if (tick === LAST_PHASE) {
        setIndex((current) => (current + 1) % EXAMPLES.length)
        setTick(0)
      } else {
        setTick((current) => current + 1)
      }
    }, PHASES[tick])
    return () => clearTimeout(id)
  }, [tick, inView, reduceMotion])

  const typing = phase === 0
  const working = phase >= 1 && phase < 4
  const framed = phase >= 2
  const streaming = phase >= 3
  const selected = phase >= 4
  const commented = phase >= 5
  const revised = phase >= 6

  return (
    <div ref={ref} className={`relative aspect-[4/3] w-full overflow-hidden ${PANEL} sm:aspect-[3/2]`}>
      <DotField y={dotsY} />

      {/* The unselected neighbour, as on the cover. */}
      <motion.div
        className="absolute left-[9%] top-[29%] h-[38%] w-[19%] border border-[#e4e4e2] bg-white"
        style={{ y: asideY }}
      >
        <div className="flex flex-col gap-[8px] p-[9%]">
          <Wire w="80%" h={14} tone="strong" />
          <Wire w="66%" h={10} />
          <Wire w="46%" h={10} />
          <div className="mt-[6px] h-[52%] w-full" style={{ background: WIRE.soft }} />
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
                    className="absolute -top-6 left-0 rounded-md px-2 py-0.5 text-[11px] font-medium leading-tight text-white sm:text-[13px]"
                    style={{ background: ACCENT }}
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
                className="h-full w-full bg-white"
                animate={{ borderColor: selected ? ACCENT : '#e4e4e2' }}
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
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white shadow-sm"
                      style={{ background: ACCENT }}
                    >
                      1
                    </span>
                    <span className="whitespace-nowrap rounded-lg rounded-tl-sm border border-[#1a1917]/8 bg-white px-2 py-1 text-[10px] leading-tight text-[#1a1917] shadow-sm sm:text-[11px]">
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
              className="mb-2 flex w-fit items-center gap-1.5 rounded-full border border-[#1a1917]/8 bg-white px-2.5 py-1 shadow-sm"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.22 }}
            >
              <motion.span
                className="size-1.5 rounded-full"
                style={{ background: ACCENT }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.1, repeat: Infinity }}
              />
              <span className="font-mono text-[10px] leading-none" style={{ color: ACCENT }}>
                {revised ? 'editElement' : 'createElement'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex h-10 items-center gap-2 rounded-xl border border-[#1a1917]/8 bg-white px-3 shadow-[0_1px_2px_rgba(26,25,23,0.05),0_8px_24px_-16px_rgba(26,25,23,0.3)]">
          <AnimatePresence mode="wait">
            <motion.p
              key={index}
              className="min-w-0 flex-1 truncate text-[12px] text-[#1a1917] sm:text-[13px]"
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
            className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-medium text-white"
            style={{ background: ACCENT }}
          >
            ↑
          </span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Section mocks, on the same canvas language.
 * ------------------------------------------------------------------------- */

/** Code on the left, the element it renders on the right. */
function LiveUiMock() {
  return (
    <div className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <div className="absolute inset-0 grid grid-cols-2">
        <div className="flex flex-col gap-1.5 border-r border-[#1a1917]/8 bg-white p-4">
          <span className="font-mono text-[9px] text-[#9b978f]">App.tsx</span>
          <div className="mt-1 flex flex-col gap-1.5">
            <div className="h-1.5" style={{ width: '70%', background: 'rgba(36,64,230,0.3)' }} />
            <Wire w="90%" h={6} tone="soft" />
            <Wire w="55%" h={6} tone="soft" />
            <Wire w="80%" h={6} tone="soft" />
            <div className="h-1.5" style={{ width: '40%', background: 'rgba(36,64,230,0.3)' }} />
          </div>
        </div>
        <div className="flex items-center justify-center p-4">
          <div className="w-full border border-[#e4e4e2] bg-white p-3">
            <div className="flex flex-col gap-1.5">
              <Wire w="60%" h={10} tone="strong" />
              <Wire w="95%" h={7} tone="soft" />
              <div className="mt-1 h-4 w-16" style={{ background: WIRE.mid }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Layer stack on the left, the selected element on the right. */
function ControlMock() {
  return (
    <div className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <DotField />
      <div className="absolute left-[7%] top-[16%] flex w-[27%] flex-col gap-0.5 rounded-lg border border-[#1a1917]/8 bg-white p-1.5">
        {['hero', 'pricing', 'footer'].map((layer, index) => (
          <span
            key={layer}
            className={`rounded px-1.5 py-1 font-mono text-[9px] leading-none ${
              index === 1 ? 'bg-[#2440e6]/10 text-[#2440e6]' : 'text-[#9b978f]'
            }`}
          >
            {layer}
          </span>
        ))}
      </div>
      <div
        className="absolute inset-y-[22%] left-[44%] w-[42%] bg-white"
        style={{ border: `1px solid ${ACCENT}` }}
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
            className={`absolute size-2 bg-white ${pos}`}
            style={{ border: `1.5px solid ${ACCENT}` }}
          />
        ))}
      </div>
    </div>
  )
}

/** A pin dropped on a spot, with the note that steers the next turn. */
function CommentMock() {
  return (
    <div className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <DotField />
      <div className="absolute inset-x-[12%] inset-y-[16%] border border-[#e4e4e2] bg-white p-3">
        <div className="flex flex-col gap-2">
          <Wire w="40%" h={12} tone="strong" />
          <Wire w="100%" h={8} tone="soft" />
          <Wire w="70%" h={8} tone="soft" />
        </div>
      </div>
      <div className="absolute left-[44%] top-[34%] flex items-start gap-1.5">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white shadow-sm"
          style={{ background: ACCENT }}
        >
          1
        </span>
        <span className="rounded-lg rounded-tl-sm border border-[#1a1917]/8 bg-white px-2 py-1 text-[10px] leading-tight text-[#1a1917] shadow-sm">
          tighten this
        </span>
      </div>
    </div>
  )
}

/**
 * Branch diagram. The viewBox is 16:10 like the container, so the drawn lanes and
 * the percentage-positioned labels line up.
 */
function BranchMock() {
  return (
    <div className={`relative aspect-[16/10] w-full overflow-hidden ${PANEL}`}>
      <DotField />
      <svg viewBox="0 0 320 200" className="absolute inset-0 h-full w-full" fill="none">
        <path d="M24 60 H296" stroke="#1a1917" strokeOpacity="0.16" strokeWidth="2" />
        <path
          d="M88 60 C 112 60, 112 132, 136 132 H 184 C 208 132, 208 60, 232 60"
          stroke={ACCENT}
          strokeWidth="2"
        />
        {[40, 88, 232, 280].map((cx) => (
          <circle
            key={cx}
            cx={cx}
            cy={60}
            r="4.5"
            fill="#fafaf8"
            stroke="#1a1917"
            strokeOpacity="0.28"
            strokeWidth="2"
          />
        ))}
        {[148, 172].map((cx) => (
          <circle key={cx} cx={cx} cy={132} r="4.5" fill="#fafaf8" stroke={ACCENT} strokeWidth="2" />
        ))}
      </svg>
      <span className="absolute left-[7%] top-[17%] font-mono text-[9px] text-[#9b978f]">main</span>
      <span className="absolute left-[41%] top-[73%] font-mono text-[9px]" style={{ color: ACCENT }}>
        pricing-v2
      </span>
      <span className="absolute bottom-[8%] right-[6%] rounded-full border border-[#1a1917]/8 bg-white px-2 py-1 font-mono text-[9px] leading-none text-[#75726b]">
        2 changes · no conflicts
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Copy.
 * ------------------------------------------------------------------------- */

const BEATS = [
  {
    title: 'Describe, don’t draw first',
    body: 'Tell the agent what you want. It places real HTML and React on the board.',
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
// agent tools are the source, not the pitch.
const MORE = [
  {
    label: 'github',
    title: 'It reads your repo',
    body: 'Connect GitHub and the agent lists, searches, and reads real files — so new UI matches the components you already have.',
  },
  {
    label: 'figma',
    title: 'Import from Figma',
    body: 'Pull frames onto the board and keep going in live code instead of a flat picture.',
  },
  {
    label: 'history',
    title: 'Versions with diffs',
    body: 'Commit as you go. Compare any two points, see what was added, removed, or changed, and roll back.',
  },
  {
    label: 'mcp',
    title: 'Drive it from your editor',
    body: 'loora is an MCP server. Point Claude or Cursor at a board and it can create, edit, and branch without a browser.',
  },
  {
    label: 'chats',
    title: 'Agents in parallel',
    body: 'Run several chats at once across designs. Steer mid-generation, queue the next instruction, close the tab and come back.',
  },
  {
    label: 'share',
    title: 'Publish and hand off',
    body: 'Put a live element behind a public link, or send a read-only board to whoever just needs to look.',
  },
  {
    label: 'assets',
    title: 'Images and export',
    body: 'Upload assets the agent can place, then export the board as JSON or standalone HTML.',
  },
  {
    label: 'models',
    title: 'Bring your own account',
    body: 'Connect your ChatGPT account and generations run on your plan instead of ours.',
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
    root.classList.remove('dark')
    root.style.height = 'auto'
    body.style.height = 'auto'
    body.style.overflow = 'auto'
    body.style.overscrollBehavior = 'auto'
    return () => {
      root.style.height = prev.rootHeight
      body.style.height = prev.bodyHeight
      body.style.overflow = prev.bodyOverflow
      body.style.overscrollBehavior = prev.bodyOverscroll
      applyTheme(getThemePreference())
    }
  }, [])

  return (
    <div className="min-h-dvh bg-[#fafaf8] text-[#1a1917] antialiased">
      <header className="sticky top-0 z-50 px-4 pt-3 sm:pt-4">
        <nav className="mx-auto flex h-12 w-full max-w-[1080px] items-center justify-between rounded-full border border-[#1a1917]/8 bg-[#fafaf8]/80 pl-5 pr-2 backdrop-blur-xl">
          <p className="text-[17px] font-semibold tracking-[-0.03em]">
            loora<span style={{ color: ACCENT }}>.</span>
          </p>
          <Button render={<Link to="/" />} size="sm" className="rounded-full px-4">
            Open the board
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto w-full max-w-[820px] px-5 pb-12 pt-16 text-center sm:pb-16 sm:pt-24">
          <motion.p
            className={EYEBROW}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            the agent design harness
          </motion.p>
          <motion.h1
            className="mt-4 text-[38px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[62px]"
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
            to see the real thing.
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
            Put an agent on an infinite canvas. It builds live HTML and React in place — you steer,
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
              render={<Link to="/" />}
              size="lg"
              className="w-full rounded-full px-5 sm:w-auto"
            >
              Open the board
            </Button>
            <a
              href="#board"
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#1a1917]/10 px-5 text-sm font-medium transition-colors hover:bg-[#1a1917]/4 sm:h-9"
            >
              See it work
            </a>
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5" aria-label="Product demo">
          <motion.div
            className="overflow-hidden rounded-2xl border border-[#1a1917]/8 bg-white p-1.5 shadow-[0_1px_2px_rgba(26,25,23,0.04),0_32px_64px_-32px_rgba(26,25,23,0.28)]"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.6,
              delay: reduceMotion ? 0 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="overflow-hidden rounded-xl">
              <CanvasDemo reduceMotion={reduceMotion} />
            </div>
          </motion.div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5 py-14 sm:py-20">
          <div
            className={`grid ${CARD} divide-y divide-[#1a1917]/8 sm:grid-cols-3 sm:divide-x sm:divide-y-0`}
          >
            {BEATS.map((beat, index) => (
              <motion.div
                key={beat.title}
                className="p-5 sm:p-6"
                {...reveal(reduceMotion, 0.04 * index)}
              >
                <p className="text-[15px] font-medium tracking-[-0.02em]">{beat.title}</p>
                <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[#75726b]">{beat.body}</p>
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
              className="border-t border-[#1a1917]/8 sm:border-l sm:border-t-0"
              {...reveal(reduceMotion, 0.06)}
            >
              <BranchMock />
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
              <div className="border-b border-[#1a1917]/8 sm:border-b-0 sm:border-r">
                <LiveUiMock />
              </div>
              <div className="flex flex-col justify-center p-6 sm:p-8">
                <p className="text-[19px] font-medium tracking-[-0.03em] sm:text-[24px]">
                  Real UI, not mockups
                </p>
                <p className="mt-2.5 text-[14px] leading-[1.55] text-[#75726b] sm:text-[15px]">
                  Every element on the board is live HTML or React — the same stuff you ship,
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
                  <div className="border-b border-[#1a1917]/8">
                    <Mock />
                  </div>
                  <div className="p-5">
                    <p className="text-[16px] font-medium tracking-[-0.025em]">{item.title}</p>
                    <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[#75726b]">{item.body}</p>
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
            className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-[#1a1917]/8 bg-[#1a1917]/8 sm:grid-cols-2 lg:grid-cols-4"
            {...reveal(reduceMotion)}
          >
            {MORE.map((item) => (
              <div key={item.label} className="bg-white p-5">
                <p className="font-mono text-[10px] text-[#9b978f]">{item.label}</p>
                <p className="mt-2.5 text-[15px] font-medium tracking-[-0.02em]">{item.title}</p>
                <p className="mt-1.5 text-[13px] leading-[1.5] text-[#75726b]">{item.body}</p>
              </div>
            ))}
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
                    ? 'rounded-2xl border border-[#2440e6]/20 bg-[#2440e6]/4 p-6 sm:p-7'
                    : `${CARD} p-6 sm:p-7`
                }
                {...reveal(reduceMotion, 0.05 * index)}
              >
                <p
                  className="font-mono text-[11px]"
                  style={{ color: row.tone === 'accent' ? ACCENT : '#9b978f' }}
                >
                  {row.label}
                </p>
                <p className="mt-3 text-[15px] leading-[1.5] text-[#1a1917]/80 sm:text-base">
                  {row.body}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-5 pb-14 sm:pb-20">
          <motion.div
            className={`${PANEL} rounded-3xl border border-[#1a1917]/8 px-6 py-14 text-center sm:px-10 sm:py-20`}
            {...reveal(reduceMotion)}
          >
            <h2 className="mx-auto max-w-[520px] text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[44px]">
              Open a board. Put an agent on it.
            </h2>
            <p className={`mx-auto mt-4 max-w-[440px] ${BODY}`}>
              No mockup theater. Real UI on an infinite canvas — describe, arrange, revise, ship.
            </p>
            <div className="mt-7 flex justify-center">
              <Button render={<Link to="/" />} size="lg" className="rounded-full px-5">
                Open the board
              </Button>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-[1080px] items-center justify-between border-t border-[#1a1917]/8 px-5 py-6 text-[13px] text-[#9b978f]">
        <p className="font-medium text-[#1a1917]">
          loora<span style={{ color: ACCENT }}>.</span>
        </p>
        <p>The design harness.</p>
      </footer>
    </div>
  )
}
