import { Link } from '@tanstack/react-router'
import { LandingShell } from '#/components/landing/site-shell'

interface LegalDocumentPageProps {
  markdown: string
}

export function LegalDocumentPage({ markdown }: LegalDocumentPageProps) {
  return (
    <LandingShell>
      <article>
        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-6 text-foreground">
          {markdown}
        </pre>
      </article>
      <p className="mt-10 border-t border-dashed border-border pt-8">
        <Link className="underline-offset-2 hover:underline" to="/">
          ← Back to Loora
        </Link>
      </p>
    </LandingShell>
  )
}
