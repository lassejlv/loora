/**
 * The features page, as data. Every point below maps to something that ships in
 * the repo — the canvas package, the RPC layer, the MCP server, or the editor.
 */
export const FEATURE_SECTIONS = [
  {
    id: 'canvas',
    title: 'Canvas',
    summary: 'Structured pages, components, and tokens — never a code blob.',
    lead: 'One normalized document holds pages, components, frames, groups, text, shapes, vectors, images, and instances. Layout, styles, breakpoints, tokens, themes, and interactions are structured values, not class strings you have to parse back out.',
    points: [
      'Nodes render as real DOM and SVG, so what you arrange is what exports',
      'Components and instances with structured overrides',
      'Design tokens, themes, and breakpoint-level responsive overrides',
      'Every value validated at the model boundary before it enters the document',
    ],
  },
  {
    id: 'transactions',
    title: 'Typed transactions',
    summary: 'Every edit validated, undoable, and conflict-aware.',
    lead: 'Nothing writes to the document directly. Every edit — yours or an agent’s — is a validated transaction with an idempotency ID and preconditions on the fields it touches, applied through the same engine in the browser, over RPC, and over MCP.',
    points: [
      'Undo and redo over the same operation log',
      'Optimistic local apply, with unacknowledged batches queued in IndexedDB',
      'Compare-and-swap revisions on the server, applied and logged atomically',
      'Independent fields rebase automatically; only real same-field conflicts surface',
    ],
  },
  {
    id: 'mcp',
    title: 'MCP',
    summary: 'Drive the canvas from Claude, Codex, Cursor, or opencode.',
    lead: 'Connect Claude, Codex, Cursor, or opencode to the same document you have open. The agent gets a structured tool vocabulary, not a text box that returns a blob of code.',
    points: [
      'Remote streamable HTTP endpoint with OAuth 2.1 and dynamic client registration',
      'Read tools: readNode, readTree, searchNodes, getDesignContext',
      'Write tools: createPage, insertNodes, patchNodes, moveNodes, deleteNodes',
      'Screenshots and code export so the agent can check its own work',
    ],
  },
  {
    id: 'branches',
    title: 'Branches',
    summary: 'Fork a design, compare it, merge what survived.',
    lead: 'Fork a design, take an idea as far as it goes in isolation, then compare it against Main and merge the parts that survived. Branch documents are never published or exported as the live design.',
    points: [
      'createBranch, proposeBranch, compareBranch, applyBranch, closeBranch',
      'Neutral left/right semantic merge, not last-write-wins',
      'Proposed, applied, and closed branches are read-only',
      'Its own editor route, so a branch is a link you can hand to someone',
    ],
  },
  {
    id: 'history',
    title: 'History',
    summary: 'Commit as you go, compare any two points, roll back.',
    lead: 'Versions are written as you work, with a bounded transaction log behind them for idempotency, stale-revision recovery, and an audit trail of who changed what.',
    points: [
      'Commit a version at any point in the work',
      'Compare two points in the document',
      'Roll back to an earlier version',
      'Rolling retention: 2 days on Free, 90 days on Pro',
    ],
  },
  {
    id: 'exports',
    title: 'Exports',
    summary: 'HTML, React/TSX, Tailwind, JSON, and PNG — one way out.',
    lead: 'Everything derives one way from the canvas document, deterministically. Exported code never round-trips back in, so there is no hidden second source of truth.',
    points: [
      'Standalone HTML and CSS',
      'React components as TSX, plain JSX, or Tailwind utilities',
      'The raw JSON document',
      'PNG captures of a page or a single node',
    ],
  },
  {
    id: 'import',
    title: 'Import',
    summary: 'HTML/CSS snapshots as real nodes.',
    lead: 'Bring existing work in as structured nodes. Import is deliberately lossy and one-way: it converts a snapshot into validated canvas nodes rather than embedding markup you can no longer edit.',
    points: [
      'HTML and CSS snapshot conversion',
      'Computed layout, typography, color, border, and shadow styles',
      'Unsupported visual blocks are rasterized whole instead of half-approximated',
    ],
  },
  {
    id: 'github',
    title: 'GitHub',
    summary: 'Read access to the repository behind the design.',
    lead: 'Give your agent read access to the repository behind a design, so it can match the components, tokens, and conventions that already exist instead of inventing a parallel system.',
    points: [
      'Install once per account, scoped to the repositories you pick',
      'Read-only: Loora never writes to your repository',
    ],
  },
] as const
