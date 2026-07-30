import { createFileRoute, Link } from '@tanstack/react-router'
import { FEATURE_SECTIONS } from '#/components/landing/features'
import { usePalette } from '#/components/landing/palette'
import { LandingShell } from '#/components/landing/site-shell'

const DESCRIPTION =
  'What Loora does: a normalized canvas document, typed transactions shared by the editor and your agent, MCP, branches, history, deterministic exports, HTML/CSS import, and GitHub read access.'

export const Route = createFileRoute('/features')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Features — loora' },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: 'Features — loora' },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:image', content: '/landing-cover.png' },
    ],
  }),
  component: FeaturesPage,
})

function FeaturesPage() {
  return (
    <LandingShell>
      <FeaturesContent />
    </LandingShell>
  )
}

function FeaturesContent() {
  const palette = usePalette()
  const link = { color: palette.accent }

  return (
    <>
      <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <span aria-hidden="true" style={link}>
          |
        </span>
        <span>Features.</span>
      </h1>

      <p className="mt-6 text-muted-foreground">
        Loora is an infinite canvas whose document is structured all the way down, and a set of
        typed operations over it that the editor and your agent both use. Everything below is one
        of those two things.
      </p>

      {/* Contents: the page is long, so give the reader the shape of it first. */}
      <nav aria-label="On this page" className="mt-8 border-t border-dashed border-border pt-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {FEATURE_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="underline-offset-2 hover:underline"
                style={link}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {FEATURE_SECTIONS.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="mt-10 scroll-mt-16 border-t border-dashed border-border pt-8"
        >
          <h2 className="text-[15px] font-semibold">{section.title}</h2>
          <p className="mt-4 text-muted-foreground">{section.lead}</p>
          <ul className="mt-4 flex flex-col gap-1.5 text-[13px]">
            {section.points.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden="true" className="select-none" style={link}>
                  +
                </span>
                <span className="text-muted-foreground">{point}</span>
              </li>
            ))}
          </ul>
          {section.id === 'mcp' && (
            <p className="mt-4 text-[13px]">
              <Link to="/mcp" className="underline-offset-2 hover:underline" style={link}>
                Set up MCP with your agent →
              </Link>
            </p>
          )}
        </section>
      ))}

      <p className="mt-12 border-t border-dashed border-border pt-8">
        <Link to="/app" className="underline-offset-2 hover:underline" style={link}>
          Open a design →
        </Link>
      </p>
      <p className="mt-4">
        <Link to="/pricing" className="underline-offset-2 hover:underline" style={link}>
          See what each plan includes →
        </Link>
      </p>
    </>
  )
}
