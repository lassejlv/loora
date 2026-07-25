import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'

let signedIn = false
let previewAllowed = true
let billingAllowed = true
let managedAiAccess = true
let billingSource: 'cache' | 'disabled' = 'disabled'
let generationLease: string | null = null
let flushAllowed = true
let meterBalance = 100
let topUpRemaining = 0
let chatgptModels: string[] | null = ['gpt-5.6-sol']
let openRouterApiKey: string | null = null
let releaseCalls: Array<[string, string]> = []
let chatTarget: { designId: string; draftId: string | null } | null = {
  designId: 'design-one',
  draftId: null,
}
let draftStatus: 'active' | 'proposed' | 'applied' | 'closed' | null = 'active'
const createOpenRouterMock = mock(() => {
  throw new Error('OpenRouter provider constructed')
})

const originalNeonBaseUrl = process.env.NEON_AI_GATEWAY_BASE_URL
const originalNeonToken = process.env.NEON_AI_GATEWAY_TOKEN

mock.module('@loora/db', () => ({
  db: {
    select: (fields: Record<string, unknown>) => {
      const rows =
        'designId' in fields && 'draftId' in fields
          ? chatTarget ? [chatTarget] : []
          : 'status' in fields
            ? draftStatus ? [{ status: draftStatus }] : []
            : []
      const query = {
        from: () => query,
        where: () => query,
        orderBy: () => query,
        limit: async () => rows,
      }
      return query
    },
  },
}))

mock.module('@loora/auth', () => ({
  requireSession: async () => signedIn ? { user: { id: 'user-one' } } : null,
}))

mock.module('@loora/auth/preview-access', () => ({
  canUseApp: () => previewAllowed,
  previewAccessRequiredResponse: () => Response.json(
    { error: 'Preview access is required.', code: 'PREVIEW_ACCESS_REQUIRED' },
    { status: 403 },
  ),
}))

mock.module('@loora/billing/billing', () => ({
  acquireGenerationLease: async () => generationLease,
  authorizeBilling: async () => ({
    access: billingAllowed,
    managedAiAccess,
    source: billingSource,
  }),
  refreshEntitlement: async () => ({ meterBalance }),
  releaseGenerationLease: async (userId: string, token: string) => {
    releaseCalls.push([userId, token])
  },
  subscriptionRequiredResponse: () => Response.json(
    { error: 'An active Loora plan is required.', code: 'SUBSCRIPTION_REQUIRED' },
    { status: 403 },
  ),
}))

mock.module('@loora/billing/billing-usage', () => ({
  flushPendingPolarUsage: async () => flushAllowed,
  reportPolarUsage: async () => true,
}))

mock.module('@loora/billing/credit-top-ups', () => ({
  getTopUpCreditStatus: async () => ({ remaining: topUpRemaining }),
}))

mock.module('@loora/auth/github', () => ({
  GitHubIntegrationError: class extends Error {},
  getGitHubRepositoryContextByName: async () => ({}),
  getGitHubStatus: async () => ({ enabled: false, connected: false }),
  listGitHubRepositories: async () => [],
  listRepositoryTree: async () => ({}),
  readRepositoryFile: async () => ({}),
  searchRepositoryCode: async () => ({}),
  viewRepositoryImage: async () => ({}),
}))

class MockOpenRouterIntegrationError extends Error {
  constructor(
    message: string,
    readonly code: 'RECONNECT_REQUIRED' | 'NOT_CONFIGURED',
  ) {
    super(message)
  }
}

mock.module('@loora/auth/openrouter', () => ({
  OpenRouterIntegrationError: MockOpenRouterIntegrationError,
  getOpenRouterApiKey: async () => {
    if (!openRouterApiKey) {
      throw new MockOpenRouterIntegrationError(
        'Connect OpenRouter in Settings before using this model.',
        'RECONNECT_REQUIRED',
      )
    }
    return openRouterApiKey
  },
}))

mock.module('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: createOpenRouterMock,
}))

mock.module('./internal/chatgpt-auth', () => ({
  chatgptAuth: {
    getModels: async () => chatgptModels,
    handler: async () => new Response('ChatGPT proxy', { status: 200 }),
    proxyFetch: () => async () => new Response(''),
  },
}))

const {
  handleAgentChatGPTRequest,
  handleAgentChatRequest,
} = await import('./server')

function chatRequest(model = 'gemini-3-5-flash') {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        id: 'user-message',
        role: 'user',
        parts: [{ type: 'text', text: 'Make a landing page' }],
      }],
      shapes: [],
      designId: 'design-one',
      chatId: 'chat-one',
      model,
    }),
  })
}

afterAll(() => {
  if (originalNeonBaseUrl === undefined) delete process.env.NEON_AI_GATEWAY_BASE_URL
  else process.env.NEON_AI_GATEWAY_BASE_URL = originalNeonBaseUrl
  if (originalNeonToken === undefined) delete process.env.NEON_AI_GATEWAY_TOKEN
  else process.env.NEON_AI_GATEWAY_TOKEN = originalNeonToken
  mock.restore()
})

describe('agent server HTTP contract', () => {
  beforeEach(() => {
    signedIn = false
    previewAllowed = true
    billingAllowed = true
    managedAiAccess = true
    billingSource = 'disabled'
    generationLease = null
    flushAllowed = true
    meterBalance = 100
    topUpRemaining = 0
    chatgptModels = ['gpt-5.6-sol']
    openRouterApiKey = null
    releaseCalls = []
    chatTarget = { designId: 'design-one', draftId: null }
    draftStatus = 'active'
    createOpenRouterMock.mockClear()
    process.env.NEON_AI_GATEWAY_BASE_URL = 'https://test-api.ai.us-east-2.aws.neon.tech'
    process.env.NEON_AI_GATEWAY_TOKEN = 'test-neon-token'
  })

  it('keeps unauthenticated chat requests at 401', async () => {
    const response = await handleAgentChatRequest(chatRequest())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('keeps unauthenticated ChatGPT proxy requests at 401', async () => {
    const response = await handleAgentChatGPTRequest(
      new Request('http://localhost/api/chatgpt/models'),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('keeps preview and subscription gates ahead of agent execution', async () => {
    signedIn = true
    previewAllowed = false
    const preview = await handleAgentChatRequest(chatRequest())
    expect(preview.status).toBe(403)
    expect(await preview.json()).toMatchObject({ code: 'PREVIEW_ACCESS_REQUIRED' })

    previewAllowed = true
    billingAllowed = false
    const billing = await handleAgentChatRequest(chatRequest())
    expect(billing.status).toBe(403)
    expect(await billing.json()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED' })
  })

  it('rejects mismatched and read-only draft targets', async () => {
    signedIn = true
    chatTarget = { designId: 'design-one', draftId: 'draft-one' }

    const mismatch = await handleAgentChatRequest(chatRequest())
    expect(mismatch.status).toBe(404)

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [],
        shapes: [],
        designId: 'design-one',
        draftId: 'draft-one',
        chatId: 'chat-one',
        model: 'gemini-3-5-flash',
      }),
    })
    draftStatus = 'proposed'
    const readOnly = await handleAgentChatRequest(request)
    expect(readOnly.status).toBe(409)
    expect(await readOnly.json()).toMatchObject({ code: 'DRAFT_READ_ONLY' })
  })

  it('preserves the managed-AI trial gate', async () => {
    signedIn = true
    managedAiAccess = false

    const response = await handleAgentChatRequest(chatRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TRIAL_CHATGPT_REQUIRED' })

    const openRouter = await handleAgentChatRequest(chatRequest('openrouter-auto'))
    expect(openRouter.status).toBe(401)
    expect(await openRouter.json()).toMatchObject({
      code: 'OPENROUTER_CONNECTION_REQUIRED',
    })
  })

  it('preserves provider configuration and ChatGPT availability errors', async () => {
    signedIn = true
    delete process.env.NEON_AI_GATEWAY_BASE_URL
    delete process.env.NEON_AI_GATEWAY_TOKEN
    const missingKey = await handleAgentChatRequest(chatRequest())
    expect(missingKey.status).toBe(503)
    expect(await missingKey.json()).toEqual({
      error: 'Loora is not configured. Set NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN on the server.',
    })

    chatgptModels = null
    const disconnected = await handleAgentChatRequest(chatRequest('gpt-5.6-sol'))
    expect(disconnected.status).toBe(401)

    chatgptModels = []
    const unavailable = await handleAgentChatRequest(chatRequest('gpt-5.6-sol'))
    expect(unavailable.status).toBe(403)
    expect(await unavailable.json()).toEqual({
      error: 'GPT-5.6 Sol is not available on this ChatGPT account.',
    })

    const openRouter = await handleAgentChatRequest(chatRequest('openrouter-auto'))
    expect(openRouter.status).toBe(401)
    expect(await openRouter.json()).toEqual({
      error: 'Connect OpenRouter in Settings before using this model.',
      code: 'OPENROUTER_CONNECTION_REQUIRED',
    })
  })

  it('constructs OpenRouter with the connected user key and Loora attribution', async () => {
    signedIn = true
    openRouterApiKey = 'sk-or-v1-user-key'

    await expect(handleAgentChatRequest(chatRequest('openrouter-auto'))).rejects.toThrow(
      'OpenRouter provider constructed',
    )
    expect(createOpenRouterMock).toHaveBeenCalledWith({
      apiKey: 'sk-or-v1-user-key',
      compatibility: 'strict',
      appName: 'Loora',
      appUrl: process.env.BETTER_AUTH_URL?.trim(),
    })
  })

  it('rejects lease conflicts before consuming credits', async () => {
    signedIn = true
    billingSource = 'cache'

    const response = await handleAgentChatRequest(chatRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'AI_GENERATION_IN_PROGRESS' })
    expect(releaseCalls).toEqual([])
  })

  it('releases the lease when pending billing delivery fails', async () => {
    signedIn = true
    billingSource = 'cache'
    generationLease = 'lease-one'
    flushAllowed = false

    const response = await handleAgentChatRequest(chatRequest())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'BILLING_TEMPORARILY_UNAVAILABLE' })
    expect(releaseCalls).toEqual([['user-one', 'lease-one']])
  })

  it('releases the lease when credits are exhausted', async () => {
    signedIn = true
    billingSource = 'cache'
    generationLease = 'lease-one'
    meterBalance = 0

    const response = await handleAgentChatRequest(chatRequest())

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'AI_CREDITS_EXHAUSTED' })
    expect(releaseCalls).toEqual([['user-one', 'lease-one']])
  })
})
