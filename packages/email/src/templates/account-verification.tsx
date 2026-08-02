import { EmailText } from '@opencoredev/email-sdk/react'
import { LooraEmailLayout } from './layout'

export type AccountVerificationEmailProps = {
  name?: string | null
  verificationUrl: string
}

export function AccountVerificationEmail({
  name,
  verificationUrl,
}: AccountVerificationEmailProps) {
  return (
    <LooraEmailLayout
      actionLabel="Verify email"
      actionUrl={verificationUrl}
      heading="Verify your email"
      preview="Verify your email to finish setting up your Loora account."
    >
      <EmailText>
        {name ? `Hi ${name},` : 'Hi,'} confirm this email to finish setting up your Loora
        account.
      </EmailText>
      <EmailText muted>
        This link expires in one hour. If you didn't create a Loora account, you can ignore this
        email.
      </EmailText>
    </LooraEmailLayout>
  )
}