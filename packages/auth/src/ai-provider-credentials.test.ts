import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  AiProviderCredentialError,
  validateAiProviderApiKey,
} from './ai-provider-credentials'

const originalFetch = globalThis.fetch
const fetchMock = mock()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('custom AI provider API key validation', () => {
  test('validates Google keys without making a generation request', async () => {
    fetchMock.mockResolvedValue(Response.json({ models: [] }))

    await validateAiProviderApiKey('google', 'AIza-user-secret')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    )
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('AIza-user-secret')
  })

  test('validates OpenAI keys with bearer authentication', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [] }))

    await validateAiProviderApiKey('openai', 'sk-user-secret')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-user-secret')
  })

  test('validates Anthropic keys with required headers', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [] }))

    await validateAiProviderApiKey('anthropic', 'sk-ant-user-secret')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1')
    expect(headers.get('x-api-key')).toBe('sk-ant-user-secret')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
  })

  test('returns a safe error without exposing provider response content', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { message: 'upstream echoed sk-user-secret' } },
        { status: 401 },
      ),
    )

    try {
      await validateAiProviderApiKey('openai', 'sk-user-secret')
      throw new Error('Expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderCredentialError)
      expect((error as Error).message).toBe('OpenAI rejected this API key.')
      expect((error as Error).message).not.toContain('sk-user-secret')
    }
  })
})
