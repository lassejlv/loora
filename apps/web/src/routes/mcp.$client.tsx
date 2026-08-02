import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { CodeBlock } from '#/components/landing/code-block'
import {
  findMcpClient,
  MCP_CLIENTS,
  MCP_ENDPOINT,
  MCP_TOOL_GROUPS,
} from '#/components/landing/mcp-clients'
import {
  Breadcrumbs,
  Bullets,
  Dek,
  Faq,
  LINK,
  PageTitle,
  Related,
  RichText,
  Section,
  Steps,
  useAccent,
} from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { Td, TableScroll, Th } from '#/components/landing/table'
import {
  breadcrumbSchema,
  faqSchema,
  howToSchema,
  jsonLd,
  seo,
} from '#/lib/seo'

/**
 * One page per MCP client. The differences between clients — where the file
 * lives, what the key is called, whether OAuth is native or bridged — are real
 * enough that a single combined page buries the answer people arrived for.
 */
export const Route = createFileRoute('/mcp/$client')({
  loader: ({ params }) => {
    const client = findMcpClient(params.client)
    if (!client) throw notFound()
    return null
  },
  head: ({ params }) => {
    const client = findMcpClient(params.client)
    // An unknown slug is a 404; keep it out of the index rather than letting it
    // resolve to a thin page under a canonical of its own.
    if (!client)
      return seo({ title: 'Not found — Loora', description: 'This page does not exist.', noindex: true })

    const path = `/mcp/${client.slug}`
    return {
      ...seo({ title: `${client.title} — Loora`, description: client.description, path }),
      scripts: [
        jsonLd([
          breadcrumbSchema([
            { name: 'MCP', path: '/mcp' },
            { name: client.name, path },
          ]),
          howToSchema({
            name: `Connect ${client.name} to Loora over MCP`,
            description: client.description,
            path,
            steps: client.steps,
          }),
          faqSchema(client.faq),
        ]),
      ],
    }
  },
  notFoundComponent: NotFound,
  component: McpClientPage,
})

function NotFound() {
  const accent = useAccent()
  return (
    <LandingShell>
      <PageTitle>No setup guide for that client.</PageTitle>
      <Dek>
        There is no guide at this address. The endpoint is the same for every client, so any MCP
        client that speaks remote streamable HTTP will take it directly.
      </Dek>
      <CodeBlock label="endpoint" code={MCP_ENDPOINT} />
      <p className="mt-6">
        <a href="/mcp" className={LINK} style={accent}>
          All MCP setup guides →
        </a>
      </p>
    </LandingShell>
  )
}

function McpClientPage() {
  const { client: slug } = Route.useParams()
  const client = findMcpClient(slug)
  const accent = useAccent()

  if (!client) return <NotFound />

  const related = client.related
    .map((relatedSlug) => MCP_CLIENTS.find((entry) => entry.slug === relatedSlug))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  return (
    <LandingShell>
      <Breadcrumbs
        trail={[
          { label: 'MCP', href: '/mcp' },
          { label: client.name, href: `/mcp/${client.slug}` },
        ]}
      />

      <PageTitle>{client.headline}</PageTitle>
      <Dek>{client.intro}</Dek>

      <Section title="Configuration">
        <p className="mt-4 text-[13px] text-muted-foreground">
          <RichText>{client.configPath}</RichText>
        </p>
        <CodeBlock label={client.configLabel} code={client.config} />
        {client.secondary && (
          <>
            <p className="mt-5 text-[13px] text-muted-foreground">
              The equivalent written out, if you would rather edit it by hand:
            </p>
            <CodeBlock label={client.secondary.label} code={client.secondary.code} />
          </>
        )}
      </Section>

      <Section title="Steps">
        <Steps items={client.steps} />
      </Section>

      <Section title="Worth knowing">
        <Bullets items={client.notes} />
        {client.auth === 'bridge' && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            {client.name} speaks stdio only, so the OAuth flow is run by the local bridge rather
            than by the editor. The endpoint it connects to is the same one every other client
            uses: <code className="text-foreground">{MCP_ENDPOINT}</code>.
          </p>
        )}
      </Section>

      <Section title="What you can ask for">
        <p className="mt-4 text-muted-foreground">
          Once the server is connected, {client.name} has the same vocabulary as every other client.
          Every call commits a validated canvas transaction, so it is inspectable, undoable, and
          safe to make on a branch.
        </p>
        <TableScroll label={`Loora MCP tools available in ${client.name}`}>
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
        <p className="mt-5 text-[13px] text-muted-foreground">
          A good first prompt: ask for <code className="text-foreground">listDesigns</code>, then{' '}
          <code className="text-foreground">getDesignContext</code> on the one you want, then have
          it call <code className="text-foreground">setTokens</code> before it draws anything.{' '}
          <a href="/learn/design-tokens" className={LINK} style={accent}>
            Why that order matters →
          </a>
        </p>
      </Section>

      <Section title={`${client.name} and Loora: questions`}>
        <Faq entries={client.faq} />
      </Section>

      <Related
        title="Other clients"
        items={related.map((entry) => ({ label: entry.name, href: `/mcp/${entry.slug}` }))}
      />

      <p className="mt-10">
        <Link to="/app" className={LINK} style={accent}>
          Open a design to connect to →
        </Link>
      </p>
      <p className="mt-4">
        <a href="/mcp" className={LINK} style={accent}>
          ← All MCP setup guides
        </a>
      </p>
    </LandingShell>
  )
}
