import type { ReactNode } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useReducedMotion } from 'motion/react'
import { AppChrome } from '#/components/landing/app-chrome'
import { CanvasDemo } from '#/components/landing/canvas-demo'
import { FEATURE_SECTIONS } from '#/components/landing/features'
import { usePalette } from '#/components/landing/palette'
import { LandingShell } from '#/components/landing/site-shell'
import { resolveLegacyLandingRedirect } from '#/lib/legacy-landing-redirect'

const TITLE = 'loora — Design files your agent can edit'

const DESCRIPTION =
  'A canvas design tool with an MCP server built in. Connect your agent and it works on the same file you have open. Branches, version history, and export to HTML and React.'

/** Repeated on every inline link on the page; the color comes from the palette. */
const LINK = 'underline-offset-2 hover:underline'

export const Route = createFileRoute('/')({
  ssr: false,
  beforeLoad: ({ search }) => {
    const target = resolveLegacyLandingRedirect(search)
    if (!target) return
    if (target.to === '/app/billing') throw redirect({ to: '/app/billing' })
    if (target.to === '/app/integrations') {
      throw redirect({
        to: '/app/integrations',
        search: target.integration ? { integration: target.integration } : {},
      })
    }
    if (target.to === '/design/$id/b/$branchId') {
      throw redirect({
        to: '/design/$id/b/$branchId',
        params: { id: target.id, branchId: target.branchId },
      })
    }
    throw redirect({ to: '/design/$id', params: { id: target.id } })
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:image', content: '/landing-cover.png' },
    ],
  }),
  component: LandingPage,
})

function LandingPage() {
  return (
    <LandingShell>
      <Intro />
      <CanvasPreview />
      <FeatureGrid />
      <HowItWorks />
      <Pricing />
      <Closing />
    </LandingShell>
  )
}

/** Long-form sections share one rule-and-heading rhythm with `/features`. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-14 border-t border-dashed border-border pt-8">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Intro() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <section>
      <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <span aria-hidden="true" style={link}>
          |
        </span>
        <span>Design files your agent can edit.</span>
      </h1>

      <p className="mt-6 text-muted-foreground">
        Loora is a canvas design tool. Connect Claude, Codex, Cursor, or opencode over{' '}
        <Link to="/mcp" className={LINK} style={link}>
          MCP
        </Link>{' '}
        and it works on the file you have open, while you have it open.
      </p>
      <p className="mt-4 text-muted-foreground">
        Everything on the canvas is a real element with real layout, type, and color. Move things by
        hand, fork a{' '}
        <Link to="/features" hash="branches" className={LINK} style={link}>
          branch
        </Link>{' '}
        to try something, merge it when it works, then export.
      </p>

      <p className="mt-6">
        <Link to="/app" className={LINK} style={link}>
          Get started
        </Link>
      </p>
    </section>
  )
}

function CanvasPreview() {
  const reduceMotion = useReducedMotion()

  return (
    <div id="canvas" className="mt-12 scroll-mt-16">
      <AppChrome>
        <CanvasDemo reduceMotion={reduceMotion} />
      </AppChrome>
    </div>
  )
}

function FeatureGrid() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <Section title="Build on loora">
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
        <Link to="/features" className={LINK} style={link}>
          All features →
        </Link>
      </p>
    </Section>
  )
}

function HowItWorks() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <Section title="How it works">
      <p className="mt-4 text-muted-foreground">
        Add the Loora MCP server to your agent once. After that it can read the canvas and insert,
        patch, move, and delete nodes through the same typed transactions the editor uses. Its work
        lands as elements you can select, adjust, and undo.
      </p>
      <p className="mt-4">
        <Link to="/mcp" className={LINK} style={link}>
          Set up MCP with Claude, Codex, Cursor, or opencode →
        </Link>
      </p>
    </Section>
  )
}

function Pricing() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <Section title="Pricing">
      <p className="mt-4 text-muted-foreground">
        Free is $0/month with 50 design files and 200 MCP calls a week. Pro is $20/month for
        unlimited files, branches, 100 GB of assets, and a million calls a week.
      </p>
      <p className="mt-4">
        <Link to="/pricing" className={LINK} style={link}>
          See pricing →
        </Link>
      </p>
    </Section>
  )
}

function Closing() {
  const palette = usePalette()

  return (
    <p className="mt-10">
      <Link to="/app" className={LINK} style={{ color: palette.accent }}>
        Open a design →
      </Link>
    </p>
  )
}
