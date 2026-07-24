import { useEffect, useRef } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { Button } from '#/components/ui/button'
import { applyTheme, getThemePreference } from '#/lib/theme'
import { fadeUp, uiTransition } from '#/lib/motion'

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

const CAPABILITIES = [
  {
    title: 'Real UI, not mockups',
    body: 'Every element on the board is live HTML or React — the same stuff you ship, rendered in place.',
  },
  {
    title: 'Agent that can see the board',
    body: 'It reads the canvas, places frames, edits code, and fixes what broke — then shows you the result.',
  },
  {
    title: 'You keep the hands',
    body: 'Select, group, resize, reorder, and open the code when the agent needs a shove.',
  },
  {
    title: 'Comments as coordinates',
    body: 'Pin a spot, say what’s wrong, and the next turn aims there. No more “make the header nicer.”',
  },
] as const

const CONTRAST = [
  {
    label: 'Chat tools',
    body: 'Dump code into a file. You paste, wire up, and hope it matches the picture in your head.',
  },
  {
    label: 'loora',
    body: 'The agent builds on an infinite canvas. You rearrange, comment, and ship from the board.',
  },
] as const

function CoverParallax({ reduceMotion }: { reduceMotion: boolean | null }) {
  const ref = useRef<HTMLElement>(null)
  const enabled = !reduceMotion
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })
  // The one parallax on the page. No spring — scroll position is already the
  // clock, and smoothing it just makes the image lag the page. The 1.1 overscale
  // is the bleed the 40px drift eats into.
  const y = useTransform(scrollYProgress, [0, 1], enabled ? [40, -40] : [0, 0])

  return (
    <motion.section
      ref={ref}
      className="relative w-full overflow-hidden bg-[#f1f0ec]"
      aria-label="Product preview"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: reduceMotion ? 0.12 : 0.5,
        delay: reduceMotion ? 0 : 0.1,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <motion.img
        src="/landing-cover.png"
        alt="loora canvas with a selected UI frame and selection handles"
        width={1536}
        height={1024}
        className="block h-auto w-full object-cover object-center will-change-transform"
        style={{ y, scale: 1.1 }}
        decoding="async"
        fetchPriority="high"
      />
    </motion.section>
  )
}

function BoardMoment({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[16/9] w-full overflow-hidden bg-[#f1f0ec] sm:aspect-[2/1]"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, #d3d1c9 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      />

      <motion.div
        className="absolute left-[8%] top-[22%] hidden h-[42%] w-[22%] border border-black/10 bg-[#fafaf8] sm:block"
        initial={reduceMotion ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.4 }}
      >
        <div className="space-y-2 p-3">
          <div className="h-2 w-12 bg-[#1a1917]/10" />
          <div className="h-2 w-full bg-[#1a1917]/8" />
          <div className="h-2 w-4/5 bg-[#1a1917]/8" />
          <div className="mt-3 h-16 w-full bg-[#1a1917]/5" />
        </div>
      </motion.div>

      <motion.div
        className="absolute left-[18%] top-[16%] h-[58%] w-[48%] sm:left-[28%] sm:w-[40%]"
        initial={reduceMotion ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, delay: reduceMotion ? 0 : 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="absolute -top-5 left-0">
          <span className="rounded-sm bg-[#2440e6] px-1.5 py-0.5 font-mono text-[9px] font-medium leading-none text-white">
            pricing
          </span>
        </div>
        <div className="relative h-full w-full border border-[#2440e6] bg-[#fafaf8]">
          <div className="flex h-full flex-col gap-2 p-4 sm:p-5">
            <div className="h-2.5 w-20 bg-[#1a1917]/15" />
            <div className="h-2 w-full bg-[#1a1917]/8" />
            <div className="h-2 w-[85%] bg-[#1a1917]/8" />
            <div className="mt-2 grid flex-1 grid-cols-2 gap-2">
              <div className="bg-[#1a1917]/5" />
              <div className="bg-[#2440e6]/10" />
            </div>
            <div className="h-8 w-28 bg-[#1a1917]" />
          </div>
          {(['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'] as const).map(
            (pos) => (
              <span
                key={pos}
                className={`absolute size-2 border border-[#2440e6] bg-[#fafaf8] ${pos}`}
              />
            ),
          )}
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-[18%] right-[8%] top-[16%] hidden w-[22%] border border-black/10 bg-[#fafaf8] sm:flex sm:flex-col"
        initial={reduceMotion ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.4, delay: reduceMotion ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="border-b border-black/8 px-3 py-2 font-mono text-[10px] text-[#75726b]">
          agent
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="self-end rounded-sm bg-[#1a1917]/8 px-2 py-1.5">
            <div className="h-1.5 w-16 bg-[#1a1917]/20" />
          </div>
          <div className="rounded-sm bg-[#2440e6]/10 px-2 py-1.5">
            <div className="h-1.5 w-20 bg-[#2440e6]/30" />
            <div className="mt-1.5 h-1.5 w-14 bg-[#2440e6]/20" />
          </div>
          <div className="mt-auto h-7 border border-black/10" />
        </div>
      </motion.div>

      <motion.div
        className="absolute right-[34%] top-[28%] flex size-6 items-center justify-center rounded-full border border-black/10 bg-[#fafaf8] text-[10px] font-medium text-[#75726b] sm:right-[38%]"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.3, delay: reduceMotion ? 0 : 0.18 }}
      >
        1
      </motion.div>
    </div>
  )
}

function LandingPage() {
  const reduceMotion = useReducedMotion()
  const enter = fadeUp(reduceMotion)
  const transition = uiTransition(reduceMotion)
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
    <div className="min-h-dvh bg-[#fafaf8] text-[#1a1917]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        <p className="text-2xl font-semibold tracking-tight sm:text-3xl">
          loora<span className="text-[#2440e6]">.</span>
        </p>
        <Button render={<Link to="/" />} size="sm">
          Get started
        </Button>
      </header>

      <main>
        <section className="mx-auto flex w-full max-w-6xl flex-col px-5 pb-8 pt-2 sm:px-8 sm:pb-10 sm:pt-4">
          <div className="max-w-2xl">
            <motion.h1
              className="text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-4xl sm:leading-[1.08]"
              initial={enter.initial}
              animate={enter.animate}
              transition={transition}
            >
              The agent design harness.
            </motion.h1>
            <motion.p
              className="mt-4 max-w-xl text-base leading-relaxed text-[#75726b] sm:text-lg"
              initial={enter.initial}
              animate={enter.animate}
              transition={{ ...transition, delay: reduceMotion ? 0 : 0.04 }}
            >
              Put an agent on an infinite canvas. It builds real UI in place — you steer, arrange, and
              ship from the board.
            </motion.p>
            <motion.div
              className="mt-6"
              initial={enter.initial}
              animate={enter.animate}
              transition={{ ...transition, delay: reduceMotion ? 0 : 0.08 }}
            >
              <Button render={<Link to="/" />} size="lg">
                Open the board
              </Button>
            </motion.div>
          </div>
        </section>

        <CoverParallax reduceMotion={reduceMotion} />

        <section className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
          <div className="grid gap-8 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-12">
            <motion.h2
              className="max-w-sm text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
              initial={enter.initial}
              whileInView={enter.animate}
              viewport={{ once: true, amount: 0.5 }}
              transition={transition}
            >
              Design tools arrange. Chat tools dump. loora does both.
            </motion.h2>
            <div className="divide-y divide-black/8 border-y border-black/8">
              {CONTRAST.map((row) => (
                <motion.div
                  key={row.label}
                  className="grid gap-2 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-8 sm:py-5"
                  initial={enter.initial}
                  whileInView={enter.animate}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={transition}
                >
                  <p className="font-mono text-[11px] text-[#75726b]">{row.label}</p>
                  <p className="text-sm leading-relaxed text-[#1a1917]/80 sm:text-base">{row.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-4 sm:px-8">
          <p className="font-mono text-[11px] tracking-wide text-[#75726b]">How it works</p>
          <ul className="mt-4 divide-y divide-black/8 border-y border-black/8">
            {BEATS.map((beat, index) => (
              <motion.li
                key={beat.title}
                className="flex gap-5 py-4 sm:gap-8 sm:py-5"
                initial={enter.initial}
                whileInView={enter.animate}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ ...transition, delay: reduceMotion ? 0 : 0.03 * index }}
              >
                <span className="w-6 shrink-0 font-mono text-[11px] tabular-nums text-[#75726b]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium sm:text-base">{beat.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#75726b]">{beat.body}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </section>

        <section className="w-full py-12 sm:py-16" aria-label="Agent on the board">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="mb-6 max-w-xl sm:mb-8">
              <p className="font-mono text-[11px] tracking-wide text-[#75726b]">On the board</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                Point at a frame. Tell it what to change.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#75726b] sm:text-base">
                The agent isn’t stuck in a sidebar monologue. It works where the UI lives — next to
                selection handles, comments, and the code behind each element.
              </p>
            </div>
          </div>
          <BoardMoment reduceMotion={reduceMotion} />
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
          <p className="font-mono text-[11px] tracking-wide text-[#75726b]">What you get</p>
          <h2 className="mt-3 max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
            A board that stays the source of truth.
          </h2>
          <ul className="mt-6 divide-y divide-black/8 border-y border-black/8">
            {CAPABILITIES.map((item, index) => (
              <motion.li
                key={item.title}
                className="grid gap-2 py-5 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:gap-12 sm:py-6"
                initial={enter.initial}
                whileInView={enter.animate}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ ...transition, delay: reduceMotion ? 0 : 0.03 * index }}
              >
                <p className="text-base font-medium">{item.title}</p>
                <p className="text-sm leading-relaxed text-[#75726b] sm:text-base">{item.body}</p>
              </motion.li>
            ))}
          </ul>
        </section>

        <section className="border-t border-black/8 bg-[#f1f0ec]">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:py-16">
            <div className="max-w-lg">
              <p className="text-3xl font-semibold tracking-tight sm:text-4xl">
                loora<span className="text-[#2440e6]">.</span>
              </p>
              <p className="mt-3 text-lg font-medium tracking-tight text-[#1a1917]/80 sm:text-xl">
                Open a board. Put an agent on it.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[#75726b] sm:text-base">
                No mockup theater. Real UI on an infinite canvas — describe, arrange, revise, ship.
              </p>
            </div>
            <Button render={<Link to="/" />} size="lg">
              Open the board
            </Button>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 text-xs text-[#75726b] sm:px-8">
        <p>
          loora<span className="text-[#2440e6]">.</span>
        </p>
        <p>The design harness.</p>
      </footer>
    </div>
  )
}
