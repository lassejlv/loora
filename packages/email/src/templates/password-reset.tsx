import { EmailText } from '@opencoredev/email-sdk/react'
import { LooraEmailLayout } from './layout'

export type PasswordResetEmailProps = {
  name?: string | null
  resetUrl: string
}

export function PasswordResetEmail({ name, resetUrl }: PasswordResetEmailProps) {
  return (
    <LooraEmailLayout
      actionLabel="Reset password"
      actionUrl={resetUrl}
      heading="Reset your password"
      preview="Use this secure link to choose a new Loora password."
    >
      <EmailText>
        {name ? `Hi ${name},` : 'Hi,'} we received a request to reset the password for your
        Loora account.
      </EmailText>
      <EmailText muted>
        This link expires in one hour. If you didn't request this, you can safely ignore this
        email.
      </EmailText>
    </LooraEmailLayout>
  )
}