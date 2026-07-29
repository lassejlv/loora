import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useReducedMotion } from 'motion/react'
import { AppChrome } from '#/components/landing/app-chrome'
import { CanvasDemo } from '#/components/landing/canvas-demo'
import { FEATURE_SECTIONS } from '#/components/landing/features'
import { usePalette } from '#/components/landing/palette'
import { LandingShell } from '#/components/landing/site-shell'

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
    const draft = typeof params.draft === 'string' ? params.draft : null
    if (draft) {
      throw redirect({
        to: '/design/$id/b/$branchId',
        params: { id, branchId: draft },
      })
    }
    throw redirect({
      to: '/design/$id',
      params: { id },
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

function LandingPage() {
  return (
    <LandingShell>
      <LandingContent />
    </LandingShell>
  )
}

function LandingContent() {
  const reduceMotion = useReducedMotion()
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <>
      <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <span aria-hidden="true" style={link}>
          |
        </span>
        <span>The agent design harness.</span>
      </h1>

      <p className="mt-6 text-muted-foreground">
        Loora is an infinite canvas of structured, responsive UI — and it is open to the agent you
        already use. Connect Claude, Codex, Cursor, or opencode over{' '}
        <Link to="/mcp" className="underline-offset-2 hover:underline" style={link}>
          MCP
        </Link>{' '}
        and it edits the same document you do.
      </p>
      <p className="mt-4 text-muted-foreground">
        Every element is editable structured UI, never a code blob. Arrange it by hand, fork a{' '}
        <Link
          to="/features"
          hash="branches"
          className="underline-offset-2 hover:underline"
          style={link}
        >
          branch
        </Link>
        , merge when it&apos;s right, then export.
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

      <h2 className="mt-16 text-[15px] font-semibold">Build on loora</h2>

      {/* Hairline grid: the parent border draws the outer rule, `gap-px` over a
          border-colored background draws the dividers. Each cell is a link into
          the matching section of the features page. */}
      <ul className="mt-5 grid gap-px border border-border bg-border sm:grid-cols-2">
        {FEATURE_SECTIONS.map((section) => (
          <li key={section.id}>
            <Link
              to="/features"
              hash={section.id}
              className="block h-full bg-background px-4 py-3 transition-colors hover:bg-card"
            >
              <span className="text-[13px] font-medium" style={link}>
                {section.title}
              </span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                {section.summary}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-[13px]">
        <Link to="/features" className="underline-offset-2 hover:underline" style={link}>
          All features →
        </Link>
      </p>

      <h2 className="mt-14 text-[15px] font-semibold">How it works</h2>
      <p className="mt-4 text-muted-foreground">
        Add the Loora MCP server to your agent once. From then on it can read the canvas and insert,
        patch, move, and delete nodes through the same typed transactions the editor uses — so
        nothing it makes is a black box you have to accept whole.
      </p>
      <p className="mt-4 text-muted-foreground">
        Design tools arrange. Chat tools dump. Loora is the surface in between: your agent builds on
        an infinite canvas, and you rearrange, branch, and ship the design.
      </p>
      <p className="mt-4">
        <Link to="/mcp" className="underline-offset-2 hover:underline" style={link}>
          Set up MCP with Claude, Codex, Cursor, or opencode →
        </Link>
      </p>

      <h2 className="mt-14 text-[15px] font-semibold">Pricing</h2>
      <p className="mt-4 text-muted-foreground">
        Free is $0/month with 50 design files and 200 MCP calls a week. Pro is $20/month for
        unlimited files, branches, 100 GB of assets, and a million calls a week.
      </p>
      <p className="mt-4">
        <Link to="/pricing" className="underline-offset-2 hover:underline" style={link}>
          See pricing →
        </Link>
      </p>

      <p className="mt-10">
        <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
          Open a design →
        </Link>
      </p>
    </>
  )
}
