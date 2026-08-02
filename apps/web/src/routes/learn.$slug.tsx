import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { CodeBlock } from '#/components/landing/code-block'
import { findLearnArticle, LEARN_ARTICLES, LEARN_UPDATED } from '#/components/landing/learn'
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
  useAccent,
} from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { articleSchema, breadcrumbSchema, faqSchema, jsonLd, seo } from '#/lib/seo'

export const Route = createFileRoute('/learn/$slug')({
  loader: ({ params }) => {
    if (!findLearnArticle(params.slug)) throw notFound()
    return null
  },
  head: ({ params }) => {
    const article = findLearnArticle(params.slug)
    if (!article)
      return seo({
        title: 'Not found — Loora',
        description: 'This page does not exist.',
        noindex: true,
      })

    const path = `/learn/${article.slug}`
    return {
      ...seo({
        title: `${article.headline} — Loora`,
        description: article.description,
        path,
        type: 'article',
        publishedTime: article.published,
        modifiedTime: LEARN_UPDATED,
      }),
      scripts: [
        jsonLd([
          breadcrumbSchema([
            { name: 'Learn', path: '/learn' },
            { name: article.headline, path },
          ]),
          articleSchema({
            headline: article.headline,
            description: article.description,
            path,
            datePublished: article.published,
            dateModified: LEARN_UPDATED,
          }),
          faqSchema(article.faq),
        ]),
      ],
    }
  },
  notFoundComponent: NotFound,
  component: LearnArticlePage,
})

function NotFound() {
  const accent = useAccent()
  return (
    <LandingShell>
      <PageTitle>No article at that address.</PageTitle>
      <Dek>That page does not exist. The ones that do are listed on the index.</Dek>
      <p className="mt-6">
        <a href="/learn" className={LINK} style={accent}>
          All articles →
        </a>
      </p>
    </LandingShell>
  )
}

function LearnArticlePage() {
  const { slug } = Route.useParams()
  const article = findLearnArticle(slug)
  const accent = useAccent()

  if (!article) return <NotFound />

  const related = article.related
    .map((relatedSlug) => LEARN_ARTICLES.find((entry) => entry.slug === relatedSlug))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  return (
    <LandingShell>
      <Breadcrumbs
        trail={[
          { label: 'Learn', href: '/learn' },
          { label: article.headline, href: `/learn/${article.slug}` },
        ]}
      />

      <PageTitle>{article.headline}</PageTitle>
      <Dek>{article.dek}</Dek>

      {/* The page is long; give the reader its shape before they commit to it. */}
      <nav aria-label="On this page" className="mt-8 border-t border-dashed border-border pt-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {article.sections.map((section) => (
            <li key={section.heading}>
              <a href={`#${sectionId(section.heading)}`} className={LINK} style={accent}>
                {section.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {article.sections.map((section) => (
        <Section key={section.heading} id={sectionId(section.heading)} title={section.heading}>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="mt-4 text-muted-foreground">
              <RichText>{paragraph}</RichText>
            </p>
          ))}
          {section.bullets && <Bullets items={section.bullets} />}
          {section.code && <CodeBlock label={section.code.label} code={section.code.content} />}
        </Section>
      ))}

      <Section title="Questions">
        <Faq entries={article.faq} />
      </Section>

      <p className="mt-6 text-[12px] text-muted-foreground">
        Published {article.published}
        {LEARN_UPDATED !== article.published && `, last updated ${LEARN_UPDATED}`}.
      </p>

      <Related
        title="Related reading"
        items={related.map((entry) => ({ label: entry.headline, href: `/learn/${entry.slug}` }))}
      />

      <p className="mt-10">
        <a href="/mcp" className={LINK} style={accent}>
          Connect your agent over MCP →
        </a>
      </p>
      <p className="mt-4">
        <Link to="/app" className={LINK} style={accent}>
          Open a design →
        </Link>
      </p>
    </LandingShell>
  )
}

/** `What a server exposes` → `what-a-server-exposes`, for the on-page contents. */
function sectionId(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
