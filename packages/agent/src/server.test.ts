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
let releaseCalls: Array<[string, string]> = []

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY

mock.module('@loora/db', () => ({
  db: {
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        orderBy: () => query,
        limit: async () => [],
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

mock.module('@loora/auth/billing', () => ({
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

mock.module('@loora/auth/billing-usage', () => ({
  flushPendingPolarUsage: async () => flushAllowed,
  reportPolarUsage: async () => true,
}))

mock.module('@loora/auth/credit-top-ups', () => ({
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

function chatRequest(model = 'mini') {
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
  if (originalOpenRouterApiKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey
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
    releaseCalls = []
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
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

  it('preserves the managed-AI trial gate', async () => {
    signedIn = true
    managedAiAccess = false

    const response = await handleAgentChatRequest(chatRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TRIAL_CHATGPT_REQUIRED' })
  })

  it('preserves provider configuration and ChatGPT availability errors', async () => {
    signedIn = true
    delete process.env.OPENROUTER_API_KEY
    const missingKey = await handleAgentChatRequest(chatRequest())
    expect(missingKey.status).toBe(503)
    expect(await missingKey.json()).toEqual({
      error: 'OpenRouter is not configured. Set OPENROUTER_API_KEY on the server.',
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
  })

  it('rejects lease conflicts before consuming credits', async () => {
    signedIn = true
    billingSource = 'cache'

    const response = await handleAgentChatRequest(chatRequest('max'))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'AI_GENERATION_IN_PROGRESS' })
    expect(releaseCalls).toEqual([])
  })

  it('releases the lease when pending billing delivery fails', async () => {
    signedIn = true
    billingSource = 'cache'
    generationLease = 'lease-one'
    flushAllowed = false

    const response = await handleAgentChatRequest(chatRequest('max'))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'BILLING_TEMPORARILY_UNAVAILABLE' })
    expect(releaseCalls).toEqual([['user-one', 'lease-one']])
  })

  it('releases the lease when credits are exhausted', async () => {
    signedIn = true
    billingSource = 'cache'
    generationLease = 'lease-one'
    meterBalance = 0

    const response = await handleAgentChatRequest(chatRequest('max'))

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'AI_CREDITS_EXHAUSTED' })
    expect(releaseCalls).toEqual([['user-one', 'lease-one']])
  })

  it('keeps the free Mini model outside subscriber credit accounting', async () => {
    signedIn = true
    billingSource = 'cache'

    const response = await handleAgentChatRequest(chatRequest('mini'))

    expect(response.status).toBe(200)
    expect(releaseCalls).toEqual([])
  })
})
