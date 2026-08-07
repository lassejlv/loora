import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const conflict = vi.fn()
const values = vi.fn(() => ({ onConflictDoUpdate: conflict }))
const insert = vi.fn(() => ({ values }))
const where = vi.fn().mockResolvedValue(undefined)
const set = vi.fn(() => ({ where }))
const update = vi.fn(() => ({ set }))

vi.mock('@loora/db', () => ({ db: { insert, update } }))
vi.mock('@loora/auth/chatgpt', () => ({
  chatgptAuth: {},
  chatgptEnabled: false,
}))
vi.mock('@loora/assistant/model', () => ({ assistantModelId: () => 'test' }))
vi.mock('@loora/railway', () => ({ isInAppAgentEnabled: () => false }))
vi.mock('./procedures', () => {
  const protectedProcedure = {
    handler: (handler: unknown) => handler,
    input: () => protectedProcedure,
  }
  return { protectedProcedure, requireDesignAccess: vi.fn() }
})

describe('saveAssistantMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    conflict.mockResolvedValue(undefined)
  })

  it('scopes a retry update to the authorized thread', async () => {
    const { saveAssistantMessages } = await import('./assistant')

    await saveAssistantMessages('thread-a', [
      { id: 'message-a', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
    ])

    const configuration = conflict.mock.calls[0]?.[0]
    expect(configuration?.setWhere).toBeDefined()
    expect(new PgDialect().sqlToQuery(configuration.setWhere)).toMatchObject({
      sql: '"assistant_message"."thread_id" = $1',
      params: ['thread-a'],
    })
  })
})
