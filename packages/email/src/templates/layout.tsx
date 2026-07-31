import type { ReactNode } from 'react'
import {
  EmailButton,
  EmailCard,
  EmailHeading,
  EmailSeparator,
  EmailText,
  ShadcnEmail,
} from '@opencoredev/email-sdk/react'

const theme = {
  background: '#f4f3ef',
  foreground: '#242522',
  card: '#fbfaf7',
  cardForeground: '#242522',
  primary: '#292b27',
  primaryForeground: '#fbfaf7',
  muted: '#eeece6',
  mutedForeground: '#696b64',
  border: '#d8d5cd',
  radius: 10,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

export type LooraEmailLayoutProps = {
  actionLabel: string
  actionUrl: string
  children: ReactNode
  heading: string
  preview: string
}

export function LooraEmailLayout({
  actionLabel,
  actionUrl,
  children,
  heading,
  preview,
}: LooraEmailLayoutProps) {
  return (
    <ShadcnEmail preview={preview} theme={theme}>
      <EmailCard>
        <EmailText
          style={{
            fontSize: '18px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: '28px',
          }}
        >
          loora<span style={{ color: '#797d71' }}>.</span>
        </EmailText>
        <EmailHeading>{heading}</EmailHeading>
        {children}
        <EmailButton href={actionUrl}>{actionLabel}</EmailButton>
        <EmailSeparator />
        <EmailText muted style={{ fontSize: '13px', lineHeight: '20px' }}>
          If the button does not work, copy and paste this link into your browser:
        </EmailText>
        <EmailText
          muted
          style={{
            fontSize: '13px',
            lineHeight: '20px',
            marginBottom: 0,
            overflowWrap: 'anywhere',
          }}
        >
          {actionUrl}
        </EmailText>
      </EmailCard>
      <EmailText
        muted
        style={{
          fontSize: '12px',
          margin: '18px auto 0',
          maxWidth: '600px',
          textAlign: 'center',
        }}
      >
        Loora · The canvas for structured interface design
      </EmailText>
    </ShadcnEmail>
  )
}
