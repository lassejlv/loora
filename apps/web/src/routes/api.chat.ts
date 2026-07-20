import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createChatGPTProxyProvider } from '@opencoredev/loginwithchatgpt-ai'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { z } from 'zod'
import type { CanvasElement } from '#/lib/canvas'
import { getModel, getProvider, MODELS } from '@loora/auth/models'
import {
  modelSupportsImageInput,
  withoutImageParts,
} from '#/lib/ai-image-inputs'
import {
  checkLimits,
  flushPendingPolarUsage,
  recordSubscriberUsage,
  recordUsage,
} from '@loora/auth/ai-limits'
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
import { DESIGN_SKILL_PROMPT } from '#/skills/design-skills'
import { desc, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset } from '@loora/db/schema'
import { chatgptAuth } from '@loora/auth/chatgpt-auth'

type BunRuntimeRequest = Request & {
  runtime?: {
    bun?: {
      server?: {
        timeout(request: Request, seconds: number): void
      }
    }
  }
}

function allowLongRunningChatRequest(request: Request) {
  // Bun.serve defaults to 10 seconds of inactivity. A reasoning model can
  // legitimately take longer before emitting its first stream chunk.
  const bunServer = (request as BunRuntimeRequest).runtime?.bun?.server
  bunServer?.timeout(request, 0)
}

const elementFields = {
  name: z.string().max(200).describe('short layer label shown to the user, e.g. "Hero section"'),
  x: z.number().describe('left edge in canvas units'),
  y: z.number().describe('top edge in canvas units'),
  w: z.number().min(1).describe('width'),
  h: z.number().min(1).describe('height'),
  // Keep code as the LAST field so it streams last and the client can place
  // the element (from the already-parsed geometry) while code is generating.
  code: z
    .string()
    .max(200_000)
    .describe(
      'The element content: either plain HTML (Tailwind classes, <style> blocks, inline <script> all work), or JSX/TSX defining function App (React hooks like useState work; TypeScript is stripped at compile; imports/exports are stripped at runtime). Renders in a sandboxed document sized exactly w×h.',
    ),
}

const newElementSchema = z.object({
  name: elementFields.name,
  x: elementFields.x,
  y: elementFields.y,
  w: elementFields.w,
  h: elementFields.h,
  code: elementFields.code,
})

// Errors from the provider can echo the real model id; scrub before it reaches the client.
function sanitizeModelNames(text: string): string {
  let out = text
  for (const model of MODELS) {
    out = out.split(model.modelId).join(model.label)
  }
  return out
}

// How many trailing messages keep their full payloads. Everything older is
// compacted: reasoning dropped, canvas snapshots dropped, tool-call code
// truncated. Without this, a few build iterations push hundreds of KB of
// stale code and PNGs into every request until the provider rejects it.
const HISTORY_TAIL_INTACT = 3
const CODE_PREVIEW_CHARS = 200

function truncatedCode(code: string): string {
  if (code.length <= CODE_PREVIEW_CHARS + 80) return code
  return `${code.slice(0, CODE_PREVIEW_CHARS)}…[truncated, ${code.length} chars — call readElement for the current code]`
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out = { ...value }
  if (typeof out.code === 'string') out.code = truncatedCode(out.code)
  if (typeof out.image === 'string') delete out.image
  if (Array.isArray(out.edits)) {
    out.edits = out.edits.map((edit) => {
      if (!edit || typeof edit !== 'object') return edit
      const e = { ...(edit as Record<string, unknown>) }
      if (typeof e.oldCode === 'string') e.oldCode = truncatedCode(e.oldCode)
      if (typeof e.newCode === 'string') e.newCode = truncatedCode(e.newCode)
      return e
    })
  }
  if (Array.isArray(out.elements)) {
    out.elements = out.elements.map((el) =>
      el && typeof el === 'object' ? compactRecord(el as Record<string, unknown>) : el,
    )
  }
  return out
}

function compactOldToolPart(part: UIMessage['parts'][number]): UIMessage['parts'][number] {
  const p = part as unknown as {
    input?: unknown
    output?: unknown
    state?: string
  }
  const next = { ...(part as Record<string, unknown>) }
  if (p.input && typeof p.input === 'object') {
    next.input = compactRecord(p.input as Record<string, unknown>)
  }
  if (p.state === 'output-available' && p.output && typeof p.output === 'object') {
    next.output =
      part.type === 'tool-viewCanvas'
        ? { viewed: true }
        : compactRecord(p.output as Record<string, unknown>)
  }
  return next as unknown as UIMessage['parts'][number]
}

function messagesForModel(messages: UIMessage[], imageInputsEnabled: boolean): UIMessage[] {
  const kept = withoutImageParts(messages, imageInputsEnabled)
  return kept.flatMap((message, index) => {
    const old = index < kept.length - HISTORY_TAIL_INTACT
    const parts = message.parts.flatMap((part) => {
      if (part.type === 'tool-loadSkill' || part.type === 'step-start') return []
      if (old && part.type === 'file' && part.mediaType?.startsWith('image/')) return []
      if (part.type === 'text' || part.type === 'reasoning') {
        if (!('text' in part) || typeof part.text !== 'string' || part.text.trim().length === 0) {
          return []
        }
        if (old && part.type === 'reasoning') return []
        return [part]
      }
      if (old && part.type.startsWith('tool-')) return [compactOldToolPart(part)]
      return [part]
    })
    return parts.length > 0 ? [{ ...message, parts }] : []
  })
}

// The system prompt lists every element, but big code bodies are previewed —
// the agent pulls full code on demand with readElement. Keeps the request
// small no matter how large the designs grow.
function canvasForPrompt(shapes: CanvasElement[]) {
  return shapes.map((el) => ({
    id: el.id,
    name: el.name,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    code:
      el.code.length <= 1200
        ? el.code
        : `${el.code.slice(0, 400)}…[truncated — ${el.code.length} chars total; call readElement("${el.id}") before editing]`,
  }))
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        allowLongRunningChatRequest(request)

        const session = await requireSession(request)
        if (!session) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (!canUseApp(session.user)) return previewAccessRequiredResponse()
        const billing = await authorizeBilling(session.user)
        if (!billing.access) return subscriptionRequiredResponse()

        const { messages, shapes, selectedIds, model: modelKey, forceCanvasAction } = (await request.json()) as {
          messages: UIMessage[]
          shapes: CanvasElement[]
          selectedIds?: string[]
          model?: string
          forceCanvasAction?: boolean
        }

        const modelConfig = getModel(modelKey ?? '')
        const providerConfig = getProvider(modelConfig.provider)
        const key = modelConfig.id
        const usingChatGPT = providerConfig.kind === 'chatgpt'
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

        let generationLease: string | null = null
        let includedCreditsAvailable = 0
        const subscriberFunded = usesPolarCredits(usingChatGPT, billing.source)

        if (subscriberFunded) {
          generationLease = await acquireGenerationLease(session.user.id)
          if (!generationLease) {
            return Response.json(
              { error: 'Another AI generation is already running.', code: 'AI_GENERATION_IN_PROGRESS' },
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

        const tools = {
            // All tools execute on the client against canvas state.
            createElement: {
              description:
                'Add one element to the canvas. An element is a positioned box of code — a heading, an image, a card, a full page section, or an interactive React widget. Returns the created element id plus a render result: "ok", or "error: …" when the code failed to compile or crashed — fix the code with updateElement when that happens.',
              inputSchema: newElementSchema,
            },
            createElements: {
              description:
                'Add several elements in one call. Prefer this over repeated createElement when adding more than one element. Returns the created ids with per-element render results ("ok" or "error: …" — fix errors with updateElement).',
              inputSchema: z.object({ elements: z.array(newElementSchema).min(1).max(40) }),
            },
            updateElement: {
              description:
                'Update an existing element by id. When changing code, send the complete new code, not a diff — and only when you have the element\'s full current code (from this conversation or readElement). For small targeted code changes prefer editElement instead of resending everything. Returns a render result: "ok", or "error: …" you must fix.',
              inputSchema: z.object({
                id: z.string(),
                name: elementFields.name.optional(),
                x: elementFields.x.optional(),
                y: elementFields.y.optional(),
                w: elementFields.w.optional(),
                h: elementFields.h.optional(),
                code: elementFields.code.optional(),
              }),
            },
            editElement: {
              description:
                'Edit an element\'s code in place with exact search/replace edits — the cheap way to make small, targeted changes without resending the whole code. Each edit replaces oldCode (an exact substring of the current code, unique unless replaceAll) with newCode. Edits apply in order and atomically: if any oldCode is missing or ambiguous, the whole call fails and nothing changes. Only use when you have the element\'s full current code (from this conversation or readElement) — never guess oldCode from a truncated preview. For rewrites or large changes use updateElement. Returns a render result: "ok", or "error: …" you must fix.',
              inputSchema: z.object({
                id: z.string(),
                edits: z
                  .array(
                    z.object({
                      oldCode: z
                        .string()
                        .min(1)
                        .describe('exact substring of the current code; include surrounding lines to make it unique'),
                      newCode: z.string().describe('replacement text; empty string deletes oldCode'),
                      replaceAll: z
                        .boolean()
                        .optional()
                        .describe('replace every occurrence of oldCode instead of requiring a unique match'),
                    }),
                  )
                  .min(1)
                  .max(20),
              }),
            },
            readElement: {
              description:
                'Read the full current code of one element. Call this before updateElement whenever you do not already have that element\'s complete code in this conversation — canvas listings truncate long code.',
              inputSchema: z.object({ id: z.string() }),
            },
            deleteElement: {
              description:
                'Remove an element from the canvas by id. The user is asked to confirm each deletion and may decline.',
              inputSchema: z.object({ id: z.string() }),
            },
            viewCanvas: {
              description: imageInputsEnabled
                ? 'Render the current canvas to an image and look at it. Call this after finishing edits for a design task to verify the result, then fix any problems you see.'
                : 'Canvas image viewing is temporarily unavailable. Use the current canvas elements JSON instead.',
              // Non-empty schema: some providers reject function declarations with zero properties.
              inputSchema: z.object({
                focus: z.string().optional().describe('what you are checking, e.g. "spacing of the header"'),
              }),
              toModelOutput: ({ output }: { output: { image?: string; empty?: boolean } }) => {
                if (!imageInputsEnabled) {
                  return {
                    type: 'text' as const,
                    value: 'Canvas image viewing is temporarily disabled. Use the current canvas elements JSON.',
                  }
                }
                if (!output?.image) {
                  return { type: 'text' as const, value: 'The canvas is empty.' }
                }
                return {
                  type: 'content' as const,
                  value: [
                    {
                      type: 'file' as const,
                      data: { type: 'data' as const, data: output.image.split(',')[1] },
                      mediaType: 'image/png',
                    },
                  ],
                }
              },
            },
            askQuestion: {
              description:
                'Ask the user a question when a request is ambiguous or a design decision is theirs to make. Provide 2-4 short options. When a sensible default exists, include "Decide for me" as the last option and pick the default yourself if chosen.',
              inputSchema: z.object({
                question: z.string(),
                options: z.array(z.string()).min(2).max(4),
              }),
            },
        }

        const result = streamText({
          model,
          system: [
            'You are the design agent inside loora, a minimal canvas tool.',
            'Only touch the canvas when the user explicitly asks for a change. Greetings, questions, or chit-chat get a plain text reply with zero tool calls.',
            'When the user has asked for a canvas change and the requirements are known, make the change with a canvas tool in the same turn. Never say you will build, create, or update something without actually calling the tool first.',
            forceCanvasAction
              ? 'Your previous response promised a canvas change but stopped without making one. Call the appropriate canvas mutation tool now; do not reply with another promise.'
              : '',
            'Never delete or overwrite existing elements unless the user asked for exactly that. When a request is ambiguous, use the askQuestion tool instead of guessing.',
            'Make the minimal set of changes that fulfills the request - no extra decoration, no unrequested layouts.',
            DESIGN_SKILL_PROMPT,
            'You manipulate the canvas only through tools. Every canvas element is a positioned box of code: { name, x, y, w, h, code }.',
            'Element code is either plain HTML or JSX/TSX. Plain HTML is the default for anything static: headings, paragraphs, images, cards, full page sections. Tailwind v3 utility classes work everywhere; add a <style> block or inline styles for anything beyond utilities; inline <script> tags run too. Write JSX defining function App only when the user wants working interactivity (forms, toggles, counters, mini apps): hooks like useState/useEffect work, TypeScript annotations are fine (stripped at compile), imports/exports are stripped at runtime, no external npm libraries. Forms never navigate (submit is always prevented — handle it in onSubmit/onClick state) and links are inert except #hash jumps, so interactive demos are safe.',
            'Every createElement/createElements/updateElement/editElement result reports render: "ok" or "error: <message>". On an error, fix the code and update the element again — never leave an element in an error state and never claim success while a render error is unresolved.',
            'Each element renders in its own isolated sandboxed document sized exactly w×h with a transparent background — give sections an explicit background class (e.g. bg-white) and design at real widths (375 wide for mobile screens, 1280-1440 for desktop pages).',
            'Granularity: one cohesive thing per element. A landing page is usually ONE element (a full-page section stack) — or a few section elements stacked vertically when the user wants to rearrange sections. A logo, a headline, or a screenshot placed beside it are their own elements. Do not shred a design into dozens of absolutely positioned fragments.',
            'Always emit name, x, y, w, h before code (the canvas shows a live preview while code streams). To change an element\'s code: for small, targeted changes call editElement with exact oldCode/newCode search-replace edits; for rewrites or large restructures send the complete new code via updateElement — never a partial fragment through updateElement. Both require the element\'s complete current code in this conversation (the canvas listing below truncates long code with […]) — call readElement first when you do not have it; editing from a truncated preview fails or destroys the element.',
            imageInputsEnabled
              ? 'The user message may include a PNG snapshot of the current canvas. Use it to judge layout, overlap, and balance before and after your edits.'
              : 'Image input is temporarily disabled. Rely on the current canvas elements JSON and do not call viewCanvas.',
            'Coordinates: x/y is the top-left corner, y grows downward. The visible canvas is roughly 1200x800 around the origin. Leave 40-80px gaps between separate elements; align edges deliberately.',
            'Palette to prefer: #1a1917 ink, #ffffff white, #2440e6 ultramarine, #e8442e vermilion, #f5c518 yellow, #23a25d green. Other CSS colors are allowed when asked.',
            'Images: use only asset URLs from the Assets list below, as <img src="/api/asset/...">. Never invent asset URLs; if no fitting asset exists, say so or design with styled markup instead.',
            'Interactive elements render live: users press I or double-click an element to interact with it. Elements render live in canvas snapshots, so viewCanvas verifies them too.',
            '',
            'Assets available (JSON):',
            JSON.stringify(assets.map((a) => ({ name: a.name, mediaType: a.mediaType, src: `/api/asset/${a.id}` }))),
            imageInputsEnabled
              ? 'Verify loop: after finishing the edits for a design task, call viewCanvas to see the actual result. If you spot problems (overlap, misalignment, cramped spacing, poor contrast), fix them and check again. Skip verification for trivial single-shape edits.'
              : 'Canvas image verification is temporarily disabled. Do not call viewCanvas.',
            'Keep replies to one or two short sentences; the user sees the canvas change live.',
            '',
            'Current canvas elements (JSON; long code is previewed — readElement returns the full code):',
            JSON.stringify(canvasForPrompt(shapes ?? [])),
            selectedIds?.length
              ? `The user currently has these element ids selected: ${JSON.stringify(selectedIds)}. When the request says "this", "these", or "the selected", it refers to those elements.`
              : '',
            'Comment pins: a user message may end with a "Canvas comment pinned to:" block. It names the target element id plus a pin position as percentages inside that element\'s box. Locate what sits at that spot in the element\'s code (and in the canvas snapshot), change only what the comment asks, and apply it with editElement (or updateElement with complete code for larger changes). Do not touch other elements.',
          ].join('\n'),
          messages: await convertToModelMessages(
            messagesForModel(messages, imageInputsEnabled),
            { tools },
          ),
          stopWhen: stepCountIs(40),
          tools,
          // Design tasks (multi-shape layouts, components) routinely need >60s; a short abort
          // surfaces to the client as an empty successful stream and trips empty-response retries.
          abortSignal: AbortSignal.timeout(300_000),
          onError: ({ error }) => {
            console.error('[chat] stream error:', error)
            if (generationLease) {
              void releaseGenerationLease(session.user.id, generationLease)
            }
          },
          onFinish: async ({ totalUsage }) => {
            if (usingChatGPT) return
            try {
              const inputTokens = totalUsage.inputTokens ?? 0
              const outputTokens = totalUsage.outputTokens ?? 0
              if (subscriberFunded) {
                await recordSubscriberUsage(
                  session.user.id,
                  key,
                  inputTokens,
                  outputTokens,
                  includedCreditsAvailable,
                )
              } else {
                await recordUsage(session.user.id, key, inputTokens, outputTokens)
              }
            } catch (error) {
              console.error('[chat] Failed to record usage:', error)
            } finally {
              if (generationLease) {
                await releaseGenerationLease(session.user.id, generationLease)
              }
            }
          },
        })

        return result.toUIMessageStreamResponse({
          onError: (error) =>
            error instanceof Error
              ? sanitizeModelNames(error.message)
              : 'The model request failed.',
        })
      },
    },
  },
})
