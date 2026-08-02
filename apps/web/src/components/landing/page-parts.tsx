import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { usePalette } from '#/components/landing/palette'

/**
 * The rhythm the long public pages share: a bar-prefixed heading, dashed rules
 * between sections, `+` for unordered points and `n.` for ordered ones.
 *
 * `/mcp/$client`, `/compare/$slug`, and `/learn/$slug` are generated from data,
 * so the parts they are made of live here rather than being written out three
 * times with three slightly different spacings.
 *
 * Cross-links between generated pages are plain anchors rather than `Link`:
 * `to` is typed against route patterns (`/mcp/$client`), and these components
 * only ever hold a resolved path. The pages are server-rendered, so a full
 * navigation costs a document request and nothing else.
 */

/** Repeated on every inline link; the colour comes from the palette. */
export const LINK = 'underline-offset-2 hover:underline'

export function useAccent() {
  return { color: usePalette().accent }
}

/**
 * Renders `` `backticked` `` spans in a data string as inline code.
 *
 * These pages are half prose and half configuration keys — `serverUrl` versus
 * `httpUrl` is the whole answer on some of them — and a key set in body text is
 * a key the reader mistypes. The data files are plain strings, so this is the
 * one piece of markup they are allowed.
 */
export function RichText({ children }: { children: string }) {
  const parts = children.split('`')
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={`${index}-${part}`} className="text-foreground">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** Data strings get inline code; JSX children are passed through untouched. */
function render(children: ReactNode) {
  return typeof children === 'string' ? <RichText>{children}</RichText> : children
}

export function PageTitle({ children }: { children: ReactNode }) {
  const accent = useAccent()
  return (
    <h1 className="flex gap-2 text-[15px] font-semibold leading-snug sm:text-[16px]">
      <span aria-hidden="true" style={accent}>
        |
      </span>
      <span>{children}</span>
    </h1>
  )
}

/** The standfirst under an `<h1>` — one paragraph, before any section. */
export function Dek({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-muted-foreground">{render(children)}</p>
}

export function Section({
  title,
  id,
  children,
}: {
  title: string
  id?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-16 border-t border-dashed border-border pt-8">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-muted-foreground">{render(children)}</p>
}

export function Bullets({ items }: { items: readonly string[] }) {
  const accent = useAccent()
  return (
    <ul className="mt-4 flex flex-col gap-1.5 text-[13px]">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden="true" className="shrink-0 select-none" style={accent}>
            +
          </span>
          <span className="text-muted-foreground">
            <RichText>{item}</RichText>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Steps({ items }: { items: readonly string[] }) {
  const accent = useAccent()
  return (
    <ol className="mt-4 flex list-none flex-col gap-2 text-[13px] text-muted-foreground">
      {items.map((item, index) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden="true" className="shrink-0 select-none" style={accent}>
            {index + 1}.
          </span>
          <span>
            <RichText>{item}</RichText>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Rendered as real headings and paragraphs rather than a `<details>` list: the
 * matching FAQPage schema claims this text is on the page, and it has to be
 * true without a click.
 */
export function Faq({ entries }: { entries: readonly { question: string; answer: string }[] }) {
  return (
    <div className="mt-4 flex flex-col gap-5">
      {entries.map((entry) => (
        <div key={entry.question}>
          <h3 className="text-[13px] font-semibold">
            <RichText>{entry.question}</RichText>
          </h3>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            <RichText>{entry.answer}</RichText>
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * A visible trail, above the title. The BreadcrumbList schema on these pages
 * describes navigation the reader can actually see and use.
 */
export function Breadcrumbs({
  trail,
}: {
  trail: readonly { label: string; href: string }[]
}) {
  const accent = useAccent()
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-[12px] text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link to="/" className={LINK} style={accent}>
            Loora
          </Link>
        </li>
        {trail.map((crumb, index) => (
          <li key={crumb.href} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="select-none text-muted-foreground/40">
              /
            </span>
            {index === trail.length - 1 ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <a href={crumb.href} className={LINK} style={accent}>
                {crumb.label}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * The hairline grid used by every hub page. Two columns on desktop; an odd
 * final item runs the full width so the last row has no dead cell.
 */
export function CardGrid({ children, count }: { children: ReactNode; count: number }) {
  return (
    <ul
      data-odd={count % 2 === 1 ? '' : undefined}
      className="mt-5 grid gap-px border border-border bg-border sm:grid-cols-2 [&[data-odd]>li:last-child]:sm:col-span-2"
    >
      {children}
    </ul>
  )
}

export function CardLink({
  href,
  title,
  summary,
  meta,
}: {
  href: string
  title: string
  summary: string
  meta?: string
}) {
  const accent = useAccent()
  return (
    <li>
      <a href={href} className="block h-full bg-background px-4 py-3 transition-colors hover:bg-card">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium" style={accent}>
            {title}
          </span>
          {meta && <span className="shrink-0 text-[11px] text-muted-foreground">{meta}</span>}
        </span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">{summary}</span>
      </a>
    </li>
  )
}

/** Cross-links between sibling pages, so nothing in a generated set is a dead end. */
export function Related({
  title,
  items,
}: {
  title: string
  items: readonly { label: string; href: string }[]
}) {
  const accent = useAccent()
  if (items.length === 0) return null
  return (
    <section className="mt-12 border-t border-dashed border-border pt-6">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} className={LINK} style={accent}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
