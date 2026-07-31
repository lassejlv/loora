/**
 * The features page, as data. Every point below maps to something that ships in
 * the repo — the canvas package, the RPC layer, the MCP server, or the editor.
 */
export const FEATURE_SECTIONS = [
  {
    id: 'canvas',
    title: 'Canvas',
    summary: 'Pages, components, and tokens stored as structured data.',
    lead: 'One normalized document holds pages, components, frames, groups, text, shapes, vectors, images, and instances. Layout, styles, breakpoints, tokens, themes, and interactions are stored as values you can read and set directly.',
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
    lead: 'Nothing writes to the document directly. Every edit, yours or an agent’s, is a validated transaction carrying an idempotency ID and preconditions on the fields it touches. The browser, the RPC layer, and MCP all run them through the same engine.',
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
    lead: 'Connect Claude, Codex, Cursor, or opencode to the document you have open. The agent gets typed tools for reading and changing nodes, and its edits go through the same path yours do.',
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
    summary: 'Fork a design, compare it, merge the parts you keep.',
    lead: 'Fork a design, take the idea as far as it goes in isolation, then compare it against Main and merge the parts you keep. A branch is never exported or shared as the live design.',
    points: [
      'createBranch, proposeBranch, compareBranch, applyBranch, closeBranch',
      'Neutral left/right semantic merge, not last-write-wins',
      'Proposed, applied, and closed branches are read-only',
      'Each branch has its own editor route, so you can hand it over as a link',
    ],
  },
  {
    id: 'history',
    title: 'History',
    summary: 'Commit as you go, compare any two points, roll back.',
    lead: 'Versions are written as you work, with a bounded transaction log behind them for idempotency, stale-revision recovery, and a record of who changed what.',
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
    summary: 'HTML, React/TSX, Tailwind, JSON, and PNG.',
    lead: 'Exports are generated from the canvas document and are deterministic: the same document gives you the same output. Exported code does not come back in, so the document stays the only thing you edit.',
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
    lead: 'Bring existing work in as canvas nodes. Import is one-way and lossy on purpose: it converts a snapshot into validated nodes instead of embedding markup you cannot edit afterwards.',
    points: [
      'HTML and CSS snapshot conversion',
      'Computed layout, typography, color, border, and shadow styles',
      'Unsupported visual blocks are rasterized whole rather than approximated',
    ],
  },
] as const
