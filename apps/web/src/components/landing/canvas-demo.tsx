import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useScroll, useTransform } from 'motion/react'
import { usePalette } from '#/components/landing/palette'
import { DotField, Handles, StreamWire, Wire } from '#/components/landing/wireframe'

const PANEL = 'bg-cx-canvas'

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

export function CanvasDemo({ reduceMotion }: { reduceMotion: boolean | null }) {
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
