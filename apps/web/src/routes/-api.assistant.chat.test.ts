import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { McpUsageController } from '@loora/rpc/mcp-server'

const reserve = vi.fn()
const current = vi.fn()
const createLooraToolExecutor = vi.fn()
let executorUsage: McpUsageController | undefined

const usage = {
  metric: 'mcp_tool_calls' as const,
  plan: 'free' as const,
  included: 100,
  used: 1,
  remaining: 99,
  periodStart: '2026-08-03T00:00:00.000Z',
  resetsAt: '2026-08-10T00:00:00.000Z',
}

vi.doMock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
}))
vi.doMock('@loora/auth', () => ({
  requireSession: vi.fn().mockResolvedValue({
    user: { id: 'user-1', email: 'user@example.com', isAdmin: true },
  }),
}))
vi.doMock('@loora/auth/chatgpt', () => ({
  chatgptEnabled: true,
  chatgptAuth: {
    getSession: vi.fn().mockResolvedValue({ status: 'authenticated' }),
    getModels: vi.fn().mockResolvedValue(['gpt-5.6-sol']),
    proxyFetch: vi.fn(() => fetch),
  },
}))
vi.doMock('@loora/db/design-access', () => ({
  resolveDesignAccess: vi.fn().mockResolvedValue({ role: 'owner' }),
}))
vi.doMock('@loora/assistant/agent', () => ({
  assistantStreamResponse: vi.fn().mockResolvedValue(new Response('ok')),
}))
vi.doMock('@loora/assistant/model', () => ({
  assistantModel: vi.fn(() => ({})),
  selectAssistantModel: vi.fn(() => 'gpt-5.6-sol'),
}))
vi.doMock('@loora/assistant/system-prompt', () => ({
  assistantSystemPrompt: vi.fn(() => 'system'),
}))
vi.doMock('@loora/assistant/tools', () => ({
  createAssistantTools: vi.fn(() => ({})),
}))
vi.doMock('@loora/assistant/protocol', () => ({
  chatGptModel: vi.fn(() => undefined),
  chatGptReasoningEffort: vi.fn(() => undefined),
  DEFAULT_CHATGPT_REASONING_EFFORT: 'high',
}))
vi.doMock('@loora/rpc/assistant', () => ({
  ensureAssistantThread: vi.fn().mockResolvedValue('thread-1'),
  assistantTargetNames: vi.fn().mockResolvedValue({
    designName: 'Design',
    branchName: null,
  }),
  saveAssistantMessages: vi.fn().mockResolvedValue(undefined),
}))
vi.doMock('@loora/railway', () => ({
  isInAppAgentEnabled: vi.fn().mockResolvedValue(true),
}))
vi.doMock('@loora/rpc/mcp-access', () => ({
  AccessDeniedError: class AccessDeniedError extends Error {},
  requireAppAccess: vi.fn().mockResolvedValue({
    mcpPlan: 'free',
    mcpUsageOptions: {},
  }),
}))
vi.doMock('@loora/rpc/mcp-server', () => ({
  createLooraToolExecutor: (...args: unknown[]) =>
    createLooraToolExecutor(...args),
}))
vi.doMock('@loora/rpc/mcp-usage', () => ({
  createMcpUsageController: vi.fn(() => ({ current, reserve })),
}))
vi.doMock('@loora/rpc/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
  rateLimits: { assistant: {} },
  tooManyRequestsResponse: vi.fn(),
}))

const { assistantChatResponse } = await import('./api.assistant.chat')

function request(messages: Array<{ id: string; role: 'user' | 'assistant' }>) {
  return new Request('http://localhost/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({
      id: 'thread-1',
      designId: 'design-1',
      messages: messages.map((message) => ({ ...message, parts: [] })),
    }),
  })
}

describe('assistantChatResponse usage', () => {
  beforeEach(() => {
    reserve.mockReset().mockResolvedValue(usage)
    current.mockReset().mockResolvedValue(usage)
    executorUsage = undefined
    createLooraToolExecutor.mockReset().mockImplementation(
      (_userId: string, controller: McpUsageController) => {
        executorUsage = controller
        return vi.fn()
      },
    )
  })

  test('charges once for a user message and reuses it for every tool', async () => {
    const response = await assistantChatResponse(
      request([{ id: 'user-message-1', role: 'user' }]),
    )

    expect(response.status).toBe(200)
    expect(reserve).toHaveBeenCalledTimes(1)
    await executorUsage?.reserve()
    await executorUsage?.reserve()
    expect(reserve).toHaveBeenCalledTimes(1)
  })

  test('does not charge again when an approval continues the same message', async () => {
    const response = await assistantChatResponse(
      request([
        { id: 'user-message-1', role: 'user' },
        { id: 'assistant-message-1', role: 'assistant' },
      ]),
    )

    expect(response.status).toBe(200)
    expect(current).toHaveBeenCalledTimes(1)
    expect(reserve).not.toHaveBeenCalled()
    await executorUsage?.reserve()
    expect(reserve).not.toHaveBeenCalled()
  })
})
