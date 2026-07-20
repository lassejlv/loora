import { describe, expect, it } from 'bun:test'
import {
  GitHubIntegrationError,
  isRepositoryImage,
  isSensitiveRepositoryPath,
  normalizeRepositoryPath,
  redactRepositorySecrets,
  verifyGitHubWebhookSignature,
} from './github'

describe('GitHub repository safety', () => {
  it('normalizes relative repository paths and rejects traversal', () => {
    expect(normalizeRepositoryPath('./src\\app.tsx')).toBe('src/app.tsx')

    for (const path of ['/etc/passwd', '../secret', 'src/../secret', 'src//app.ts', '././app.ts']) {
      expect(() => normalizeRepositoryPath(path)).toThrow(GitHubIntegrationError)
    }
  })

  it('blocks credential-shaped paths but allows examples and normal source', () => {
    expect(isSensitiveRepositoryPath('.env')).toBe(true)
    expect(isSensitiveRepositoryPath('config/.env.production')).toBe(true)
    expect(isSensitiveRepositoryPath('keys/deploy.pem')).toBe(true)
    expect(isSensitiveRepositoryPath('config/client-secrets.json')).toBe(true)
    expect(isSensitiveRepositoryPath('.env.example')).toBe(false)
    expect(isSensitiveRepositoryPath('src/config.ts')).toBe(false)
  })

  it('redacts common tokens, private keys, and credential assignments', () => {
    const source = [
      'const token = "ghp_abcdefghijklmnopqrstuvwxyz123456"',
      'DATABASE_PASSWORD=correct-horse-battery-staple',
      '-----BEGIN PRIVATE KEY-----',
      'private material',
      '-----END PRIVATE KEY-----',
    ].join('\n')
    const result = redactRepositorySecrets(source)

    expect(result.redacted).toBe(true)
    expect(result.text).not.toContain('ghp_')
    expect(result.text).not.toContain('correct-horse')
    expect(result.text).not.toContain('private material')
    expect(result.text).toContain('DATABASE_PASSWORD=[REDACTED]')
  })

  it('checks image signatures instead of trusting file extensions', () => {
    expect(isRepositoryImage(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      'image/png',
    )).toBe(true)
    expect(isRepositoryImage(new TextEncoder().encode('not really a png'), 'image/png')).toBe(false)
    expect(isRepositoryImage(new TextEncoder().encode('GIF89a'), 'image/gif')).toBe(true)
    expect(isRepositoryImage(new TextEncoder().encode('RIFF0000WEBP'), 'image/webp')).toBe(true)
  })

  it('verifies webhook signatures against the exact raw body', async () => {
    const secret = 'webhook-test-secret'
    const body = '{"installation":{"id":42}}'
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const digest = Buffer.from(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    ).toString('hex')

    expect(await verifyGitHubWebhookSignature(body, `sha256=${digest}`, secret)).toBe(true)
    expect(await verifyGitHubWebhookSignature(`${body}\n`, `sha256=${digest}`, secret)).toBe(false)
    expect(await verifyGitHubWebhookSignature(body, 'sha1=bad', secret)).toBe(false)
    expect(await verifyGitHubWebhookSignature(body, `sha256=${digest}zz`, secret)).toBe(false)
  })
})
