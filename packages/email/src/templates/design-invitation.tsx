import { EmailText } from '@opencoredev/email-sdk/react'
import { LooraEmailLayout } from './layout'

export type DesignInvitationEmailProps = {
  inviteeName?: string | null
  inviterName: string
  designName: string
  designUrl: string
  role: 'view' | 'edit'
}

export function DesignInvitationEmail({
  inviteeName,
  inviterName,
  designName,
  designUrl,
  role,
}: DesignInvitationEmailProps) {
  const roleLabel = role === 'edit' ? 'edit' : 'view'
  return (
    <LooraEmailLayout
      actionLabel="Open design"
      actionUrl={designUrl}
      heading={`${inviterName} invited you`}
      preview={`${inviterName} shared a Loora design with you.`}
    >
      <EmailText>
        {inviteeName ? `Hi ${inviteeName},` : 'Hi,'} {inviterName} shared{' '}
        <strong>{designName}</strong> on Loora and invited you to {roleLabel} it.
      </EmailText>
      <EmailText muted>
        Loora is an infinite-canvas design tool. If you weren't expecting this invitation, you can
        safely ignore this email.
      </EmailText>
    </LooraEmailLayout>
  )
}