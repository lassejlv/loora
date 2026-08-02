import { createFileRoute } from '@tanstack/react-router'
import privacy from '../../../../assets/legal/PRIVACY.md?raw'
import { LegalDocumentPage } from '#/components/legal-document-page'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/privacy')({
  head: () =>
    seo({
      title: 'Privacy Policy — Loora',
      description: 'How Loora collects, uses, shares, and protects personal data.',
      path: '/privacy',
    }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return <LegalDocumentPage markdown={privacy} />
}
