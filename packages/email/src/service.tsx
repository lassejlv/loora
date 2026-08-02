import { createHash } from 'node:crypto'
import { createEmailClient, type EmailSendResult } from '@opencoredev/email-sdk'
import { cloudflare } from '@opencoredev/email-sdk/cloudflare'
import { renderEmail } from '@opencoredev/email-sdk/react'
import { AccountVerificationEmail } from './templates/account-verification'
import { DesignInvitationEmail } from './templates/design-invitation'
import { PasswordResetEmail } from './templates/password-reset'
import { TwoFactorOtpEmail } from './templates/two-factor-otp'

export type EmailServiceConfig = {
  accountId: string
  apiToken: string
  fetch?: typeof fetch
  from: string
  replyTo?: string
}

export type AccountVerificationInput = {
  email: string
  name?: string | null
  token: string
  url: string
}

export type PasswordResetInput = {
  email: string
  name?: string | null
  token: string
  url: string
}

export type TwoFactorOtpInput = {
  email: string
  name?: string | null
  code: string
}

export type DesignInvitationInput = {
  email: string
  inviteeName?: string | null
  inviterName: string
  designName: string
  designUrl: string
  role: 'view' | 'edit'
}

export type EmailService = {
  sendAccountVerification(
    input: AccountVerificationInput,
  ): Promise<EmailSendResult<'cloudflare'>>
  sendPasswordReset(input: PasswordResetInput): Promise<EmailSendResult<'cloudflare'>>
  sendTwoFactorOTP(input: TwoFactorOtpInput): Promise<EmailSendResult<'cloudflare'>>
  sendDesignInvitation(input: DesignInvitationInput): Promise<EmailSendResult<'cloudflare'>>
}

export function createEmailService(config: EmailServiceConfig): EmailService {
  assertConfigured(config.apiToken, 'CLOUDFLARE_EMAIL_API_TOKEN')
  assertConfigured(config.accountId, 'CLOUDFLARE_ACCOUNT_ID')
  assertConfigured(config.from, 'EMAIL_FROM')

  const client = createEmailClient({
    adapters: [
      cloudflare({
        apiToken: config.apiToken,
        accountId: config.accountId,
        fetch: config.fetch,
      }),
    ],
    defaultAdapter: 'cloudflare',
    retry: { maxAttempts: 1 },
    telemetry: false,
  })

  const addressFields = config.replyTo ? { replyTo: config.replyTo } : {}

  return {
    async sendAccountVerification(input) {
      const content = await renderEmail(
        <AccountVerificationEmail name={input.name} verificationUrl={input.url} />,
      )

      return client.send(
        {
          from: config.from,
          to: input.email,
          subject: 'Verify your Loora email',
          ...addressFields,
          ...content,
        },
        {
          idempotencyKey: operationKey('account-verification', input.token),
          metadata: { kind: 'account-verification' },
        },
      )
    },

    async sendPasswordReset(input) {
      const content = await renderEmail(
        <PasswordResetEmail name={input.name} resetUrl={input.url} />,
      )

      return client.send(
        {
          from: config.from,
          to: input.email,
          subject: 'Reset your Loora password',
          ...addressFields,
          ...content,
        },
        {
          idempotencyKey: operationKey('password-reset', input.token),
          metadata: { kind: 'password-reset' },
        },
      )
    },

    async sendTwoFactorOTP(input) {
      const content = await renderEmail(
        <TwoFactorOtpEmail name={input.name} code={input.code} />,
      )

      return client.send(
        {
          from: config.from,
          to: input.email,
          subject: 'Your Loora verification code',
          ...addressFields,
          ...content,
        },
        {
          idempotencyKey: operationKey('two-factor-otp', input.code),
          metadata: { kind: 'two-factor-otp' },
        },
      )
    },

    async sendDesignInvitation(input) {
      const content = await renderEmail(
        <DesignInvitationEmail
          inviteeName={input.inviteeName}
          inviterName={input.inviterName}
          designName={input.designName}
          designUrl={input.designUrl}
          role={input.role}
        />,
      )

      return client.send(
        {
          from: config.from,
          to: input.email,
          subject: `${input.inviterName} invited you to "${input.designName}" on Loora`,
          ...addressFields,
          ...content,
        },
        {
          idempotencyKey: operationKey('design-invitation', input.designUrl),
          metadata: { kind: 'design-invitation' },
        },
      )
    },
  }
}

let emailService: EmailService | undefined

export function getEmailService() {
  emailService ??= createEmailService({
    apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() ?? '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '',
    from: process.env.EMAIL_FROM?.trim() ?? '',
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
  })

  return emailService
}

export function sendAccountVerificationEmail(input: AccountVerificationInput) {
  return getEmailService().sendAccountVerification(input)
}

export function sendPasswordResetEmail(input: PasswordResetInput) {
  return getEmailService().sendPasswordReset(input)
}

export function sendTwoFactorOTPEmail(input: TwoFactorOtpInput) {
  return getEmailService().sendTwoFactorOTP(input)
}

export function sendDesignInvitationEmail(input: DesignInvitationInput) {
  return getEmailService().sendDesignInvitation(input)
}

function operationKey(kind: string, token: string) {
  const digest = createHash('sha256').update(token).digest('hex')
  return `loora:${kind}:${digest}`
}

function assertConfigured(value: string, name: string) {
  if (!value) throw new Error(`${name} must be configured before sending email.`)
}
