import { describe, expect, test } from 'vitest'
import { renderEmail } from '@opencoredev/email-sdk/react'
import { AccountVerificationEmail } from './account-verification'
import { DesignInvitationEmail } from './design-invitation'
import { PasswordResetEmail } from './password-reset'
import { TwoFactorOtpEmail } from './two-factor-otp'

describe('transactional email templates', () => {
  test('renders account verification as HTML and plain text', async () => {
    const url = 'https://loora.design/api/auth/verify-email?token=verification-token'
    const content = await renderEmail(
      <AccountVerificationEmail name="Ada" verificationUrl={url} />,
    )

    expect(content.html).toContain('Verify your email')
    expect(content.html).toContain('Hi Ada,')
    expect(content.html).toContain(url.replaceAll('&', '&amp;'))
    expect(content.text).toContain('Verify your email')
    expect(content.text).toContain(url)
  })

  test('renders password reset without requiring a display name', async () => {
    const url = 'https://loora.design/reset-password?token=reset-token'
    const content = await renderEmail(<PasswordResetEmail resetUrl={url} />)

    expect(content.html).toContain('Reset your password')
    expect(content.text).toContain('Hi,')
    expect(content.text).toContain(url)
  })

  test('renders two-factor OTP with the code and no action button', async () => {
    const content = await renderEmail(
      <TwoFactorOtpEmail name="Ada" code="123456" />,
    )

    expect(content.html).toContain('Your Loora verification code')
    expect(content.html).toContain('Hi Ada,')
    expect(content.html).toContain('123456')
    expect(content.html).not.toContain('paste this link')
    expect(content.text).toContain('123456')
  })

  test('renders design invitation with inviter, design name, and link', async () => {
    const url = 'https://loora.design/design/d1a2b3c4'
    const content = await renderEmail(
      <DesignInvitationEmail
        inviterName="Ada"
        designName="Landing Page"
        designUrl={url}
        role="edit"
      />,
    )

    expect(content.html).toContain('Ada invited you')
    expect(content.html).toContain('Landing Page')
    expect(content.html).toContain(url)
    expect(content.html).toContain('edit')
    expect(content.text).toContain('invited you')
    expect(content.text).toContain('Landing Page')
    expect(content.text).toContain(url)
  })
})
