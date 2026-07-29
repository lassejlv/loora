/** Keep in sync with `SubscriptionScreen` / Polar products. */
export const PLANS = [
  {
    plan: 'Free',
    price: '$0',
    period: '/month',
    annual: null,
    summary: 'Enough to build something real before you pay for anything.',
    features: ['50 design files', '1 GB asset storage', '200 MCP calls / week'],
    cta: 'Start free',
    featured: false,
  },
  {
    plan: 'Pro',
    price: '$20',
    period: '/month',
    // Two months off the monthly rate: 10 × $20.
    annual: '$200 / year',
    summary: 'For daily design work and agents that run all week.',
    features: [
      'Unlimited design files',
      '100 GB asset storage',
      '1,000,000 MCP calls / week',
      'In-app agent access',
      'Image generation',
      'Team workspace, up to 5 users',
    ],
    cta: 'Go Pro',
    featured: true,
  },
] as const

/**
 * What the product does on either plan. Every row is a shipped surface — no
 * roadmap entries, and nothing here is gated behind Pro; Pro raises the limits
 * in the cards above.
 */
export const PLAN_INCLUDES = [
  { capability: 'Canvas editor', detail: 'Infinite canvas, components, tokens, breakpoints' },
  { capability: 'Branches', detail: 'Fork a design, compare, merge back into Main' },
  { capability: 'MCP server', detail: 'Drive the same document from Claude or Cursor' },
  { capability: 'Exports', detail: 'HTML/CSS, React/TSX, JSON, and PNG captures' },
  { capability: 'History', detail: 'Versions, comparison, and rollback' },
  { capability: 'Integrations', detail: 'Figma import and GitHub read access' },
] as const
