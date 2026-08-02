/**
 * The `/learn` pages: the concepts Loora is built on, explained on their own
 * terms.
 *
 * These are not feature copy with a question mark on top. Each one has to be
 * worth reading by somebody who never signs up — that is the only version of
 * this page type that earns a link, and it is also what makes it quotable to a
 * model that is answering the same question for somebody else.
 */

export const LEARN_UPDATED = '2026-08-02'

export type LearnSection = {
  heading: string
  /** Paragraphs. Prose carries the argument; bullets only ever support it. */
  body: readonly string[]
  bullets?: readonly string[]
  code?: { label: string; content: string }
}

export type LearnArticle = {
  slug: string
  /** `<h1>`. */
  headline: string
  /** Hub grid line. */
  tagline: string
  description: string
  /** Standfirst — the answer, in two sentences, before anyone scrolls. */
  dek: string
  published: string
  sections: readonly LearnSection[]
  faq: readonly { question: string; answer: string }[]
  related: readonly string[]
}

export const LEARN_ARTICLES: readonly LearnArticle[] = [
  {
    slug: 'what-is-an-mcp-server',
    headline: 'What is an MCP server?',
    tagline: 'The protocol, its transports, and what a server actually exposes.',
    description:
      'An MCP server exposes tools, resources, and prompts to an AI client over a standard protocol. How the transports differ, how OAuth works, and what makes a server worth connecting.',
    dek: 'An MCP server is a program that offers an AI client a fixed set of typed capabilities — tools it can call, resources it can read, prompts it can use — over the Model Context Protocol. The point is that the client does not need to know anything about you in advance: it reads your schema at connect time and can use you immediately.',
    published: '2026-08-02',
    sections: [
      {
        heading: 'The problem it solves',
        body: [
          'Before MCP, every combination of an AI client and an external system was its own integration. Support for a tool inside one assistant told you nothing about whether it worked in another, and each vendor shipped a bespoke plugin format with its own manifest, its own auth story, and its own lifetime.',
          'MCP replaces that with one contract. A server declares what it can do; a client discovers that declaration at connect time and hands the model a matching set of tools. Anything that speaks the protocol works with anything else that speaks it, which is why the same URL below works in Claude Code, Cursor, VS Code, Zed, and a terminal you wrote yourself.',
        ],
      },
      {
        heading: 'What a server exposes',
        body: [
          'Three kinds of thing, and the distinction matters more than it looks:',
        ],
        bullets: [
          'Tools — functions the model can call, each with a JSON Schema for its arguments. This is where anything with a side effect lives.',
          'Resources — content the client can read and put in context, addressed by URI. Files, records, rendered images.',
          'Prompts — reusable templates a user can invoke deliberately, usually surfaced in the client as a slash command.',
        ],
      },
      {
        heading: 'Transports: local and remote',
        body: [
          'A local server runs as a process on your machine and talks over stdio. The client spawns it, pipes JSON-RPC through standard input and output, and kills it on exit. This is simple and needs no network, but it means the server has to be installed, it can only reach what that machine can reach, and there is no meaningful notion of who you are — the process runs as you, and that is the whole security model.',
          'A remote server is an HTTP endpoint. The current transport is streamable HTTP: the client POSTs JSON-RPC to a single URL and the server may answer with a stream when it wants to push progress or notifications. Nothing is installed, the server is updated centrally, and authentication is a real question with a real answer.',
          'A stdio-only client can still reach a remote server through a bridge such as mcp-remote, which runs locally, speaks stdio to the client, and HTTP to the server.',
        ],
      },
      {
        heading: 'Authentication',
        body: [
          'Remote servers use OAuth 2.1 with PKCE. In practice: your client discovers the authorization server from the resource metadata, registers itself dynamically if it has no client ID, sends you to a browser, and receives a token scoped to your account. No API key is pasted anywhere, and revoking access is something you do on the server rather than by rotating a secret.',
          'Dynamic client registration is the part that makes this pleasant. It is why you can point a client the server has never seen at a URL and have it work — the client registers itself on the spot rather than requiring somebody to pre-provision it.',
        ],
      },
      {
        heading: 'What makes a server good',
        body: [
          'Schema size is a real cost. Every tool description is sent to the model on every request, so a server with sprawling schemas eats context that the actual work needed. Fewer, sharper tools beat many overlapping ones.',
          'Validation belongs on the server. A model will send you a colour as a string, a number, and an object across three consecutive calls; the server has to reject the ones that are wrong rather than write them and produce a broken document later.',
          'Give the model a way to check itself. A tool that renders the current state back as an image turns a blind sequence of writes into a loop the model can close on its own.',
        ],
      },
      {
        heading: 'Loora as an example',
        body: [
          'Loora’s MCP server is remote streamable HTTP at one URL, with OAuth 2.1, PKCE, and dynamic client registration. It exposes 33 tools over a design canvas: reads such as readTree and searchNodes, writes such as insertNodes and patchNodes, and view tools that render the real document to an image so the model can look at what it just built.',
          'Every write goes through the same validated transaction path the human editor uses, so an agent’s changes are ordinary document edits — logged, undoable, and safe to make on a branch.',
        ],
        code: { label: 'endpoint', content: 'https://mcp.loora.design/mcp' },
      },
    ],
    faq: [
      {
        question: 'What does MCP stand for?',
        answer:
          'Model Context Protocol. It is an open protocol for connecting AI clients to external tools and data through one standard interface, rather than a separate integration per client.',
      },
      {
        question: 'Do I need to install anything to use a remote MCP server?',
        answer:
          'Usually not. A client that supports remote servers takes a URL and handles the OAuth flow itself. Clients that only speak stdio need a local bridge such as mcp-remote in between.',
      },
      {
        question: 'Is an MCP server the same as a plugin?',
        answer:
          'It fills the same role but is not client-specific. A plugin is written against one product’s API; an MCP server is written once and works in any client that speaks the protocol.',
      },
    ],
    related: ['mcp-design-tool', 'agent-editable-design-files', 'structured-design-documents'],
  },
  {
    slug: 'mcp-design-tool',
    headline: 'How an MCP design tool works',
    tagline: 'What has to be true before an agent can design rather than describe.',
    description:
      'Connecting an agent to a design tool over MCP takes more than an API. What the document, the tools, and the feedback loop have to look like for it to work.',
    dek: 'A design tool becomes agent-editable when three things line up: a document made of addressable structure, a small set of typed operations over it, and a way for the model to see the result. Miss any one and you get an agent that produces plausible nonsense confidently.',
    published: '2026-08-02',
    sections: [
      {
        heading: 'Why "give the agent an API" is not enough',
        body: [
          'Most design tools have an API. Very few are pleasant for an agent, and the reason is granularity. If the smallest unit you can write is a whole file or a whole frame, every change is a rewrite: the model has to reconstruct everything it is not changing, and any detail you adjusted by hand in the meantime is quietly destroyed.',
          'The other failure is the opposite — an API so low-level that placing a button takes fourteen calls. Models are bad at long mechanical sequences and each call is a chance to drift. What works is a middle layer: operations that are meaningful units of design intent.',
        ],
      },
      {
        heading: 'The document has to be addressable',
        body: [
          'Every node needs a stable ID, and a node has to be changeable without touching its neighbours. That is what makes a targeted edit possible: patch this node’s padding, leave the other four hundred alone.',
          'It also has to be structured rather than free-form. A layout expressed as values — direction, gap, alignment, tokens — is something a model can reason about and change precisely. The same layout expressed as a CSS class string is something it can only pattern-match against, and it will get it subtly wrong in ways nobody notices until the export.',
        ],
      },
      {
        heading: 'The operations have to be typed and validated',
        body: [
          'Every write should be a transaction with a schema, and the server should reject anything that does not fit rather than storing it. This sounds bureaucratic and is actually the thing that makes agent editing survivable: an invalid value caught at the boundary is an error message the model can correct from, and an invalid value written to the document is a bug you find three days later.',
          'Two more properties earn their keep. An idempotency ID means a retried call does not apply twice. A precondition on the fields being touched means an edit made against a stale read fails loudly instead of silently reverting something you changed by hand in the meantime.',
        ],
        bullets: [
          'Reads: readNode, readTree, searchNodes, getDesignContext',
          'Writes: createPage, insertNodes, patchNodes, moveNodes, deleteNodes',
          'Reuse: createComponent, createInstance, setTokens',
          'Motion: setAnimations, animateNodes',
        ],
      },
      {
        heading: 'The model has to be able to look',
        body: [
          'This is the part most integrations skip, and it is the one that changes the output most. A model writing layout without seeing it is working blind: it has no way to notice that the heading overlaps the image or that the card is three times too tall.',
          'Render the document to an image and hand it back. The loop becomes: build, look, fix. Agents are good at that loop and bad at the alternative, which is predicting pixel positions from a tree of numbers.',
        ],
      },
      {
        heading: 'It has to be safe to be wrong',
        body: [
          'Agents make confident mistakes, so the interesting question is what happens afterwards. Version history means you can roll back. A transaction log means you can see exactly what changed and when. Branches mean speculative work never touches the thing you were happy with.',
          'Given those, the right instruction to an agent is not "be careful" but "work on a branch" — which is a thing it can actually do, rather than a mood.',
        ],
      },
      {
        heading: 'And the human has to still be able to edit',
        body: [
          'The failure mode of every generate-then-edit tool is that manual changes and generated changes fight. If the agent regenerates a page, your hand-tuned spacing is gone; if you edit the output, the next generation overwrites it.',
          'One document, one set of operations, both parties using them, is what avoids that. When an agent’s edit is the same kind of transaction as a drag, there is nothing to reconcile — you can nudge a node the moment after it was inserted, and the agent’s next read sees where you put it.',
        ],
      },
    ],
    faq: [
      {
        question: 'Can an AI agent actually use a design tool?',
        answer:
          'Yes, if the tool exposes a structured document through typed operations and gives the model a way to see the result. Without the visual feedback loop it can produce valid structure that looks wrong, and without addressable nodes every edit becomes a destructive rewrite.',
      },
      {
        question: 'Which agents can drive a design tool over MCP?',
        answer:
          'Any MCP client: Claude Code, the Claude app, Codex, Cursor, VS Code with Copilot agent mode, opencode, Windsurf, Cline, Zed, Gemini CLI, Goose, Warp. The protocol is the same, only the configuration differs.',
      },
      {
        question: 'What stops an agent from destroying my design?',
        answer:
          'Validation at the boundary, transactions with preconditions so stale edits fail rather than overwrite, a full version history to roll back to, and branches so speculative work never touches the main document.',
      },
    ],
    related: ['what-is-an-mcp-server', 'agent-editable-design-files', 'design-branches'],
  },
  {
    slug: 'agent-editable-design-files',
    headline: 'Agent-editable design files',
    tagline: 'Why generated code is not a design file, and what is lost when you pretend it is.',
    description:
      'Generating React from a prompt is not the same as having a design file. What a durable, agent-editable design artifact needs, and why code fails the test.',
    dek: 'Code is an output, not an artifact you can point at. A design file an agent can edit needs stable identity, addressable structure, and a shared vocabulary — three things a folder of generated components does not have.',
    published: '2026-08-02',
    sections: [
      {
        heading: 'The generated-code trap',
        body: [
          'Prompt-to-code is genuinely fast, and for a prototype it is often the right answer. It stops being the right answer the moment you want to change one thing.',
          'The reason is that a component file has no stable identity for the things inside it. There is no ID for "the price row in the pricing card" — only a position in a tree of JSX that shifts every time the file is regenerated. So a change means either regenerating the file, which throws away every manual edit, or a textual patch, which is a diff against something the model half-remembers.',
        ],
      },
      {
        heading: 'What a design file gives you instead',
        body: [
          'A design document is a normalized set of nodes with stable IDs. That is a small-sounding property with large consequences:',
        ],
        bullets: [
          'A change can be scoped to one node and three fields, leaving everything else provably untouched.',
          'You and the agent can refer to the same thing across sessions, because the ID outlives the conversation.',
          'The document can be diffed, merged, and rolled back, because it is data rather than text.',
          'Layout can be validated. A structured layout value is either coherent or rejected; a class string is neither.',
        ],
      },
      {
        heading: 'The round-trip that never works',
        body: [
          'Every few years something promises two-way sync between a design tool and a codebase. It does not hold, and the reason is not effort. Code carries information the design does not — logic, state, data, conditionals — and the design carries intent that code has already dissolved into utility classes and computed values. Mapping either direction loses something, and mapping both directions loses something twice, continuously.',
          'One-way export is the honest version. Compile the document to code, deterministically, and let the code be code. If a change belongs to the design, make it in the design and export again. If it belongs to the application, it was never the design tool’s to hold.',
        ],
      },
      {
        heading: 'Shared vocabulary',
        body: [
          'The last requirement is that the human and the agent use the same operations. Not similar ones — the same ones. When a drag on the canvas and an agent’s moveNodes call are the same transaction against the same engine, there is no sync layer to get out of step and no reconciliation to lose an edit in.',
          'That is also what makes correction cheap. The agent builds a section, you widen a column by hand, the agent reads the tree and sees the width you set. Neither of you has to be told about the other.',
        ],
      },
      {
        heading: 'What this looks like day to day',
        body: [
          'Ask for a page and the agent inserts real nodes onto a canvas you can see. Something is off, so you drag it — no prompt, no regeneration. Ask for a variant and it makes a branch; the version you liked is untouched while it works. Compare the two, keep the better one, and export React when you are done.',
          'None of that is possible when the artifact is a folder of files whose only stable name is a filename.',
        ],
      },
    ],
    faq: [
      {
        question: 'Why not just let the AI write the components directly?',
        answer:
          'For a prototype, do. It breaks down on iteration: generated code has no stable identity for the pieces inside it, so changing one thing means regenerating the file and losing every manual edit, or patching text the model only partly remembers.',
      },
      {
        question: 'Can a design tool sync two ways with code?',
        answer:
          'Not durably. Code carries logic and state a design does not, and the design carries intent that compiling has already dissolved. One-way export is the honest contract: the document is the source of truth and code is generated from it.',
      },
      {
        question: 'What makes a design file "agent-editable"?',
        answer:
          'Stable node IDs, structured values rather than free-form strings, typed operations validated at the boundary, and the same operation set used by the human editor — so neither party’s changes need reconciling with the other’s.',
      },
    ],
    related: ['structured-design-documents', 'mcp-design-tool', 'design-to-code-export'],
  },
  {
    slug: 'structured-design-documents',
    headline: 'Structured design documents',
    tagline: 'What it means for a canvas to be data all the way down.',
    description:
      'A structured design document stores layout, style, and hierarchy as validated values rather than markup. What that buys, and what it costs.',
    dek: 'A structured document holds every property as a typed value in a normalized tree, not as markup or a class string. That is what makes a design queryable, diffable, mergeable, and safe for two parties to edit at once.',
    published: '2026-08-02',
    sections: [
      {
        heading: 'Normalized, by ID',
        body: [
          'The document is a flat map from node ID to node, with parents naming their children in order — not a deeply nested object. Nesting reads nicely and is miserable to work with: every lookup is a traversal, every move is a splice at two depths, and every subscription redraws a subtree.',
          'Flat and normalized, a node is found in one step, moved by editing two child lists, and rendered by a component subscribed to that node’s own revision. A thousand-node page updates one node when one node changes.',
        ],
      },
      {
        heading: 'Values, not strings',
        body: [
          'The load-bearing rule is that properties are structured. Layout is a value with a direction, a gap, and alignment — not `flex items-center gap-4`. Colour is a value or a token reference, not `#3b5bdb` typed into a box.',
          'Everything follows from that. A query for "every node using the accent token" is possible. Renaming a token updates every consumer. A breakpoint override is a patch on specific fields rather than a competing class list. And a value that makes no sense is rejected at the model boundary instead of being stored and rendered as nothing.',
        ],
      },
      {
        heading: 'What you can do once it holds',
        body: ['The properties compound, and most of the tool’s features are consequences rather than separate work:'],
        bullets: [
          'Diff two versions field by field, instead of comparing screenshots.',
          'Merge two branches semantically — different fields on the same node combine cleanly, and only a real same-field collision needs a human.',
          'Rebase an in-flight edit against a change that arrived while you were dragging.',
          'Compile to HTML, React, or Tailwind deterministically, because there is nothing ambiguous left to interpret.',
          'Let an agent search the document rather than read all of it, which is the difference between a query and a context window.',
        ],
      },
      {
        heading: 'The cost',
        body: [
          'You give up the escape hatch. There is no arbitrary code node, no freeform CSS string, no place to paste something the model does not support. When the document cannot express something, the answer is to extend the model, not to smuggle it in as text.',
          'That is frustrating on the day you need one unsupported property, and it is the entire reason the rest works. One escape hatch and every guarantee above becomes conditional: the diff cannot compare it, the merge cannot reconcile it, the export has to pass it through blindly, and the agent cannot reason about it.',
        ],
      },
      {
        heading: 'Rendering it',
        body: [
          'A structured document does not imply a proprietary renderer. Loora renders to real DOM and SVG under one camera transform, with a viewport-space overlay for selection and handles — so what you arrange is the same thing the export produces, and the browser does the layout work it is already good at.',
        ],
      },
    ],
    faq: [
      {
        question: 'What is a structured design document?',
        answer:
          'A design file where every property is a typed value in a normalized tree of nodes, rather than markup or CSS strings. Layout, colour, typography, tokens, breakpoints, and motion are all data the tool can validate, query, diff, and merge.',
      },
      {
        question: 'Why not store designs as HTML and CSS?',
        answer:
          'Because CSS is not diffable in a meaningful way, class strings cannot be validated, and there is no stable identity for an element. You lose semantic merge, targeted patching, token-wide renames, and any confidence that a value is coherent.',
      },
      {
        question: 'Does a structured document limit what I can design?',
        answer:
          'Yes, deliberately — anything the model cannot express has to be added to the model rather than pasted in as raw code. That constraint is what makes the diff, merge, export, and agent-editing guarantees hold at all.',
      },
    ],
    related: ['agent-editable-design-files', 'design-tokens', 'design-branches'],
  },
  {
    slug: 'design-tokens',
    headline: 'Design tokens in a structured canvas',
    tagline: 'Named values, referenced by nodes, resolved at render.',
    description:
      'What design tokens are, how they behave when the design file is structured data, and why an agent should set tokens before it draws anything.',
    dek: 'A design token is a named value — a colour, a spacing step, a type size — that nodes reference instead of copying. In a structured document the reference is real, so renaming or retheming updates every consumer rather than requiring a search.',
    published: '2026-08-02',
    sections: [
      {
        heading: 'The idea',
        body: [
          'Without tokens, a colour appears in the file two hundred times as two hundred independent copies, and four of them are one hex digit off because somebody eyedropped instead of pasting. Changing the brand colour becomes an archaeology exercise.',
          'A token turns the value into a name. Nodes hold a reference to `accent`, not a copy of `#2440e6`. Change the token and everything that referenced it changes, because it never held the value in the first place.',
        ],
      },
      {
        heading: 'What tokens cover',
        body: ['The usual set, and each answers a question that otherwise gets answered ad hoc every time:'],
        bullets: [
          'Colour — surfaces, text, borders, accents, states.',
          'Spacing — a scale, so padding and gaps land on it rather than near it.',
          'Typography — families, sizes, weights, line heights, tracking.',
          'Radius — one scale, so a card and a button agree on how round things are.',
          'Shadow and elevation.',
        ],
      },
      {
        heading: 'Themes are token sets',
        body: [
          'Once values are named, a theme is a second set of values under the same names. Light and dark stop being two designs and become one design resolved twice, which is why a themed structured document does not double in size or drift out of sync.',
          'The same applies to a customer-branded variant: change the token set, keep the document.',
        ],
      },
      {
        heading: 'Why an agent should set tokens first',
        body: [
          'This is the single highest-leverage instruction you can give an agent working on a design, and it is worth stating plainly: define the tokens before drawing anything.',
          'An agent that starts inserting sections immediately picks a colour per section, and they will not agree. Six sections later the page has five greys, three accent blues, and spacing values that are close to a scale without being on one. Nothing is individually wrong, and the whole thing looks amateur.',
          'An agent that calls setTokens first has a palette and a scale to reference, and every subsequent insert lands on it. The design becomes coherent for the same reason a human designer’s does: the decisions were made once, up front, rather than two hundred times under pressure.',
        ],
        code: {
          label: 'the order that works',
          content: 'setTokens → createComponent → insertNodes → getScreenshot → patchNodes',
        },
      },
      {
        heading: 'Tokens in the export',
        body: [
          'Because references survive into compilation, tokens come out the other side as CSS custom properties rather than being flattened to literals. The exported stylesheet has one place the accent colour is defined, exactly as the document did, so the structure of the design survives the trip into your codebase.',
        ],
      },
    ],
    faq: [
      {
        question: 'What is a design token?',
        answer:
          'A named value — a colour, spacing step, type size, radius, or shadow — that design elements reference instead of copying. Changing the token changes everything that references it.',
      },
      {
        question: 'Can an AI agent set design tokens?',
        answer:
          'Yes, through setTokens, and it should do it first. An agent that defines a palette and a spacing scale before inserting sections produces a coherent page; one that picks values per section produces five greys and three blues.',
      },
      {
        question: 'Do tokens survive code export?',
        answer:
          'Yes. They compile to CSS custom properties, so the exported code keeps one definition per value rather than flattening the reference into repeated literals.',
      },
    ],
    related: ['structured-design-documents', 'mcp-design-tool', 'design-to-code-export'],
  },
  {
    slug: 'design-branches',
    headline: 'Branching a design file',
    tagline: 'Fork, explore, compare, merge — without the git metaphor breaking.',
    description:
      'What branching means for a design document, why semantic merge is possible when the file is structured, and how it changes working with an agent.',
    dek: 'A design branch is a fork of the document you can take an idea as far as it goes in, then compare against the original and merge the parts worth keeping. It works because the document is structured — a semantic merge can combine two edits to the same node when they touched different fields.',
    published: '2026-08-02',
    sections: [
      {
        heading: 'Why design files resisted this',
        body: [
          'Branching is unremarkable in code because a merge tool can reason about text line by line and most edits do not overlap. Design files historically could not: a binary or deeply nested proprietary format offers a merge tool nothing but "these two bytes differ", so the only available resolution is to pick a whole file. Which is why the design version of branching was, for years, duplicating the page and calling it `Homepage v3 FINAL`.',
          'A structured document changes the input. Two branches that both touched one node can be compared field by field, and if one changed padding while the other changed the text, both changes survive.',
        ],
      },
      {
        heading: 'What a semantic merge can and cannot do',
        body: ['The rule is narrow and worth knowing exactly, because it is what tells you when to expect a prompt:'],
        bullets: [
          'Different nodes, either side — both applied.',
          'Same node, different fields — both applied.',
          'Same node, same field, different values — a conflict, and you choose.',
          'Moved on one side, deleted on the other — a conflict, and you choose.',
        ],
      },
      {
        heading: 'The lifecycle',
        body: [
          'A branch is `active` while it is being worked on, `proposed` when it is put up for a decision, and then either `applied` or `closed`. Proposed, applied, and closed branches are read-only, so the thing being reviewed cannot move underneath the reviewer.',
          'A branch is never the live design. It is not exported and not shared as the published version, which means an unfinished idea cannot escape by accident.',
        ],
      },
      {
        heading: 'What it changes with an agent',
        body: [
          'This is the answer to "how do I let an agent try something without risking the file". Not supervision, not smaller instructions — a branch. The agent creates one, works inside it, and Main is untouched the whole time.',
          'It also changes what you can ask for. Three branches, three interpretations of the same brief, compared side by side, is a reasonable request when a branch costs nothing and merging is semantic. On a single mutable document it is not a request at all.',
        ],
        bullets: [
          'createBranch — fork the current document',
          'compareBranch — field-level diff against Main',
          'proposeBranch — freeze it for review',
          'applyBranch — merge it in',
          'closeBranch / reopenBranch — shelve it, or bring it back',
        ],
      },
      {
        heading: 'Branches and history are different tools',
        body: [
          'Version history is the timeline of one document: commit points you can compare and roll back to. A branch is a parallel document. Use history when you want to undo what happened; use a branch when you want to find out what would happen.',
        ],
      },
    ],
    faq: [
      {
        question: 'Can you branch a design file like code?',
        answer:
          'Yes, when the document is structured. A branch forks the document, and merging compares it field by field — so two edits to the same node combine cleanly as long as they touched different fields.',
      },
      {
        question: 'What happens when two branches change the same thing?',
        answer:
          'Only a genuine collision surfaces: the same field on the same node with different values, or a node moved on one side and deleted on the other. Everything else merges without asking.',
      },
      {
        question: 'How do I let an agent experiment safely?',
        answer:
          'Ask it to create a branch first. Its work is isolated until you apply it, Main is untouched, and closing the branch discards everything with no cleanup.',
      },
    ],
    related: ['structured-design-documents', 'mcp-design-tool', 'agent-editable-design-files'],
  },
  {
    slug: 'design-to-code-export',
    headline: 'Design-to-code export, one way',
    tagline: 'Deterministic compilation out, and nothing coming back in.',
    description:
      'How a structured design document compiles to HTML, React, and Tailwind, why the export is deterministic, and why it deliberately never round-trips.',
    dek: 'Export compiles the design document to code. It is deterministic — the same document always produces the same output — and it is one-way on purpose, because a two-way sync would force the document to store things it has no business storing.',
    published: '2026-08-02',
    sections: [
      {
        heading: 'What comes out',
        body: ['Six targets, from the same document, each answering a different question:'],
        bullets: [
          'HTML and CSS — a standalone page, no build step.',
          'React as TSX — components, typed, ready to drop into a project.',
          'Plain JSX — the same, without the types.',
          'Tailwind — utilities instead of a stylesheet, when that is the codebase’s convention.',
          'JSON — the raw document, for anything else you want to do with it.',
          'PNG — a capture of a page or a single node.',
        ],
      },
      {
        heading: 'Deterministic means reviewable',
        body: [
          'The same document produces the same code every time: no model in the loop, no sampling, no rewriting. That sounds like a modest property and it is the one that makes export usable in a real workflow.',
          'Because it is deterministic, you can export twice and read the diff, and the diff is exactly the design change — not a differently-worded version of the same markup. That makes export something you can run repeatedly instead of once at the end.',
        ],
      },
      {
        heading: 'Why it does not come back',
        body: [
          'Round-tripping is the feature everyone asks for, and it fails for a structural reason rather than a difficulty one. Code holds things a design cannot: state, conditionals, data, event handlers, imports. To read code back into the document, the document would have to store all of it — at which point it is not a design document, it is a worse code editor with a canvas attached.',
          'The alternative is to parse code back and drop what does not fit, which silently deletes work. One-way is the version that does not lie about what it does.',
        ],
      },
      {
        heading: 'How to actually work with it',
        body: [
          'Treat the export as a build artifact, and the document as the source. When something about the design changes, change the design and export again. When something about the application changes — data, logic, wiring — that lives in your code and was never the design tool’s.',
          'The seam usually falls in a natural place: the exported component is the presentational layer, and the code around it supplies the props. That way re-exporting replaces the part that is generated and leaves the part that is yours.',
        ],
      },
      {
        heading: 'Motion comes with it',
        body: [
          'Transitions, keyframe animations, and hover, press, and focus states are part of the document, so they are part of the export — as CSS, generated from the same source the editor renders from. A hover that lifts a card on the canvas is the same rule in the download, and every generated stylesheet ends with a prefers-reduced-motion block that turns it all off.',
        ],
      },
    ],
    faq: [
      {
        question: 'Can I edit the exported code and sync it back?',
        answer:
          'No. Export is one-way by design. Code carries state, logic, and data a design document cannot hold, so a round-trip would either bloat the document or silently discard work. Change the design and export again.',
      },
      {
        question: 'What formats can a Loora design export to?',
        answer:
          'Standalone HTML and CSS, React as TSX, plain JSX, Tailwind utilities, the raw JSON document, and PNG captures of a page or a single node.',
      },
      {
        question: 'Is the exported code readable?',
        answer:
          'It is generated deterministically from structured values, so it is consistent rather than clever: tokens become CSS custom properties, layout becomes the layout values you set, and exporting twice after one change produces a diff that is exactly that change.',
      },
    ],
    related: ['agent-editable-design-files', 'design-tokens', 'structured-design-documents'],
  },
]

export function findLearnArticle(slug: string) {
  return LEARN_ARTICLES.find((article) => article.slug === slug)
}
