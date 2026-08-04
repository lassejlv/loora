import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import type { UIMessage } from 'ai'
import { requireSession } from '@loora/auth'
import {
  ChatGptError,
  chatgptEnabled,
  resolveChatGptCredentials,
} from '@loora/auth/chatgpt'
import { resolveDesignAccess } from '@loora/db/design-access'
import { assistantStreamResponse } from '@loora/assistant/agent'
import { assistantModel } from '@loora/assistant/model'
import { assistantSystemPrompt } from '@loora/assistant/system-prompt'
import { createAssistantTools } from '@loora/assistant/tools'
import type { AssistantErrorBody } from '@loora/assistant/protocol'
import {
  assistantTargetNames,
  ensureAssistantThread,
  saveAssistantMessages,
  type StoredAssistantMessage,
} from '@loora/rpc/assistant'
import { isInAppAgentEnabled } from '@loora/railway'
import { AccessDeniedError, requireAppAccess } from '@loora/rpc/mcp-access'
import { createLooraToolExecutor } from '@loora/rpc/mcp-server'
import { createAgentUsageController } from '@loora/rpc/mcp-usage'
import { McpUsageLimitError } from '@loora/billing/mcp-usage'
import {
  rateLimit,
  rateLimits,
  tooManyRequestsResponse,
} from '@loora/rpc/rate-limit'

/**
 * The in-app agent's one streaming endpoint.
 *
 * It owns no canvas logic. Every mutation goes down `createLooraToolExecutor`,
 * the same path the remote MCP transport takes, so the editor's agent ring,
 * the transaction log, the plan limits and the usage meter all behave as they
 * already do — the only new thing here is who is driving.
 */

/** A thread is windowed on read; this is the ceiling on what a client may post. */
const MAX_MESSAGES = 200
const MAX_BODY_BYTES = 1_000_000

interface ChatRequestBody {
  id?: string
  messages?: UIMessage[]
  designId?: string
  draftId?: string | null
  selection?: string[]
}

function failure(body: AssistantErrorBody, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function storable(messages: UIMessage[]): StoredAssistantMessage[] {
  return messages
    .filter(
      (message) => message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({
      id: message.id,
      role: message.role as 'user' | 'assistant',
      parts: (message.parts ?? []) as unknown[],
    }))
}

export async function assistantChatResponse(request: Request) {
  const session = await requireSession(request)
  if (!session) {
    return failure({ error: 'Sign in to use the agent.', code: 'ACCESS_DENIED' }, 401)
  }

  const decision = await rateLimit(
    'assistant',
    `user:${session.user.id}`,
    rateLimits.assistant,
  )
  if (!decision.ok) return tooManyRequestsResponse(decision)

  // The flag decides before anything else does. An account outside it never
  // sees the chat box, so reaching here means somebody went around the UI.
  if (!(await isInAppAgentEnabled(session.user))) {
    return failure(
      { error: 'The agent is not available.', code: 'ACCESS_DENIED' },
      403,
    )
  }

  if (!chatgptEnabled) {
    return failure(
      {
        error: 'ChatGPT sign-in is not configured on this server.',
        code: 'CHATGPT_NOT_CONFIGURED',
      },
      503,
    )
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return failure(
      { error: 'This conversation is too large to send.', code: 'ACCESS_DENIED' },
      413,
    )
  }
  let body: ChatRequestBody
  try {
    body = JSON.parse(raw) as ChatRequestBody
  } catch {
    return failure({ error: 'Invalid request body.', code: 'ACCESS_DENIED' }, 400)
  }

  const designId = body.designId?.trim()
  const draftId = body.draftId?.trim() || null
  const messages = Array.isArray(body.messages) ? body.messages : []
  if (!designId || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return failure({ error: 'Nothing to run.', code: 'ACCESS_DENIED' }, 400)
  }

  // The plan gate first: it is one query, and it decides whether any of the
  // work below is worth doing.
  let access: Awaited<ReturnType<typeof requireAppAccess>>
  try {
    access = await requireAppAccess(session.user.id)
  } catch (error) {
    return failure(
      {
        error:
          error instanceof AccessDeniedError
            ? error.message
            : 'The agent is unavailable.',
        code: 'ACCESS_DENIED',
      },
      403,
    )
  }

  // Owner-only, because the canvas target lookup underneath the tools is.
  const designAccess = await resolveDesignAccess(designId, {
    id: session.user.id,
    email: session.user.email,
  })
  if (!designAccess || designAccess.role !== 'owner') {
    return failure(
      { error: 'The agent works on designs you own.', code: 'ACCESS_DENIED' },
      403,
    )
  }

  let credentials
  try {
    credentials = await resolveChatGptCredentials(session.user.id)
  } catch (error) {
    if (error instanceof ChatGptError) {
      return failure(
        {
          error: error.message,
          code:
            error.code === 'NOT_CONNECTED'
              ? 'CHATGPT_NOT_CONNECTED'
              : error.code === 'RECONNECT_REQUIRED'
                ? 'CHATGPT_RECONNECT_REQUIRED'
                : error.code === 'NOT_CONFIGURED'
                  ? 'CHATGPT_NOT_CONFIGURED'
                  : 'PROVIDER_ERROR',
        },
        error.code === 'NOT_CONNECTED' ? 428 : 401,
      )
    }
    throw error
  }

  const target = { designId, draftId }
  const [threadId, names] = await Promise.all([
    ensureAssistantThread(session.user.id, target, body.id),
    assistantTargetNames(session.user.id, target),
  ])

  // The agent's own meter, separate from MCP: a week of agent work never eats
  // into what an external MCP client is allowed, and the reverse.
  const usage = createAgentUsageController(
    session.user.id,
    access.mcpPlan,
    access.agentUsageOptions,
  )
  try {
    const current = await usage.current()
    if (current.remaining === 0) throw new McpUsageLimitError(current)
  } catch (error) {
    // Only a hard "you are out" stops the run here. A metering outage is the
    // executor's problem to report per call, not a reason to refuse to start.
    if (error instanceof McpUsageLimitError) {
      return failure({ error: error.message, code: 'RATE_LIMITED' }, 429)
    }
  }

  const execute = createLooraToolExecutor(
    session.user.id,
    usage,
    async () => (await requireAppAccess(session.user.id)).mcpPlan,
  )
  const tools = createAssistantTools({ execute, target })

  // Persist what was sent before the first token: a run that dies mid-stream
  // still leaves the question in the thread.
  await saveAssistantMessages(threadId, storable(messages))

  return assistantStreamResponse({
    model: assistantModel(credentials),
    system: assistantSystemPrompt({
      ...target,
      designName: names.designName,
      branchName: names.branchName,
      selection: Array.isArray(body.selection)
        ? body.selection.slice(0, 20).filter((id) => typeof id === 'string')
        : undefined,
      imageInputs: true,
    }),
    messages,
    tools,
    abortSignal: request.signal,
    generateMessageId: () => `amsg_${globalThis.crypto.randomUUID()}`,
    onEnd: async ({ messages: finished }) => {
      await saveAssistantMessages(threadId, storable(finished))
    },
  })
}

export const Route = createFileRoute('/api/assistant/chat')({
  server: {
    handlers: {
      POST: ({ request }) => assistantChatResponse(request),
    },
  },
})
