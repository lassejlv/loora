import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  OpenRouterIntegrationError,
  validateOpenRouterApiKey,
} from './openrouter'

const originalFetch = globalThis.fetch
const fetchMock = mock()

describe('OpenRouter API key validation', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('validates a key without spending tokens and returns its label', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: { label: 'Loora key', usage: 0 } }),
    )

    await expect(validateOpenRouterApiKey('sk-or-v1-test-key')).resolves.toEqual({
      label: 'Loora key',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/key')
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer sk-or-v1-test-key',
      'X-OpenRouter-Title': 'Loora',
    })
    expect(options.method).toBeUndefined()
  })

  it('rejects invalid keys without storing provider response content', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { message: 'sensitive upstream detail' } }, { status: 401 }),
    )

    const error = await validateOpenRouterApiKey('sk-or-v1-invalid').catch(
      (caught) => caught,
    )
    expect(error).toBeInstanceOf(OpenRouterIntegrationError)
    expect(error).toMatchObject({
      code: 'INVALID_KEY',
      message: 'OpenRouter rejected this API key.',
    })
    expect(error.message).not.toContain('sensitive upstream detail')
  })

  it('rejects malformed keys before making a network request', async () => {
    const error = await validateOpenRouterApiKey('short').catch((caught) => caught)

    expect(error).toMatchObject({ code: 'INVALID_KEY' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
