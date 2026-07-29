/** Keep in sync with `SubscriptionScreen` / Polar products. */
export const PLANS = [
  {
    plan: 'Pro',
    price: '$20',
    includes: 'Canvas, branches, MCP, and exports',
    note: '3-day free trial',
    cta: 'Start free trial',
  },
  {
    plan: 'Studio',
    price: '$49',
    includes: 'Pro plus priority support',
    note: 'For teams',
    cta: 'Choose Studio',
  },
] as const

/**
 * What a plan actually unlocks. Every row is a shipped surface — no roadmap
 * entries, and no per-seat or usage metering, because billing is plan access
 * only.
 */
export const PLAN_INCLUDES = [
  { capability: 'Canvas editor', detail: 'Infinite canvas, components, tokens, breakpoints' },
  { capability: 'Branches', detail: 'Fork a design, compare, merge back into Main' },
  { capability: 'MCP server', detail: 'Drive the same document from Claude or Cursor' },
  { capability: 'Exports', detail: 'HTML/CSS, React/TSX, JSON, and PNG captures' },
  { capability: 'History', detail: 'Versions, comparison, and rollback' },
  { capability: 'Integrations', detail: 'Figma import and GitHub read access' },
] as const
