import { createFileRoute, Link } from '@tanstack/react-router'
import { usePalette } from '#/components/landing/palette'
import { PLAN_INCLUDES, PLANS } from '#/components/landing/plans'
import { LandingShell } from '#/components/landing/site-shell'

const DESCRIPTION =
  'Free is $0/month with 50 design files, 1 GB of assets, 200 MCP calls a week, 2 days of version history, and 1 open branch per design. Pro is $20/month, or $200 a year, for unlimited files, 100 GB, 1M MCP calls a week, 90-day history, and unlimited branches.'

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
        Start free and keep the whole editor. Pro raises the limits: more files, more storage, more
        MCP calls, and a longer history window. Capacity is the only thing you pay for.
      </p>

      {/* Hairline grid: the parent border carries the outer rule, `gap-px` over a
          border-colored background draws the divider. No doubled 2px seams. */}
      <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
        {PLANS.map((tier) => (
          <div key={tier.plan} className="flex flex-col bg-background p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold" style={tier.featured ? link : undefined}>
                {tier.plan}
              </h2>
              {tier.featured && (
                <span
                  className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                  style={{ background: palette.accent, color: palette.accentInk }}
                >
                  Recommended
                </span>
              )}
            </div>

            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-[26px] font-semibold leading-none tracking-[-0.02em]">
                {tier.price}
              </span>
              <span className="text-[12px] text-muted-foreground">{tier.period}</span>
            </p>
            <p className="mt-1 min-h-[1.4em] text-[12px] text-muted-foreground">
              {tier.annual ? `or ${tier.annual} — two months off` : 'No card required'}
            </p>

            <p className="mt-4 text-[13px] text-muted-foreground">{tier.summary}</p>

            <ul className="mt-5 flex flex-col gap-1.5 text-[13px]">
              {tier.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span aria-hidden="true" className="select-none" style={link}>
                    +
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <p className="mt-auto pt-6">
              <Link
                to="/app"
                className={
                  tier.featured
                    ? 'inline-block px-2.5 py-1 text-[13px] font-medium text-white'
                    : 'inline-block border border-border px-2.5 py-1 text-[13px] font-medium transition-colors hover:border-foreground'
                }
                style={tier.featured ? { background: palette.accent } : undefined}
              >
                {tier.cta}
              </Link>
            </p>
          </div>
        ))}
      </div>

      <h2 className="mt-14 text-[15px] font-semibold">On both plans</h2>
      <p className="mt-4 text-muted-foreground">
        Free is the whole editor, not a demo of it. Pro raises the numbers in the cards above;
        everything below ships on either plan.
      </p>

      <ul className="mt-6 grid gap-px border border-border bg-border sm:grid-cols-2">
        {PLAN_INCLUDES.map((row, index) => (
          <li
            key={row.capability}
            /* Same as the landing grid: an odd count would leave a dead cell. */
            className={
              PLAN_INCLUDES.length % 2 === 1 && index === PLAN_INCLUDES.length - 1
                ? 'bg-background px-4 py-3 sm:col-span-2'
                : 'bg-background px-4 py-3'
            }
          >
            <p className="text-[13px] font-medium">{row.capability}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{row.detail}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-14 text-[15px] font-semibold">Billing</h2>
      <p className="mt-4 text-muted-foreground">
        Free needs no card and does not expire. Pro is $20/month, or $200 billed yearly, and you can
        upgrade, change, or cancel it from the billing screen in the app. Subscriptions run through
        Polar.
      </p>
      <p className="mt-4 text-muted-foreground">
        MCP calls are counted per week and reset weekly. Asset storage is the total size of the
        images and files in your account. Version history is a rolling window: 2 days on Free, 90
        days on Pro. An external agent you connect over{' '}
        <a
          href="https://mcp.loora.design"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
          style={link}
        >
          MCP
        </a>{' '}
        runs on its own plan and its own key.
      </p>

      <p className="mt-10">
        <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
          Start free →
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
