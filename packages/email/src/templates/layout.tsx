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
  background: '#f5f4f0',
  foreground: '#1c1d1a',
  card: '#fdfcf8',
  cardForeground: '#1c1d1a',
  primary: '#1c1d1a',
  primaryForeground: '#fdfcf8',
  muted: '#efede7',
  mutedForeground: '#74746d',
  border: '#e6e4dc',
  radius: 12,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

export type LooraEmailLayoutProps = {
  actionLabel?: string
  actionUrl?: string
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
    <ShadcnEmail preview={preview} theme={theme} bodyStyle={{ padding: '48px 16px' }}>
      <EmailCard>
        <EmailText
          style={{
            fontSize: '17px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            marginBottom: '36px',
          }}
        >
          loora<span style={{ color: '#b0b0a4' }}>.</span>
        </EmailText>
        <EmailHeading
          style={{
            fontSize: '30px',
            fontWeight: 600,
            letterSpacing: '-0.03em',
            lineHeight: '38px',
            marginBottom: '12px',
          }}
        >
          {heading}
        </EmailHeading>
        {children}
        {actionLabel && actionUrl ? (
          <>
            <EmailButton
              href={actionUrl}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'center',
                boxSizing: 'border-box',
                fontSize: '15px',
                fontWeight: 600,
                padding: '14px 24px',
                borderRadius: 12,
                marginTop: '8px',
              }}
            >
              {actionLabel}
            </EmailButton>
            <EmailSeparator style={{ margin: '32px 0' }} />
            <EmailText muted style={{ fontSize: '13px', lineHeight: '20px', marginBottom: '6px' }}>
              If the button doesn't work, paste this link into your browser:
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
          </>
        ) : null}
      </EmailCard>
      <EmailText
        muted
        style={{
          fontSize: '12px',
          margin: '24px auto 0',
          maxWidth: '600px',
          textAlign: 'center',
        }}
      >
        Loora
      </EmailText>
    </ShadcnEmail>
  )
}