import { describe, expect, test } from 'vitest'
import { createEmailService } from './service'

describe('Cloudflare email service', () => {
  test('maps a verification email to the Cloudflare adapter', async () => {
    let request: Request | undefined
    const fetchMock = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        request = new Request(input, init)
        return Response.json({
          success: true,
          result: { queued: ['user@example.com'] },
        })
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch
    const email = createEmailService({
      apiToken: 'test-token',
      accountId: 'account-id',
      from: 'Loora <hello@loora.design>',
      replyTo: 'support@loora.design',
      fetch: fetchMock,
    })

    const result = await email.sendAccountVerification({
      email: 'user@example.com',
      name: 'Ada',
      token: 'secret-token',
      url: 'https://loora.design/api/auth/verify-email?token=secret-token',
    })

    expect(result.adapter).toBe('cloudflare')
    expect(result.accepted).toEqual(['user@example.com'])
    expect(request?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/send',
    )
    expect(request?.headers.get('authorization')).toBe('Bearer test-token')

    const payload = (await request?.json()) as Record<string, unknown>
    expect(payload.from).toEqual({
      address: 'hello@loora.design',
      name: 'Loora',
    })
    expect(payload.to).toEqual(['user@example.com'])
    expect(payload.reply_to).toBe('support@loora.design')
    expect(payload.subject).toBe('Verify your Loora email')
    expect(payload.html).toContain('Verify your email')
    expect(payload.text).toContain('Verify your email')
    expect(JSON.stringify(payload)).not.toContain('test-token')
  })

  test('fails before sending when required configuration is missing', () => {
    expect(() =>
      createEmailService({
        apiToken: '',
        accountId: 'account-id',
        from: 'Loora <hello@loora.design>',
      }),
    ).toThrow('CLOUDFLARE_EMAIL_API_TOKEN must be configured')
  })
})
