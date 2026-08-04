import type { ReactNode } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useReducedMotion } from 'motion/react'
import { AppChrome } from '#/components/landing/app-chrome'
import { CanvasDemo } from '#/components/landing/canvas-demo'
import { FEATURE_SECTIONS } from '#/components/landing/features'
import { usePalette } from '#/components/landing/palette'
import { Faq } from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { resolveLegacyLandingRedirect } from '#/lib/legacy-landing-redirect'
import {
  faqSchema,
  jsonLd,
  organizationSchema,
  seo,
  softwareApplicationSchema,
  webSiteSchema,
} from '#/lib/seo'

const TITLE = 'Loora — design files your agent can edit'

const DESCRIPTION =
  'A canvas design tool with an MCP server built in. Connect Claude, Codex, Cursor, or opencode and it edits the same file you have open. Branches, version history, and export to HTML and React.'

/** Repeated on every inline link on the page; the color comes from the palette. */
const LINK = 'underline-offset-2 hover:underline'

/**
 * The questions the landing page gets asked, answered on it. Also the
 * FAQPage schema — which is only honest because the text is really here.
 */
const FAQ = [
  {
    question: 'What is Loora?',
    answer:
      'An infinite-canvas design tool with a remote MCP server built in. You arrange structured UI nodes on a canvas, and a coding agent connected over MCP edits the same document through the same validated transactions. Designs have branches, version history, and one-way export.',
  },
  {
    question: 'Which AI agents work with Loora?',
    answer:
      'Any MCP client — Claude Code, the Claude app, Codex, Cursor, VS Code with Copilot agent mode, opencode, Windsurf, Cline, Zed, Gemini CLI, Goose, and Warp all have setup guides. There is no in-app chat agent; you bring your own.',
  },
  {
    question: 'Does Loora write code?',
    answer:
      'It exports code. A design compiles deterministically to standalone HTML and CSS, React as TSX, plain JSX, Tailwind utilities, the raw JSON document, or a PNG. Export is one-way — edited code never comes back into the canvas.',
  },
  {
    question: 'Is Loora free?',
    answer:
      'There is a free plan: 50 design files, 1 GB of asset storage, 100 Agent Calls a week, 2 days of version history, and one open branch per design. Pro is $20 a month for unlimited files and branches, 50 GB, a million Agent Calls a week, and 90 days of history.',
  },
  {
    question: 'How is this different from prompting an agent for React?',
    answer:
      'The artifact. Generated code has no stable identity for the pieces inside it, so changing one thing means regenerating the file. A canvas document has addressable nodes, so an agent can change three fields on one node and you can drag it afterwards without either of you overwriting the other.',
  },
]

export const Route = createFileRoute('/')({
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
    ...seo({ title: TITLE, description: DESCRIPTION, path: '/' }),
    scripts: [
      jsonLd([
        softwareApplicationSchema({ withOffers: true }),
        organizationSchema(),
        webSiteSchema(),
        faqSchema(FAQ),
      ]),
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
      <Questions />
      <Reading />
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
        {FEATURE_SECTIONS.map((section, index) => (
          <li
            key={section.id}
            /* An odd count would leave a dead cell in the last row; let the final
               item run the full width instead. */
            className={
              FEATURE_SECTIONS.length % 2 === 1 && index === FEATURE_SECTIONS.length - 1
                ? 'sm:col-span-2'
                : undefined
            }
          >
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
        Free is $0/month with 50 design files and 100 Agent Calls a week. Pro is $20/month for
        unlimited files, branches, 50 GB of assets, and a million calls a week.
      </p>
      <p className="mt-4">
        <Link to="/pricing" className={LINK} style={link}>
          See pricing →
        </Link>
      </p>
    </Section>
  )
}

function Questions() {
  return (
    <Section title="Questions">
      <Faq entries={FAQ} />
    </Section>
  )
}

/** Keeps `/learn` and `/compare` one click from the front page rather than orphaned. */
function Reading() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <Section title="Read more">
      <p className="mt-4 text-muted-foreground">
        <a href="/learn/what-is-an-mcp-server" className={LINK} style={link}>
          What an MCP server is
        </a>{' '}
        and{' '}
        <a href="/learn/mcp-design-tool" className={LINK} style={link}>
          how an MCP design tool works
        </a>{' '}
        cover the idea from the ground up. If you are weighing this against something else,{' '}
        <a href="/compare/figma" className={LINK} style={link}>
          Loora vs Figma
        </a>{' '}
        and{' '}
        <a href="/compare/v0" className={LINK} style={link}>
          Loora vs v0
        </a>{' '}
        are the two most people want.
      </p>
      <p className="mt-4 text-[13px]">
        <a href="/learn" className={LINK} style={link}>
          All articles →
        </a>{' '}
        <span aria-hidden="true" className="select-none text-muted-foreground/40">
          |
        </span>{' '}
        <a href="/compare" className={LINK} style={link}>
          All comparisons →
        </a>
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
