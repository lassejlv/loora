import { createFileRoute, Link } from '@tanstack/react-router'
import { CodeBlock } from '#/components/landing/code-block'
import {
  MCP_CLIENT_CATEGORIES,
  MCP_CLIENTS,
  MCP_ENDPOINT,
  MCP_TOOL_GROUPS,
} from '#/components/landing/mcp-clients'
import {
  Bullets,
  CardGrid,
  CardLink,
  Faq,
  LINK,
  PageTitle,
  Section,
  Steps,
  useAccent,
} from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { Td, TableScroll, Th } from '#/components/landing/table'
import {
  breadcrumbSchema,
  faqSchema,
  itemListSchema,
  jsonLd,
  seo,
} from '#/lib/seo'

const SKILL_REPO = 'https://github.com/lassejlv/loora/tree/main/skills/loora-design-guide'
const SKILL_INSTALL = `npx skills add ${SKILL_REPO}`

const TITLE = 'MCP design tool — connect Claude, Cursor, Codex, or any MCP client'

const DESCRIPTION =
  'Loora runs a remote MCP server so your coding agent can read and edit a real design canvas. One URL, OAuth sign-in, and setup guides for 12 clients.'

/** Answers the questions the hub itself gets asked, not the per-client ones. */
const FAQ = [
  {
    question: 'What is an MCP design tool?',
    answer:
      'A design tool that exposes its document to AI clients over the Model Context Protocol. Loora’s MCP server offers 33 typed tools that create pages, insert and patch nodes, set design tokens, apply motion, and branch — so an agent authors the design rather than describing one.',
  },
  {
    question: 'Which AI agents can edit a Loora design?',
    answer:
      'Any MCP client. There are setup guides here for Claude Code, the Claude app, Codex, Cursor, VS Code with Copilot agent mode, opencode, Windsurf, Cline, Zed, Gemini CLI, Goose, and Warp, and any other compliant client works with the same URL.',
  },
  {
    question: 'Do I need an API key?',
    answer:
      'No. Authentication is OAuth 2.1 with PKCE and dynamic client registration, so a client the server has never seen can register itself and send you to a browser to sign in. Nothing is pasted into a config file.',
  },
  {
    question: 'Does the agent work on the design I have open?',
    answer:
      'Yes. Tool calls commit the same validated transactions the editor commits, and the canvas is pushed over realtime — so an edit made from a terminal shows up in an open browser tab without a reload.',
  },
  {
    question: 'How many Agent Calls do I get?',
    answer:
      'Calls are metered weekly: 100 a week on Free and 1,000,000 a week on Pro and Studio.',
  },
]

export const Route = createFileRoute('/mcp/')({
  head: () => ({
    ...seo({ title: TITLE, description: DESCRIPTION, path: '/mcp' }),
    scripts: [
      jsonLd([
        breadcrumbSchema([{ name: 'MCP', path: '/mcp' }]),
        itemListSchema(
          MCP_CLIENTS.map((client) => ({ name: client.name, path: `/mcp/${client.slug}` })),
        ),
        faqSchema(FAQ),
      ]),
    ],
  }),
  component: McpPage,
})

function McpPage() {
  const accent = useAccent()

  return (
    <LandingShell>
      <PageTitle>Connect your agent over MCP.</PageTitle>

      <p className="mt-6 text-muted-foreground">
        Loora runs a remote MCP server over streamable HTTP. Point your agent at one URL and sign in
        with your Loora account. There is no API key to paste, and the agent works on the same
        document you have open in the browser.
      </p>

      <CodeBlock label="endpoint" code={MCP_ENDPOINT} />

      <p className="mt-4 text-[13px] text-muted-foreground">
        Auth is OAuth 2.1 with PKCE and dynamic client registration, so any compliant client can
        register itself. Tools run under your account and are gated by your plan.
      </p>

      <Section title="Set up your client">
        <p className="mt-4 text-muted-foreground">
          The endpoint is the same everywhere; the file it goes in is not. Each guide below covers
          where the configuration lives for that client, what its keys are called, how the sign-in
          completes, and what goes wrong first.
        </p>

        {MCP_CLIENT_CATEGORIES.map((category) => {
          const clients = MCP_CLIENTS.filter((client) => client.category === category)
          if (clients.length === 0) return null
          return (
            <div key={category} className="mt-8">
              <h3 className="text-[13px] font-semibold text-muted-foreground">{category}</h3>
              <CardGrid count={clients.length}>
                {clients.map((client) => (
                  <CardLink
                    key={client.slug}
                    href={`/mcp/${client.slug}`}
                    title={client.name}
                    summary={client.tagline}
                    meta={client.auth === 'bridge' ? 'via bridge' : undefined}
                  />
                ))}
              </CardGrid>
            </div>
          )
        })}

        <p className="mt-5 text-[13px] text-muted-foreground">
          Using something else? Any MCP client that supports remote streamable HTTP servers takes
          the endpoint above directly. A stdio-only client can reach it through the{' '}
          <code className="text-foreground">mcp-remote</code> bridge, as on the{' '}
          <a href="/mcp/zed" className={LINK} style={accent}>
            Zed
          </a>{' '}
          page.
        </p>
      </Section>

      <Section title="What the agent gets">
        <p className="mt-4 text-muted-foreground">
          The server exposes the same typed operations the editor uses. Every call commits a
          validated canvas transaction, so you can inspect it, undo it, or branch away from it.
        </p>

        <TableScroll label="MCP tools">
          <thead>
            <tr>
              <Th>Group</Th>
              <Th>Tools</Th>
            </tr>
          </thead>
          <tbody>
            {MCP_TOOL_GROUPS.map((row) => (
              <tr key={row.group}>
                <Td strong>{row.group}</Td>
                <Td muted>{row.tools}</Td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      </Section>

      <Section title="Add the design guide skill">
        <p className="mt-4 text-muted-foreground">
          The tools tell an agent what it can do, not how to design. The design guide skill covers
          that: set tokens and components before sections, screenshot the result and look at it,
          work on a branch when the change is speculative.
        </p>

        <CodeBlock label="terminal" code={SKILL_INSTALL} />

        <p className="mt-4 text-[13px] text-muted-foreground">
          Add <code className="text-foreground">-g</code> to install it for every project instead of
          this one. Works with Claude Code and Codex.{' '}
          <a
            href={SKILL_REPO}
            target="_blank"
            rel="noreferrer"
            className={LINK}
            style={accent}
          >
            Read it on GitHub →
          </a>
        </p>
      </Section>

      <Section title="A good first run">
        <Steps
          items={[
            'Ask for listDesigns, then getDesignContext on the one you want to work in.',
            'Have it call setTokens before it draws anything — a palette and a spacing scale up front is what keeps the page coherent.',
            'Have it build with createPage and insertNodes, and refine with patchNodes.',
            'Ask for getScreenshot after a meaningful edit so it can see what it made.',
            'Call exportCode when you want the result as HTML, JSX, or Tailwind.',
          ]}
        />
        <p className="mt-4 text-muted-foreground">
          Work on a branch when the change is speculative: the agent can create one, work inside it,
          and you decide whether it reaches Main.
        </p>
      </Section>

      <Section title="Limits and troubleshooting">
        <Bullets
          items={[
            'Agent Calls are counted per week: 100 on Free, 1,000,000 on Pro.',
            'A 401 means the token expired or was never granted — run the client’s login step again.',
            'Tools are scoped to your own designs; there is no shared or public access.',
            'If a client silently ignores the server, the key name is usually wrong: url, serverUrl, httpUrl, and uri all mean the same thing to a different product.',
          ]}
        />
      </Section>

      <Section title="Questions">
        <Faq entries={FAQ} />
      </Section>

      <p className="mt-10">
        <Link to="/app" className={LINK} style={accent}>
          Open a design to connect to →
        </Link>
      </p>
      <p className="mt-4">
        <Link to="/features" className={LINK} style={accent}>
          ← Back to features
        </Link>
      </p>
    </LandingShell>
  )
}
