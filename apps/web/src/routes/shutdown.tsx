import { createFileRoute, Link } from '@tanstack/react-router'
import { SHUTDOWN_ON } from '@loora/shell/shutdown-banner'
import { Bullets, Dek, PageTitle, Section } from '#/components/landing/page-parts'
import { LandingShell } from '#/components/landing/site-shell'
import { seo } from '#/lib/seo'

const TITLE = 'Loora is shutting down — 1 September 2026'

const DESCRIPTION =
  'Loora ends on 1 September 2026. The hosted service stops and all user and customer data is deleted. The project stays open source.'

export const Route = createFileRoute('/shutdown')({
  head: () =>
    seo({
      title: TITLE,
      description: DESCRIPTION,
      path: '/shutdown',
    }),
  component: ShutdownPage,
})

function ShutdownPage() {
  return (
    <LandingShell>
      <PageTitle>Loora is shutting down.</PageTitle>
      <Dek>
        The hosted service ends on {SHUTDOWN_ON}. After that date Loora will no
        longer run, and all user and customer data will be permanently deleted.
        The source stays public.
      </Dek>

      <Section title="What is ending">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          On {SHUTDOWN_ON} the hosted product stops. The web app, the desktop
          app, the remote MCP server, realtime, billing, and every related
          account surface will go offline. There is no successor hosted product
          and no migration of accounts into another service.
        </p>
      </Section>

      <Section title="The source stays">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          Loora remains open source. Shutting down the service does not take
          the repository private or off GitHub. You can keep reading, forking,
          and running the code yourself after {SHUTDOWN_ON} — that path does
          not include the hosted accounts or the data stored in them.
        </p>
        <p className="mt-4 text-[13px]">
          <a
            className="underline-offset-2 hover:underline"
            href="https://github.com/lassejlv/loora"
            rel="noreferrer"
            target="_blank"
          >
            github.com/lassejlv/loora →
          </a>
        </p>
      </Section>

      <Section title="Your data">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          After {SHUTDOWN_ON}, every account and everything stored with it is
          deleted. That includes design files, branches, version history,
          assets, MCP sessions, connected integrations, billing records we hold
          for the product, and account details. Deletion is permanent. We will
          not keep a copy to restore later.
        </p>
        <Bullets
          items={[
            'Export anything you need to keep before 1 September 2026. Open a file and use Export.',
            'Downloads you already have (HTML, React, JSON, PNG) stay on your machine. They do not come back into Loora.',
            'Questions about your account or data: support@loora.design.',
          ]}
        />
      </Section>

      <Section title="Billing">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          Paid plans end with the service. You will not be charged for Loora
          after it shuts down. If a charge looks wrong, email{' '}
          <a className="text-foreground underline-offset-2 hover:underline" href="mailto:support@loora.design">
            support@loora.design
          </a>
          .
        </p>
      </Section>

      <Section title="Until then">
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          You can keep using Loora through {SHUTDOWN_ON}. After that, sign-in
          will fail and stored data will be gone. If you only need your files,
          export them now and do not wait.
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
