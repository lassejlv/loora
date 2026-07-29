import { createFileRoute, Link } from '@tanstack/react-router'
import { usePalette } from '#/components/landing/palette'
import { PLAN_INCLUDES, PLANS } from '#/components/landing/plans'
import { LandingShell } from '#/components/landing/site-shell'
import { Td, TableScroll, Th } from '#/components/landing/table'

const DESCRIPTION =
  'Pro is $20/month after a 3-day free trial, Studio is $49/month. Both include the full canvas, branches, exports, history, and the MCP server. No AI credits.'

export const Route = createFileRoute('/pricing')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Pricing — loora' },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: 'Pricing — loora' },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:image', content: '/landing-cover.png' },
    ],
  }),
  component: PricingPage,
})

function PricingPage() {
  return (
    <LandingShell>
      <PricingContent />
    </LandingShell>
  )
}

function PricingContent() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <>
      <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <span aria-hidden="true" style={link}>
          |
        </span>
        <span>Pricing.</span>
      </h1>

      <p className="mt-6 text-muted-foreground">
        One subscription unlocks the product. You connect the agent you already pay for over{' '}
        <a
          href="https://mcp.loora.design"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
          style={link}
        >
          MCP
        </a>
        , so there are no AI credits, no top-ups, and no per-generation metering.
      </p>

      <h2 className="mt-12 text-[15px] font-semibold">Plans</h2>

      <TableScroll label="Plans">
        <thead>
          <tr>
            <Th>Plan</Th>
            <Th>Price</Th>
            <Th>Includes</Th>
            <Th>Notes</Th>
            <Th>Start</Th>
          </tr>
        </thead>
        <tbody>
          {PLANS.map((row) => (
            <tr key={row.plan}>
              <Td strong>{row.plan}</Td>
              <Td>
                {row.price}
                <span className="text-muted-foreground">/month</span>
              </Td>
              <Td muted>{row.includes}</Td>
              <Td muted>{row.note}</Td>
              <Td>
                <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
                  {row.cta}
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableScroll>

      <h2 className="mt-14 text-[15px] font-semibold">What every plan includes</h2>
      <p className="mt-4 text-muted-foreground">
        Studio is Pro plus priority support — it does not gate features. Nothing below is held back
        for the higher tier.
      </p>

      <TableScroll label="Included capabilities">
        <thead>
          <tr>
            <Th>Capability</Th>
            <Th>What you get</Th>
          </tr>
        </thead>
        <tbody>
          {PLAN_INCLUDES.map((row) => (
            <tr key={row.capability}>
              <Td strong>{row.capability}</Td>
              <Td muted>{row.detail}</Td>
            </tr>
          ))}
        </tbody>
      </TableScroll>

      <h2 className="mt-14 text-[15px] font-semibold">Billing</h2>
      <p className="mt-4 text-muted-foreground">
        Pro is free for 3 days, then $20/month unless canceled. Everything is unlocked during the
        trial, including the MCP server. Subscriptions are handled by Polar, and you can change or
        cancel a plan from the billing screen in the app.
      </p>
      <p className="mt-4 text-muted-foreground">
        Nothing is billed per generation: the agent you connect runs on its own plan with its own
        key, and Loora never resells model usage.
      </p>

      <p className="mt-10">
        <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
          Start the free trial →
        </Link>
      </p>
      <p className="mt-4">
        <Link to="/" className="underline-offset-2 hover:underline" style={link}>
          ← Back to the canvas
        </Link>
      </p>
    </>
  )
}
