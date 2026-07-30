import { createFileRoute } from '@tanstack/react-router'
import terms from '../../../../assets/legal/TERMS.md?raw'
import { LegalDocumentPage } from '#/components/legal-document-page'

export const Route = createFileRoute('/terms')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Terms of Service — loora' },
      {
        name: 'description',
        content: 'The Terms of Service governing access to and use of Loora.',
      },
    ],
  }),
  component: TermsPage,
})

function TermsPage() {
  return <LegalDocumentPage markdown={terms} />
}
