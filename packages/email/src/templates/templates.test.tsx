import { describe, expect, test } from 'vitest'
import { renderEmail } from '@opencoredev/email-sdk/react'
import { AccountVerificationEmail } from './account-verification'
import { PasswordResetEmail } from './password-reset'

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
})
