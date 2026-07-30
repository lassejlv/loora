import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ClaudeIcon,
  CodexIcon,
  CursorIcon,
  OpencodeIcon,
} from '#/components/landing/agent-icons'
import { CodeBlock } from '#/components/landing/code-block'
import { usePalette } from '#/components/landing/palette'
import { LandingShell } from '#/components/landing/site-shell'
import { Td, TableScroll, Th } from '#/components/landing/table'

const ENDPOINT = 'https://mcp.loora.design/mcp'

const DESCRIPTION =
  'Connect Claude, Codex, Cursor, or opencode to your Loora canvas over MCP. Remote streamable HTTP endpoint, OAuth sign-in, no API key to paste.'

export const Route = createFileRoute('/mcp')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'MCP setup — loora' },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: 'MCP setup — loora' },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:image', content: '/landing-cover.png' },
    ],
  }),
  component: McpPage,
})

/**
 * One entry per client. `code` is what the reader copies; `steps` covers the
 * parts that are not a command — where the file lives, and how the OAuth
 * hand-off completes.
 */
const CLIENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    Icon: ClaudeIcon,
    intro: 'Add the server once; the CLI stores it per project or globally with --scope user.',
    label: 'terminal',
    code: `claude mcp add --transport http loora ${ENDPOINT}`,
    steps: [
      'Run /mcp inside Claude Code and pick loora to start the OAuth sign-in.',
      'A browser opens on loora.design; approve the connection and return to the terminal.',
      'Run /mcp again to confirm the server is connected and its tools are listed.',
    ],
  },
  {
    id: 'claude-app',
    name: 'Claude app',
    Icon: ClaudeIcon,
    intro: 'The desktop and web apps take the same URL as a custom connector.',
    label: 'endpoint',
    code: ENDPOINT,
    steps: [
      'Open Settings → Connectors → Add custom connector.',
      'Paste the endpoint above and save.',
      'Click Connect and sign in to Loora when the browser opens.',
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    Icon: CodexIcon,
    intro: 'Codex writes the entry into ~/.codex/config.toml for you, then authenticates separately.',
    label: 'terminal',
    code: `codex mcp add loora --url ${ENDPOINT}\ncodex mcp login loora`,
    steps: [
      'codex mcp login opens the browser for the OAuth flow.',
      'Run codex mcp list to check that loora is present and authenticated.',
      'To edit it by hand, the entry is [mcp_servers.loora] with url = "…" in ~/.codex/config.toml.',
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    Icon: CursorIcon,
    intro:
      'Add the server to ~/.cursor/mcp.json for every project, or .cursor/mcp.json inside one repository.',
    label: '~/.cursor/mcp.json',
    code: `{
  "mcpServers": {
    "loora": {
      "url": "${ENDPOINT}"
    }
  }
}`,
    steps: [
      'Open Settings → MCP and find loora in the list.',
      'Click Login and approve the connection in the browser.',
      'The Loora tools appear in the agent’s tool list once the status turns green.',
    ],
  },
  {
    id: 'opencode',
    name: 'opencode',
    Icon: OpencodeIcon,
    intro: 'Remote servers go in the mcp block of opencode.json, at the project or user level.',
    label: 'opencode.json',
    code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "loora": {
      "type": "remote",
      "url": "${ENDPOINT}",
      "enabled": true
    }
  }
}`,
    steps: [
      'Restart opencode so it picks up the config.',
      'The first tool call triggers the OAuth flow in your browser.',
    ],
  },
] as const

const TOOLS = [
  {
    group: 'Read',
    tools: 'listDesigns, getDesignContext, readNode, readTree, searchNodes, listAssets, listVersions',
  },
  { group: 'Write', tools: 'createPage, insertNodes, patchNodes, moveNodes, deleteNodes' },
  { group: 'Reuse', tools: 'createComponent, createInstance, setTokens' },
  { group: 'Look', tools: 'viewCanvas, viewPage, viewNode, getScreenshot' },
  {
    group: 'Branches',
    tools: 'listBranches, createBranch, proposeBranch, compareBranch, applyBranch, reopenBranch, closeBranch',
  },
  { group: 'Designs', tools: 'createDesign, renameDesign, deleteDesign, exportCode' },
] as const

function McpPage() {
  return (
    <LandingShell>
      <McpContent />
    </LandingShell>
  )
}

function McpContent() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <>
      <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <span aria-hidden="true" style={link}>
          |
        </span>
        <span>Connect your agent over MCP.</span>
      </h1>

      <p className="mt-6 text-muted-foreground">
        Loora runs a remote MCP server over streamable HTTP. Point your agent at one URL and sign in
        with your Loora account — there is no API key to generate, paste, or rotate, and the agent
        edits the same document you have open in the browser.
      </p>

      <CodeBlock label="endpoint" code={ENDPOINT} />

      <p className="mt-4 text-[13px] text-muted-foreground">
        Auth is OAuth 2.1 with PKCE and dynamic client registration, so any compliant client can
        register itself. Tools run under your account and are gated by your plan.
      </p>

      <h2 className="mt-12 text-[15px] font-semibold">Set it up</h2>
      <nav aria-label="Clients" className="mt-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {CLIENTS.map((client) => (
            <li key={client.id}>
              <a
                href={`#${client.id}`}
                className="underline-offset-2 hover:underline"
                style={link}
              >
                {client.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {CLIENTS.map((client) => (
        <section
          key={client.id}
          id={client.id}
          className="mt-8 scroll-mt-16 border-t border-dashed border-border pt-6"
        >
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            <client.Icon className="size-4 shrink-0" />
            {client.name}
          </h3>
          <p className="mt-3 text-[13px] text-muted-foreground">{client.intro}</p>
          <CodeBlock label={client.label} code={client.code} />
          <ol className="mt-4 flex list-none flex-col gap-1.5 text-[13px] text-muted-foreground">
            {client.steps.map((step, index) => (
              <li key={step} className="flex gap-2">
                <span aria-hidden="true" className="shrink-0 select-none" style={link}>
                  {index + 1}.
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <h2 className="mt-14 text-[15px] font-semibold">What the agent gets</h2>
      <p className="mt-4 text-muted-foreground">
        Not a text box. The server exposes the same typed operations the editor uses, so every call
        commits a validated canvas transaction that you can inspect, undo, or branch away from.
      </p>

      <TableScroll label="MCP tools">
        <thead>
          <tr>
            <Th>Group</Th>
            <Th>Tools</Th>
          </tr>
        </thead>
        <tbody>
          {TOOLS.map((row) => (
            <tr key={row.group}>
              <Td strong>{row.group}</Td>
              <Td muted>{row.tools}</Td>
            </tr>
          ))}
        </tbody>
      </TableScroll>

      <h2 className="mt-14 text-[15px] font-semibold">A good first run</h2>
      <ol className="mt-4 flex list-none flex-col gap-2 text-[13px] text-muted-foreground">
        {[
          'Ask for listDesigns, then getDesignContext on the one you want to work in.',
          'Have it build with createPage and insertNodes, and refine with patchNodes.',
          'Ask for getScreenshot after a meaningful edit so it can see what it made.',
          'Call exportCode when you want the result as HTML, JSX, or Tailwind.',
        ].map((step, index) => (
          <li key={step} className="flex gap-2">
            <span aria-hidden="true" className="shrink-0 select-none" style={link}>
              {index + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-muted-foreground">
        Work on a branch when the change is speculative: the agent can create one, work inside it,
        and you decide whether it reaches Main.
      </p>

      <h2 className="mt-14 text-[15px] font-semibold">Limits and troubleshooting</h2>
      <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-muted-foreground">
        <li className="flex gap-2">
          <span aria-hidden="true" className="select-none" style={link}>
            +
          </span>
          <span>
            MCP calls are counted per week: 200 on Free, 1,000,000 on Pro. See{' '}
            <Link to="/pricing" className="underline-offset-2 hover:underline" style={link}>
              pricing
            </Link>
            .
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="select-none" style={link}>
            +
          </span>
          <span>
            A 401 means the token expired or was never granted — run the client’s login step again.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="select-none" style={link}>
            +
          </span>
          <span>Tools are scoped to your own designs; there is no shared or public access.</span>
        </li>
      </ul>

      <p className="mt-10">
        <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
          Open a design to connect to →
        </Link>
      </p>
      <p className="mt-4">
        <Link to="/features" className="underline-offset-2 hover:underline" style={link}>
          ← Back to features
        </Link>
      </p>
    </>
  )
}
