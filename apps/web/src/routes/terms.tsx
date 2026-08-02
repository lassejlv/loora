import { createFileRoute } from '@tanstack/react-router'
import terms from '../../../../assets/legal/TERMS.md?raw'
import { LegalDocumentPage } from '#/components/legal-document-page'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/terms')({
  head: () =>
    seo({
      title: 'Terms of Service — Loora',
      description: 'The Terms of Service governing access to and use of Loora.',
      path: '/terms',
    }),
  component: TermsPage,
})

function TermsPage() {
  return <LegalDocumentPage markdown={terms} />
}
