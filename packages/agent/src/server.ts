import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createChatGPTProxyProvider } from '@opencoredev/loginwithchatgpt-ai'
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  UI_MESSAGE_STREAM_HEADERS,
  type UIMessage,
} from 'ai'
import type { CanvasElement } from '@loora/db/canvas'
import {
  getChatGPTReasoningEffort,
  getModel,
  getProvider,
} from './models'
import {
  messagesForModel,
  modelSupportsImageInput,
  sanitizeModelNames,
} from './messages'
import { createAgentBaseTools } from './tools'
import {
  checkLimits,
  recordSubscriberUsage,
  recordUsage,
} from './usage'
import { flushPendingPolarUsage } from '@loora/auth/billing-usage'
import { requireSession } from '@loora/auth'
import {
  acquireGenerationLease,
  authorizeBilling,
  refreshEntitlement,
  releaseGenerationLease,
  subscriptionRequiredResponse,
} from '@loora/auth/billing'
import { remainingCredits, usesPolarCredits } from '@loora/auth/billing-policy'
import { getTopUpCreditStatus } from '@loora/auth/credit-top-ups'
import { canUseApp, previewAccessRequiredResponse } from '@loora/auth/preview-access'
import { buildAgentSystemPrompt } from './prompts'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, designChat, userPreferences } from '@loora/db/schema'
import { chatgptAuth } from './internal/chatgpt-auth'
import { getGitHubStatus } from '@loora/auth/github'
import { createGenerationUsageAccounting } from './internal/usage-accounting'
import {
  clearActiveStream,
  getActiveStream,
  getStreamContext,
  setActiveStream,
} from './internal/resume'

export async function handleAgentChatGPTRequest(request: Request): Promise<Response> {
  const session = await requireSession(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canUseApp(session.user)) return previewAccessRequiredResponse()
  if (!(await authorizeBilling(session.user)).access) return subscriptionRequiredResponse()
  return chatgptAuth.handler(request)
}

export async function handleAgentChatRequest(request: Request): Promise<Response> {
  const session = await requireSession(request)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canUseApp(session.user)) return previewAccessRequiredResponse()
  const billing = await authorizeBilling(session.user)
  if (!billing.access) return subscriptionRequiredResponse()

  let agentSystemPrompt = ''
  try {
    const [preferences] = await db
      .select({ agentSystemPrompt: userPreferences.agentSystemPrompt })
      .from(userPreferences)
      .where(eq(userPreferences.userId, session.user.id))
      .limit(1)
    agentSystemPrompt = preferences?.agentSystemPrompt ?? ''
  } catch (error) {
    console.error('[chat] Failed to load custom agent instructions:', error)
  }

  const {
    messages,
    shapes,
    selectedIds,
    designId,
    chatId,
    model: modelKey,
    reasoningEffort: requestedReasoningEffort,
    forceCanvasAction,
  } = (await request.json()) as {
    messages: UIMessage[]
    shapes: CanvasElement[]
    selectedIds?: string[]
    designId?: string
    chatId?: string
    model?: string
    reasoningEffort?: string
    forceCanvasAction?: boolean
  }
  if (!designId || !chatId) {
    return Response.json({ error: 'A design and chat are required.' }, { status: 400 })
  }

  let githubConnected = false
  try {
    const github = await getGitHubStatus(session.user.id)
    githubConnected = github.enabled && github.connected
  } catch {
    // GitHub being temporarily unavailable should not block normal canvas work.
  }

  const modelConfig = getModel(modelKey ?? '')
  const providerConfig = getProvider(modelConfig.provider)
  const key = modelConfig.id
  const usingChatGPT = providerConfig.kind === 'chatgpt'
  const reasoningEffort = getChatGPTReasoningEffort(requestedReasoningEffort)
  if (!usingChatGPT && !billing.managedAiAccess) {
    return Response.json(
      {
        error: 'Managed AI is unavailable during the Pro trial. Connect ChatGPT in Settings to use AI.',
        code: 'TRIAL_CHATGPT_REQUIRED',
      },
      { status: 403 },
    )
  }
  let model

  if (usingChatGPT) {
    const availableModels = await chatgptAuth.getModels(request)
    if (!availableModels) {
      return Response.json(
        { error: 'Connect ChatGPT in Settings before using this model.' },
        { status: 401 },
      )
    }
    if (!availableModels.includes(modelConfig.modelId)) {
      return Response.json(
        { error: `${modelConfig.label} is not available on this ChatGPT account.` },
        { status: 403 },
      )
    }
    const provider = createChatGPTProxyProvider({
      fetch: chatgptAuth.proxyFetch(request),
      defaultModel: modelConfig.modelId,
    })
    model = provider(modelConfig.modelId)
  } else {
    const apiKey = process.env[providerConfig.apiKeyEnv]
    if (!apiKey) {
      return Response.json(
        {
          error: `${providerConfig.label} is not configured. Set ${providerConfig.apiKeyEnv} on the server.`,
        },
        { status: 503 },
      )
    }
    const provider = createOpenAICompatible({
      name: modelConfig.provider,
      baseURL: providerConfig.baseURL,
      apiKey,
      headers: providerConfig.headers,
      includeUsage: providerConfig.includeUsage,
    })
    model = provider(modelConfig.modelId)
  }
  const imageInputsEnabled = modelSupportsImageInput(key)
  const providerOptions = usingChatGPT
    ? { openai: { reasoningEffort } }
    : undefined
  let generationLease: string | null = null
  let includedCreditsAvailable = 0
  const subscriberFunded = usesPolarCredits(usingChatGPT, billing.source)

  if (subscriberFunded) {
    generationLease = await acquireGenerationLease(session.user.id)
    if (!generationLease) {
      return Response.json(
        { error: 'Too many AI generations are running at once. Wait for one to finish.', code: 'AI_GENERATION_IN_PROGRESS' },
        { status: 409 },
      )
    }
    if (!await flushPendingPolarUsage(session.user.id)) {
      await releaseGenerationLease(session.user.id, generationLease)
      return Response.json(
        { error: 'Billing is temporarily unavailable.', code: 'BILLING_TEMPORARILY_UNAVAILABLE' },
        { status: 503 },
      )
    }
    try {
      const live = await refreshEntitlement(session.user.id)
      includedCreditsAvailable = live ? remainingCredits(live.meterBalance) : 0
      const topUp = await getTopUpCreditStatus(session.user.id)
      if (!live || includedCreditsAvailable + topUp.remaining <= 0) {
        await releaseGenerationLease(session.user.id, generationLease)
        return Response.json(
          { error: 'AI credits are exhausted. Open Billing to review your plan.', code: 'AI_CREDITS_EXHAUSTED' },
          { status: 429 },
        )
      }
    } catch {
      await releaseGenerationLease(session.user.id, generationLease)
      return Response.json(
        { error: 'Billing is temporarily unavailable.', code: 'BILLING_TEMPORARILY_UNAVAILABLE' },
        { status: 503 },
      )
    }
  } else if (!usingChatGPT) {
    const limitError = await checkLimits(session.user.id)
    if (limitError) {
      return Response.json({ error: limitError }, { status: 429 })
    }
  }

  const usageAccounting = createGenerationUsageAccounting({
    usingChatGPT,
    subscriberFunded,
    userId: session.user.id,
    model: key,
    includedCreditsAvailable,
    generationLease,
    recordManagedUsage: recordUsage,
    recordSubscriberUsage,
    releaseGenerationLease,
  })

  let assets: { id: string; name: string; mediaType: string }[] = []
  try {
    assets = await db
      .select({ id: asset.id, name: asset.name, mediaType: asset.mediaType })
      .from(asset)
      .where(eq(asset.userId, session.user.id))
      .orderBy(desc(asset.createdAt))
      .limit(100)
  } catch (error) {
    console.error('[chat] Failed to load assets:', error)
  }

  // Shared shape for tools whose output is a PNG the model should look at.
  const tools = createAgentBaseTools({
    userId: session.user.id,
    githubConnected,
    imageInputsEnabled,
  })

  // Materialize the prompt and model messages before streamText so nothing in
  // the long-lived stream (or its onError/onFinish callbacks) captures the raw
  // request payload — multi-MB canvases and snapshot images become GC-eligible
  // as soon as this handler returns instead of living for the whole generation.
  const system = buildAgentSystemPrompt({
    customInstructions: agentSystemPrompt,
    forceCanvasAction,
    imageInputsEnabled,
    githubConnected,
    assets,
    shapes,
    selectedIds,
  })
  const modelMessages = await convertToModelMessages(
    messagesForModel(messages, imageInputsEnabled),
    { tools, ignoreIncompleteToolCalls: true },
  )

  const result = streamText({
    model,
    providerOptions,
    system,
    messages: modelMessages,
    stopWhen: stepCountIs(40),
    tools,
    // Design tasks (multi-shape layouts, components) routinely need >60s; a short abort
    // surfaces to the client as an empty successful stream and trips empty-response retries.
    abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]),
    onError: usageAccounting.onError,
    onFinish: usageAccounting.onFinish,
  })

  const streamContext = getStreamContext()
  return result.toUIMessageStreamResponse({
    onError: (error) =>
      error instanceof Error
        ? sanitizeModelNames(error.message)
        : 'The model request failed.',
    // With Redis configured, mirror the SSE stream into a resumable buffer so
    // a reloaded client can reattach via GET /api/chat/:chatId/stream. The
    // key TTL covers cleanup; a new generation for the chat overwrites it.
    ...(streamContext
      ? {
          consumeSseStream: async ({ stream }: { stream: ReadableStream<string> }) => {
            const streamId = `str_${crypto.randomUUID()}`
            try {
              await streamContext.createNewResumableStream(streamId, () => stream)
              await setActiveStream(chatId, streamId)
            } catch (error) {
              console.error('[resume] Failed to register resumable stream:', error)
            }
          },
        }
      : {}),
  })
}

// GET /api/chat/:chatId/stream — reattach to an in-flight generation after a
// reload. 204 means "nothing to resume" and the client carries on normally.
export async function handleAgentChatStreamResumeRequest(
  request: Request,
  chatId: string,
): Promise<Response> {
  const session = await requireSession(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canUseApp(session.user)) return previewAccessRequiredResponse()

  const [chat] = await db
    .select({ id: designChat.id })
    .from(designChat)
    .where(and(eq(designChat.id, chatId), eq(designChat.userId, session.user.id)))
    .limit(1)
  if (!chat) return Response.json({ error: 'Not found' }, { status: 404 })

  const streamContext = getStreamContext()
  if (!streamContext) return new Response(null, { status: 204 })
  const streamId = await getActiveStream(chatId)
  if (!streamId) return new Response(null, { status: 204 })

  const stream = await streamContext.resumeExistingStream(streamId)
  if (!stream) {
    await clearActiveStream(chatId)
    return new Response(null, { status: 204 })
  }
  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS })
}
