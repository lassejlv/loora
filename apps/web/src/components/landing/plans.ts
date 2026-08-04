/** Keep in sync with `SubscriptionScreen` / Polar products. */
export const PLANS = [
  {
    plan: 'Free',
    price: '$0',
    period: '/month',
    annual: null,
    summary: 'Enough to build something real before you pay for anything.',
    features: [
      '50 design files',
      '1 GB asset storage',
      '100 Agent Calls / week',
      '2 days of version history',
      '1 open branch per design',
    ],
    cta: 'Start free',
    featured: false,
  },
  {
    plan: 'Pro',
    price: '$20',
    period: '/month',
    // Two months off the monthly rate: 10 × $20.
    annual: '$200 / year',
    summary: 'Everything in Free, at production limits.',
    features: [
      'Unlimited design files',
      '50 GB asset storage',
      '1,000,000 Agent Calls / week',
      '90 days of version history',
      'Unlimited branches',
    ],
    cta: 'Go Pro',
    featured: true,
  },
] as const

/**
 * The surfaces both plans get. Branches and history depth are Pro limits, so
 * they live in the cards instead — everything listed here is genuinely shared.
 */
export const PLAN_INCLUDES = [
  { capability: 'Canvas editor', detail: 'Pages, components, tokens, breakpoints' },
  { capability: 'MCP server', detail: 'Drive the same document from Claude or Cursor' },
  { capability: 'Exports', detail: 'HTML/CSS, React/TSX, JSON, and PNG captures' },
] as const
