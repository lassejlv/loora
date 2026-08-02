import { EmailText } from '@opencoredev/email-sdk/react'
import { LooraEmailLayout } from './layout'

export type TwoFactorOtpEmailProps = {
  name?: string | null
  code: string
}

export function TwoFactorOtpEmail({ name, code }: TwoFactorOtpEmailProps) {
  return (
    <LooraEmailLayout
      heading="Your Loora verification code"
      preview="Enter this code to complete sign-in."
    >
      <EmailText>
        {name ? `Hi ${name},` : 'Hi,'} here is your one-time verification code for Loora:
      </EmailText>
      <EmailText
        style={{
          fontSize: '32px',
          fontWeight: 600,
          letterSpacing: '0.2em',
          textAlign: 'center',
          margin: '24px 0',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        }}
      >
        {code}
      </EmailText>
      <EmailText muted>
        This code expires shortly. If you didn't try to sign in, you can safely ignore this email.
      </EmailText>
    </LooraEmailLayout>
  )
}