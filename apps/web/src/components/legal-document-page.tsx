import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import { Link } from '@tanstack/react-router'
import remarkGfm from 'remark-gfm'
import { LandingShell } from '#/components/landing/site-shell'

interface LegalDocumentPageProps {
  markdown: string
}

/** Map in-repo markdown paths and app routes to client routes. */
function resolveInternalHref(href: string): string | null {
  if (href.startsWith('/')) return href
  const file = href.replace(/^\.\//, '').toLowerCase()
  if (file === 'privacy.md' || file === 'privacy') return '/privacy'
  if (file === 'terms.md' || file === 'terms') return '/terms'
  return null
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-[15px] font-semibold leading-snug sm:text-[16px]">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 border-t border-dashed border-border pt-8 text-[14px] font-semibold">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-[13px] font-semibold">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-4 text-[13px] leading-6 text-muted-foreground first:mt-3">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-6 text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-6 text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ href, children }) => {
    const className = 'text-foreground underline-offset-2 hover:underline'
    if (!href) return <span className={className}>{children}</span>
    const internal = resolveInternalHref(href)
    if (internal) {
      return (
        <Link to={internal} className={className}>
          {children}
        </Link>
      )
    }
    return (
      <a
        href={href}
        className={className}
        rel="noreferrer"
        {...(href.startsWith('http') || href.startsWith('//')
          ? { target: '_blank' }
          : {})}
      >
        {children}
      </a>
    )
  },
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-8 border-dashed border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border pl-4 text-[13px] leading-6 text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div
      role="region"
      aria-label="Table"
      tabIndex={0}
      className="mt-5 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th scope="col" className="border border-dashed border-border px-3 py-2 font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-dashed border-border px-3 py-2 text-muted-foreground">
      {children}
    </td>
  ),
  code: ({ children, className }) => {
    const isBlock = Boolean(className)
    if (isBlock) {
      return (
        <code className="block overflow-x-auto border border-dashed border-border bg-card p-3 text-[12px] leading-5">
          {children}
        </code>
      )
    }
    return (
      <code className="border border-dashed border-border bg-card px-1 py-0.5 text-[12px]">
        {children}
      </code>
    )
  },
  pre: ({ children }) => <pre className="mt-4 overflow-x-auto">{children}</pre>,
}

export function LegalDocumentPage({ markdown }: LegalDocumentPageProps) {
  return (
    <LandingShell>
      <article>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </article>
      <p className="mt-10 border-t border-dashed border-border pt-8 text-[13px]">
        <Link className="underline-offset-2 hover:underline" to="/">
          ← Back to Loora
        </Link>
      </p>
    </LandingShell>
  )
}
