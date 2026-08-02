import { createFileRoute, Link } from '@tanstack/react-router'
import { LEARN_ARTICLES } from '#/components/landing/learn'
import {
  CardGrid,
  CardLink,
  Dek,
  LINK,
  PageTitle,
  Section,
  useAccent,
} from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { breadcrumbSchema, itemListSchema, jsonLd, seo } from '#/lib/seo'

const TITLE = 'Learn — MCP, structured design documents, tokens, and branching'

const DESCRIPTION =
  'Explainers on the ideas behind agent-editable design: what an MCP server is, what makes a design document structured, how tokens and branches work, and why export is one-way.'

export const Route = createFileRoute('/learn/')({
  head: () => ({
    ...seo({ title: TITLE, description: DESCRIPTION, path: '/learn' }),
    scripts: [
      jsonLd([
        breadcrumbSchema([{ name: 'Learn', path: '/learn' }]),
        itemListSchema(
          LEARN_ARTICLES.map((article) => ({
            name: article.headline,
            path: `/learn/${article.slug}`,
          })),
        ),
      ]),
    ],
  }),
  component: LearnIndexPage,
})

function LearnIndexPage() {
  const accent = useAccent()

  return (
    <LandingShell>
      <PageTitle>Learn.</PageTitle>
      <Dek>
        The ideas Loora is built on, explained on their own terms. These are written to be useful to
        somebody who never signs up — if a page only makes sense as an argument for the product, it
        does not belong here.
      </Dek>

      <Section title="Articles">
        <CardGrid count={LEARN_ARTICLES.length}>
          {LEARN_ARTICLES.map((article) => (
            <CardLink
              key={article.slug}
              href={`/learn/${article.slug}`}
              title={article.headline}
              summary={article.tagline}
            />
          ))}
        </CardGrid>
      </Section>

      <Section title="Where to start">
        <p className="mt-4 text-muted-foreground">
          If you are here because an agent told you to install an MCP server, read{' '}
          <a href="/learn/what-is-an-mcp-server" className={LINK} style={accent}>
            what an MCP server is
          </a>
          . If you are trying to work out why generated code stops being useful the moment you want
          to change one thing, start with{' '}
          <a href="/learn/agent-editable-design-files" className={LINK} style={accent}>
            agent-editable design files
          </a>
          . If you already know both and want the practical version, the{' '}
          <a href="/mcp" className={LINK} style={accent}>
            setup guides
          </a>{' '}
          take about two minutes.
        </p>
        <p className="mt-4">
          <Link to="/features" className={LINK} style={accent}>
            What Loora actually does →
          </Link>
        </p>
      </Section>
    </LandingShell>
  )
}
