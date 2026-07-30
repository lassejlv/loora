import { createFileRoute } from '@tanstack/react-router'
import privacy from '../../../../assets/legal/PRIVACY.md?raw'
import { LegalDocumentPage } from '#/components/legal-document-page'

export const Route = createFileRoute('/privacy')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Privacy Policy — loora' },
      {
        name: 'description',
        content: 'How Loora collects, uses, shares, and protects personal data.',
      },
    ],
  }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return <LegalDocumentPage markdown={privacy} />
}
