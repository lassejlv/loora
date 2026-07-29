import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useReducedMotion } from 'motion/react'
import { AppChrome } from '#/components/landing/app-chrome'
import { CanvasDemo } from '#/components/landing/canvas-demo'
import { usePalette } from '#/components/landing/palette'
import { LandingShell } from '#/components/landing/site-shell'
import { Td, TableScroll, Th } from '#/components/landing/table'

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
] as const

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
        already use. Connect Claude or Cursor over{' '}
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
        <Link to="/" hash="features" className="underline-offset-2 hover:underline" style={link}>
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

      <h2 id="features" className="mt-16 scroll-mt-16 text-[15px] font-semibold">
        Build on loora
      </h2>

      <TableScroll label="Products">
        <thead>
          <tr>
            <Th>Product</Th>
            <Th>Description</Th>
            <Th>Explore</Th>
          </tr>
        </thead>
        <tbody>
          {FEATURES.map((row) => (
            <tr key={row.product}>
              <Td strong>{row.product}</Td>
              <Td muted>{row.description}</Td>
              <Td>
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
                  <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
                    Open
                  </Link>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableScroll>

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

      <h2 className="mt-14 text-[15px] font-semibold">Pricing</h2>
      <p className="mt-4 text-muted-foreground">
        Two plans, both with the full editor and the MCP server. You bring your own agent, so there
        are no AI credits to buy or run out of.
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
