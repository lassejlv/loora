import { createFileRoute, Link } from '@tanstack/react-router'
import { Bullets, Dek, PageTitle, Section } from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { seo } from '#/lib/seo'

const TITLE = "Loora's cloud continues"

const DESCRIPTION =
  'Loora will continue its cloud version. Hosted accounts, files, and the product stay. The project remains open source.'

export const Route = createFileRoute('/cloud')({
  head: () =>
    seo({
      title: TITLE,
      description: DESCRIPTION,
      path: '/cloud',
    }),
  component: CloudPage,
})

function CloudPage() {
  return (
    <LandingShell>
      <PageTitle>Loora will continue its cloud version.</PageTitle>
      <Dek>
        The hosted product stays. Your files, accounts, branches, and billing
        are not being deleted. Loora remains open source.
      </Dek>

      <Section title="What continues">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          The web app, the desktop app, the remote MCP server, realtime, and
          every related account surface keep running. There is no shutdown date
          and no data-deletion deadline.
        </p>
      </Section>

      <Section title="Your data">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          Design files, branches, version history, assets, MCP sessions, and
          connected integrations stay with your account. Export is still
          available whenever you want a local copy — it is not required to keep
          using Loora.
        </p>
        <Bullets
          items={[
            'Open a file and use Export if you want HTML, React, JSON, or PNG on your machine.',
            'The project stays on GitHub if you want to read, fork, or self-host.',
            'Questions about your account: support@loora.design.',
          ]}
        />
      </Section>

      <Section title="Billing">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          Paid plans continue as usual. If a charge looks wrong, email{' '}
          <a className="text-foreground underline-offset-2 hover:underline" href="mailto:support@loora.design">
            support@loora.design
          </a>
          .
        </p>
      </Section>

      <Section title="Keep going">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          Sign-in, files, and the hosted canvas all keep working. Nothing here
          asks you to leave.
        </p>
        <p className="mt-6 text-[13px]">
          <Link className="underline-offset-2 hover:underline" to="/app">
            Open your files →
          </Link>
        </p>
      </Section>
    </LandingShell>
  )
}
