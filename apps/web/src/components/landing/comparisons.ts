/**
 * The `/compare` pages.
 *
 * Rule for anything written here: it has to be defensible. Every row states
 * what each tool does rather than who wins, and every page carries a section
 * naming the cases where the other tool is the right answer. A comparison page
 * that cannot say that is marketing wearing a table, and it reads that way to
 * both people and crawlers.
 *
 * Competitor behaviour changes. `verified` is the date these claims were last
 * checked, and it is printed on the page.
 */

export const COMPARISON_VERIFIED = '2026-08-02'

export type Comparison = {
  slug: string
  /** The other product, spelled the way its makers spell it. */
  other: string
  /** `<h1>`. */
  headline: string
  /** Hub grid line. */
  tagline: string
  description: string
  /** The short answer, above the table, for the reader who leaves after one paragraph. */
  summary: string
  /** `aspect` is the question both columns answer. */
  table: readonly { aspect: string; loora: string; other: string }[]
  /** Honest, and first — a page that leads with its own strengths is not read as a comparison. */
  otherWins: readonly string[]
  looraWins: readonly string[]
  verdict: string
  faq: readonly { question: string; answer: string }[]
  related: readonly string[]
}

export const COMPARISONS: readonly Comparison[] = [
  {
    slug: 'figma',
    other: 'Figma',
    headline: 'Loora vs Figma',
    tagline: 'A design file an agent can write to, against the industry standard.',
    description:
      'How Loora and Figma differ: agent write access over MCP, branching and merge, and export, against Figma’s ecosystem, multiplayer, and prototyping depth.',
    summary:
      'Figma is a mature, general-purpose design tool with an ecosystem nothing else matches. Loora is narrower on purpose: a structured canvas whose document a coding agent can read and write directly over MCP, with branches, a transaction log, and one-way code export. If your work is a team design practice, Figma. If your work is a design file that you and an agent both edit, Loora.',
    table: [
      {
        aspect: 'Agent access',
        loora: 'Read and write over a remote MCP server — 33 typed tools that create pages, insert and patch nodes, set tokens, and apply motion',
        other: 'An MCP server aimed at giving an agent context from a selection for code generation, rather than a full authoring vocabulary',
      },
      {
        aspect: 'Document model',
        loora: 'Normalized canvas document; every edit is a validated transaction with preconditions and an idempotency ID',
        other: 'Proprietary document, reached through the plugin API and REST API',
      },
      {
        aspect: 'Branching',
        loora: 'Branches on every plan, with a neutral left/right semantic merge and a compare view',
        other: 'Branching and merge, on the higher paid tiers',
      },
      {
        aspect: 'Multiplayer',
        loora: 'Realtime canvas sync and collaborator cursors',
        other: 'Realtime multiplayer, and the benchmark for it',
      },
      {
        aspect: 'Export',
        loora: 'One-way: HTML/CSS, React/TSX, plain JSX, Tailwind, JSON, PNG',
        other: 'Dev Mode inspection, CSS and platform snippets, plus a large plugin market for codegen',
      },
      {
        aspect: 'Prototyping',
        loora: 'Transitions, keyframe animations, and hover, press, and focus states that export as CSS',
        other: 'Deep interactive prototyping with flows, overlays, and variables',
      },
      {
        aspect: 'Ecosystem',
        loora: 'Small and new; the MCP vocabulary is the extension point',
        other: 'Thousands of plugins, widgets, community files, and a hiring pool that already knows it',
      },
      {
        aspect: 'Free tier',
        loora: '50 design files, 1 GB assets, 100 Agent Calls a week, 2 days of history',
        other: 'A generous free tier with limits on files per project and on Dev Mode',
      },
      {
        aspect: 'Pricing',
        loora: '$20 / month for Pro',
        other: 'Per-seat, by role, and steps up quickly for full editors',
      },
    ],
    otherWins: [
      'You have an existing design system, component libraries, and files in Figma. Migration is real work, and import is a snapshot rather than a conversion.',
      'You need deep interactive prototyping — flows, overlays, prototype variables, user testing handoff.',
      'You need the plugin ecosystem, or a specific plugin your process depends on.',
      'You are hiring designers who already know the tool, and onboarding time matters more than agent access.',
      'Your team is large enough that permissions, org libraries, and branching governance are the product you are buying.',
    ],
    looraWins: [
      'You want an agent to build the design, not describe it — insert nodes, set tokens, and apply motion against the live document.',
      'You want the design file and the code to stay separate, with export as a deterministic one-way step.',
      'You want branching and version history on every plan rather than as a tier upgrade.',
      'You work primarily from a terminal or an editor, and want the design surface reachable from the same place.',
      'You want every change to be an auditable transaction, not an opaque save.',
    ],
    verdict:
      'These are not the same category yet. Figma is where design teams work; Loora is where an agent and a person can edit the same structured file without one of them dropping to code. Plenty of people will use both — design the system in Figma, iterate on the surface in Loora with an agent.',
    faq: [
      {
        question: 'Can I import my Figma file into Loora?',
        answer:
          'Not directly. Loora imports HTML and CSS snapshots and converts them into validated nodes, so the practical route is to export or publish a frame as HTML and import that. It is a one-way snapshot, not a conversion, and anything unsupported is rasterized whole rather than approximated.',
      },
      {
        question: 'Is Loora a Figma alternative?',
        answer:
          'For agent-driven interface work, yes. For a full team design practice — prototyping depth, plugin ecosystem, org libraries — not yet, and it is not trying to be. The honest framing is that Loora is a design file your agent can write to.',
      },
      {
        question: 'Does Figma have an MCP server?',
        answer:
          'Figma ships an MCP server oriented at giving an agent context about a selected frame so it can generate code. That is a different job from Loora’s, where the MCP tools are the authoring vocabulary and the agent’s edits land in the design document itself.',
      },
    ],
    related: ['figma-mcp', 'penpot', 'framer'],
  },
  {
    slug: 'figma-mcp',
    other: 'the Figma MCP server',
    headline: 'Loora MCP vs the Figma MCP server',
    tagline: 'Write access to a design document, against context for code generation.',
    description:
      'The Figma MCP server gives an agent context about a selected frame. The Loora MCP server gives it a typed authoring vocabulary over the design document itself. What that changes in practice.',
    summary:
      'Both are MCP servers with design in the name, and they solve opposite halves of the problem. Figma’s is read-shaped: point at a selection, get structure and code hints so an agent can implement it. Loora’s is write-shaped: 33 typed tools that create pages, insert and patch nodes, set tokens, apply motion, and branch — the agent authors the design rather than transcribing one.',
    table: [
      {
        aspect: 'Primary direction',
        loora: 'Read and write. The agent changes the document.',
        other: 'Read. The agent learns what the design already is.',
      },
      {
        aspect: 'Transport',
        loora: 'Remote streamable HTTP at mcp.loora.design, OAuth 2.1 with PKCE and dynamic client registration',
        other: 'A local server alongside the desktop app, reached over localhost',
      },
      {
        aspect: 'Setup',
        loora: 'One URL in your client, then a browser sign-in',
        other: 'Desktop app running, the server enabled in preferences, client pointed at the local port',
      },
      {
        aspect: 'Selection',
        loora: 'No selection needed — tools address nodes by ID, or search for them',
        other: 'Generally anchored to what is selected in the app',
      },
      {
        aspect: 'Write vocabulary',
        loora: 'createPage, insertNodes, patchNodes, moveNodes, deleteNodes, createComponent, createInstance, setTokens, setAnimations, animateNodes',
        other: 'Not the point of the server; changing the file is the plugin API’s job',
      },
      {
        aspect: 'Verification',
        loora: 'viewCanvas, viewPage, viewNode, and getScreenshot render the real document so the model can look at its own work',
        other: 'Image and code representations of the selected frame',
      },
      {
        aspect: 'Safety',
        loora: 'Every write is a validated transaction with preconditions, logged, undoable, and branchable',
        other: 'Reads do not mutate, which is its own kind of safe',
      },
      {
        aspect: 'Runs headless',
        loora: 'Yes — a remote endpoint, so CI and a server-side agent both work',
        other: 'Needs the desktop app open',
      },
    ],
    otherWins: [
      'Your design already exists in Figma and the job is to implement it faithfully in code.',
      'You want an agent to match an established design system that lives in Figma variables and components.',
      'You do not want an agent writing to design files at all — a read-only surface is a deliberate, reasonable choice.',
    ],
    looraWins: [
      'You want the agent to produce the design, iterate on it, and be corrected by hand on the same canvas.',
      'You need it to run without a desktop app open — CI, a hosted agent, a phone.',
      'You want the agent’s changes reviewable: a transaction log, version history, and a branch you can throw away.',
      'You want screenshots of the actual document fed back to the model so it can see what it built.',
    ],
    verdict:
      'If the design is the input, Figma’s server is the right shape. If the design is the output, you need write tools, verification, and something to undo with — which is what Loora’s server is.',
    faq: [
      {
        question: 'Can an MCP server edit a design file?',
        answer:
          'Loora’s can. Its tools go through the same validated transaction path as the editor, so an agent’s edits are ordinary document changes: inspectable, undoable, and available to roll back from version history.',
      },
      {
        question: 'Does the Loora MCP server need an app running locally?',
        answer:
          'No. It is a remote streamable HTTP endpoint. Your client connects over the network and signs in with OAuth, so a headless agent works exactly like a desktop one.',
      },
      {
        question: 'Can I use both servers at once?',
        answer:
          'Yes, and it is a sensible combination: read an existing system out of Figma, build the new surface in Loora, export the result as React or HTML.',
      },
    ],
    related: ['figma', 'v0', 'framer'],
  },
  {
    slug: 'framer',
    other: 'Framer',
    headline: 'Loora vs Framer',
    tagline: 'A design file with agent write access, against a design-and-publish site builder.',
    description:
      'Framer designs and hosts the site. Loora is a structured design file an agent can edit over MCP, exported as code you host yourself. Where each one fits.',
    summary:
      'Framer’s value is that design and publishing are one product: you lay a site out and it is live, with a CMS, forms, and hosting behind it. Loora does not host anything. It is a canvas document that an agent can author over MCP, with branches and history, and its output is code you take away. Choose Framer to ship a marketing site; choose Loora when the design file itself is the artifact and an agent works on it with you.',
    table: [
      {
        aspect: 'Output',
        loora: 'HTML/CSS, React/TSX, plain JSX, Tailwind, JSON, PNG — exported, then yours',
        other: 'A hosted site on Framer, with a custom domain',
      },
      {
        aspect: 'Agent access',
        loora: 'Remote MCP server with a full typed authoring vocabulary',
        other: 'AI features inside the product; no agent-facing authoring protocol',
      },
      {
        aspect: 'Hosting',
        loora: 'None — you deploy the export wherever you like',
        other: 'Included, and a large part of what you are paying for',
      },
      {
        aspect: 'CMS',
        loora: 'None',
        other: 'Built-in collections, with dynamic pages off them',
      },
      {
        aspect: 'Motion',
        loora: 'Transitions, keyframe animations, and hover, press, and focus states, generated as CSS in the export',
        other: 'Deep scroll and interaction effects, tuned in the editor',
      },
      {
        aspect: 'Versioning',
        loora: 'Branches with semantic merge, version history, and a transaction log',
        other: 'Page history and undo',
      },
      {
        aspect: 'Code ownership',
        loora: 'The export is standalone and does not come back in',
        other: 'The site lives in Framer; code components extend it',
      },
      {
        aspect: 'Pricing',
        loora: 'Free, or $20 / month',
        other: 'Per-site, by traffic and CMS needs, plus per-editor seats',
      },
    ],
    otherWins: [
      'You want the site live today with a domain, forms, analytics, and a CMS, and you do not want to run infrastructure.',
      'You are building a marketing site where scroll effects and polish are the product.',
      'Non-technical teammates need to edit page content after launch.',
      'You would rather never see the generated code.',
    ],
    looraWins: [
      'The design has to end up inside an existing codebase, as React or plain HTML.',
      'You want an agent doing the layout work through typed tools rather than a chat that regenerates a page.',
      'You want branches for speculative changes and a history you can roll back.',
      'You are designing app surfaces — dashboards, settings, flows — rather than a marketing site.',
    ],
    verdict:
      'Framer is a way to publish a site. Loora is a way to design one with an agent and take the code. They overlap on the canvas and nowhere else.',
    faq: [
      {
        question: 'Can Loora host my site?',
        answer:
          'No. Loora exports HTML and CSS, React/TSX, JSX, Tailwind, JSON, and PNG, and you host the result. If hosting is the thing you want bundled, Framer is a better fit.',
      },
      {
        question: 'Does Framer have an MCP server?',
        answer:
          'Framer’s AI features live inside the product rather than being exposed as an agent-facing authoring protocol. Loora’s point is the opposite: the MCP tools are how the document is written, and the editor uses the same operations.',
      },
      {
        question: 'Which is better for a web app UI?',
        answer:
          'Loora, mostly. Framer is strongest on marketing pages. App surfaces — dense layouts, components, tokens, states — are what a structured canvas with export is for.',
      },
    ],
    related: ['figma', 'v0', 'lovable'],
  },
  {
    slug: 'penpot',
    other: 'Penpot',
    headline: 'Loora vs Penpot',
    tagline: 'Agent-editable canvas, against open-source and self-hosted.',
    description:
      'Penpot is open source and self-hostable, built on web standards. Loora is a hosted canvas an agent edits over MCP. What each one is actually for.',
    summary:
      'Penpot is the credible open-source design tool: free, self-hostable, SVG and CSS underneath, with a plugin system and no seat pricing. Loora is hosted and paid above a free tier, and what you get for that is an MCP server that lets a coding agent author the document directly, plus branches, a transaction log, and code export. If control of your own data and infrastructure is the requirement, Penpot. If agent write access is, Loora.',
    table: [
      {
        aspect: 'Licence',
        loora: 'AGPL-3.0 source, hosted service',
        other: 'Open source, and self-hosting is a first-class path',
      },
      {
        aspect: 'Self-hosting',
        loora: 'Not a supported product path',
        other: 'Yes — Docker, on your own infrastructure',
      },
      {
        aspect: 'Agent access',
        loora: 'Remote MCP server with 33 typed tools',
        other: 'A plugin API you can build against',
      },
      {
        aspect: 'Underlying model',
        loora: 'Normalized canvas document, rendered as real DOM and SVG',
        other: 'SVG and CSS, close to what a browser draws',
      },
      {
        aspect: 'Branching',
        loora: 'Branches with semantic merge, on every plan',
        other: 'Versions and history',
      },
      {
        aspect: 'Export',
        loora: 'HTML/CSS, React/TSX, JSX, Tailwind, JSON, PNG',
        other: 'SVG, PDF, PNG, and inspectable CSS',
      },
      {
        aspect: 'Cost',
        loora: 'Free tier, $20 / month for Pro',
        other: 'Free, including for teams',
      },
    ],
    otherWins: [
      'Your data has to stay on infrastructure you control.',
      'Cost matters more than agent tooling — Penpot is free for teams of any size.',
      'You want to modify the tool itself, not just script it.',
      'You are already comfortable extending it through the plugin API.',
    ],
    looraWins: [
      'You want an agent that authors the design through a typed vocabulary, over a protocol clients already speak.',
      'You want branches, a transaction log, and rollback as ordinary parts of the tool.',
      'You want React/TSX and Tailwind output rather than SVG and CSS inspection.',
      'You would rather not operate the service yourself.',
    ],
    verdict:
      'Penpot answers "who owns this". Loora answers "can my agent edit this". Both are real questions; they are just not the same one.',
    faq: [
      {
        question: 'Is Loora open source?',
        answer:
          'The source is AGPL-3.0 and public, but the product is a hosted service and self-hosting is not a supported path. If self-hosting is a requirement rather than a preference, Penpot is the safer choice.',
      },
      {
        question: 'Can Penpot be driven by an AI agent?',
        answer:
          'You can build against its plugin API, which means writing and maintaining the integration yourself. Loora ships the agent surface as the product: a remote MCP endpoint any compliant client can connect to.',
      },
      {
        question: 'Which exports better code?',
        answer:
          'They aim at different outputs. Penpot inspects to CSS and exports SVG. Loora compiles the document to standalone HTML/CSS, React/TSX, JSX, or Tailwind, deterministically — the same document always produces the same output.',
      },
    ],
    related: ['figma', 'framer', 'figma-mcp'],
  },
  {
    slug: 'v0',
    other: 'v0',
    headline: 'Loora vs v0',
    tagline: 'A design document you keep, against generated code you keep.',
    description:
      'v0 turns a prompt into React code. Loora turns an agent into an editor of a structured design file, and exports code at the end. Which artifact you want to own.',
    summary:
      'v0 generates React and Tailwind from a prompt: the code is the artifact, and you iterate by prompting again or editing the code. Loora keeps a structured design document in the middle — the agent edits nodes, tokens, and components through typed tools, you drag things around by hand on the same canvas, and code comes out at the end. The question is whether you want to iterate on code or on a design file.',
    table: [
      {
        aspect: 'The artifact',
        loora: 'A canvas document; code is a one-way export',
        other: 'React and Tailwind source, from the first response',
      },
      {
        aspect: 'Manual editing',
        loora: 'Direct manipulation on the canvas, and the agent sees the result',
        other: 'Edit the code, in v0 or in your editor',
      },
      {
        aspect: 'Iteration',
        loora: 'Targeted: patchNodes changes one node’s fields without regenerating anything else',
        other: 'Conversational: a new response, often regenerating a component',
      },
      {
        aspect: 'Which agent',
        loora: 'Yours — Claude, Codex, Cursor, opencode, and anything else that speaks MCP',
        other: 'The hosted model, inside the product',
      },
      {
        aspect: 'Design system',
        loora: 'Tokens, components, instances, themes, and breakpoints as structured values',
        other: 'shadcn/ui and Tailwind conventions in the generated code',
      },
      {
        aspect: 'History',
        loora: 'Version history, transaction log, branches with merge',
        other: 'Chat history and forks of a generation',
      },
      {
        aspect: 'Ceiling',
        loora: 'A design tool: layout, tokens, states, motion — not application logic',
        other: 'Real components with logic, wired up and running',
      },
    ],
    otherWins: [
      'You want running React with state and logic, not a design of it.',
      'You are prototyping something interactive where the behaviour is the point.',
      'You want shadcn/ui conventions out of the box in a Next.js project.',
      'A chat loop is genuinely the fastest path for what you are making.',
    ],
    looraWins: [
      'You want a design file that survives the conversation — versioned, branchable, and editable by hand.',
      'You want to nudge one element without a model regenerating the page around it.',
      'You want your own agent, in your own editor, with your own context.',
      'You want tokens and components to be real structure rather than a convention in generated code.',
    ],
    verdict:
      'v0 is the fastest way to get running code. Loora is the way to keep a design file that both you and an agent can edit, and get code out when you want it. If you have ever lost a good layout to a regeneration, that is the difference.',
    faq: [
      {
        question: 'Does Loora generate React code?',
        answer:
          'It exports it. exportCode compiles the canvas document to React/TSX, plain JSX, Tailwind utilities, standalone HTML and CSS, JSON, or a PNG. The export is deterministic and one-way — edited code never returns to the canvas.',
      },
      {
        question: 'Can I use my own model with Loora?',
        answer:
          'Yes, that is the design. Loora has no in-app chat agent. You connect whatever client you already use over MCP, and it runs on your context and your subscription.',
      },
      {
        question: 'Why keep a design document at all instead of just code?',
        answer:
          'Because code is a bad thing to point at. A structured document lets an agent address one node, change three fields, and leave everything else untouched — and lets you drag that node afterwards without the two of you fighting over the same file.',
      },
    ],
    related: ['lovable', 'figma-mcp', 'framer'],
  },
  {
    slug: 'lovable',
    other: 'Lovable',
    headline: 'Loora vs Lovable',
    tagline: 'A design surface for your agent, against a full app generator.',
    description:
      'Lovable builds and deploys a whole application from prompts. Loora is a design file your own agent edits over MCP, exported as code. Different jobs, different scope.',
    summary:
      'Lovable generates an application — frontend, backend, database, deployment — from a conversation, and hosts it. Loora is one layer of that: the design surface, held as a structured document that your own agent edits through typed tools, exported as code you drop into your own project. Lovable is the whole product; Loora is the part where the interface gets designed.',
    table: [
      {
        aspect: 'Scope',
        loora: 'The interface: pages, components, tokens, states, motion',
        other: 'The whole application, including backend and database',
      },
      {
        aspect: 'Deployment',
        loora: 'None; you export and deploy yourself',
        other: 'Built in, with a hosted URL',
      },
      {
        aspect: 'Which agent',
        loora: 'Yours, over MCP, with your own context and subscription',
        other: 'The hosted agent inside the product',
      },
      {
        aspect: 'Direct manipulation',
        loora: 'A real canvas: select, drag, snap, align, and edit properties by hand',
        other: 'Visual edits on the rendered app, backed by code changes',
      },
      {
        aspect: 'Where changes land',
        loora: 'A validated transaction against the canvas document',
        other: 'A commit against the generated repository',
      },
      {
        aspect: 'Speculative work',
        loora: 'Branches, compared and merged semantically, or thrown away',
        other: 'Git branches on the generated project',
      },
      {
        aspect: 'Best for',
        loora: 'Designing surfaces that go into a codebase you already have',
        other: 'Getting a working product from nothing',
      },
    ],
    otherWins: [
      'You are starting from nothing and want something deployed today.',
      'You need a backend, auth, and a database, not just an interface.',
      'You do not have an existing codebase for an export to land in.',
      'You would rather never leave one product.',
    ],
    looraWins: [
      'You already have an application, and what you need is the interface designed properly.',
      'You want an agent you already pay for, in the editor you already use.',
      'You want the design as structure — tokens, components, breakpoints — rather than as one more pile of generated files.',
      'You want to move something two pixels without a model rewriting the file.',
    ],
    verdict:
      'Lovable makes the whole thing. Loora makes the design, well, with your agent, and hands you the code. If you already have the app, the second one is the missing piece.',
    faq: [
      {
        question: 'Can Loora build a full app?',
        answer:
          'No, and it does not try. There is no backend, no database, and no deployment. It is a design tool: the output is an interface, exported as HTML/CSS, React/TSX, JSX, Tailwind, JSON, or PNG.',
      },
      {
        question: 'Can I use Loora alongside an app generator?',
        answer:
          'Yes, and it is a reasonable pairing. Design the surface on the canvas with your agent, export React, and drop it into whatever generated the rest.',
      },
      {
        question: 'Does Loora have its own AI chat?',
        answer:
          'No. There is deliberately no in-app agent. You bring your own over MCP, which keeps your context, your model choice, and your billing where they already are.',
      },
    ],
    related: ['v0', 'framer', 'figma'],
  },
]

export function findComparison(slug: string) {
  return COMPARISONS.find((comparison) => comparison.slug === slug)
}
