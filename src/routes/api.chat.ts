import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { z } from 'zod'
import type { CanvasElement } from '#/lib/canvas'
import { getModel, getProvider, MODELS } from '#/lib/models'
import {
  modelSupportsImageInput,
  withoutImageParts,
} from '#/lib/ai-image-inputs'
import { checkLimits, recordUsage } from '#/lib/ai-limits'
import { requireSession } from '#/lib/auth'
import { DESIGN_SKILL_PROMPT } from '#/skills/design-skills'
import { desc, eq } from 'drizzle-orm'
import { db } from '#/db'
import { asset } from '#/db/schema'

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
      'The element content: either plain HTML (Tailwind classes, <style> blocks, inline <script> all work), or JSX defining function App (React hooks like useState work; imports/exports are stripped at runtime). Renders in a sandboxed document sized exactly w×h.',
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

function messagesForModel(messages: UIMessage[], imageInputsEnabled: boolean): UIMessage[] {
  return withoutImageParts(messages, imageInputsEnabled).flatMap((message) => {
    const parts = message.parts.filter((part) => {
      if (part.type === 'tool-loadSkill' || part.type === 'step-start') return false
      if (part.type === 'text' || part.type === 'reasoning') {
        return 'text' in part && typeof part.text === 'string' && part.text.trim().length > 0
      }
      return true
    })
    return parts.length > 0 ? [{ ...message, parts }] : []
  })
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (!session) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { messages, shapes, selectedIds, model: modelKey, forceCanvasAction } = (await request.json()) as {
          messages: UIMessage[]
          shapes: CanvasElement[]
          selectedIds?: string[]
          model?: string
          forceCanvasAction?: boolean
        }

        const modelConfig = getModel(modelKey ?? '')
        const providerConfig = getProvider(modelConfig.provider)
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
        const key = modelConfig.id
        const model = provider(modelConfig.modelId)
        const imageInputsEnabled = modelSupportsImageInput(key)

        const limitError = await checkLimits(session.user.id)
        if (limitError) {
          return Response.json({ error: limitError }, { status: 429 })
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
                'Add one element to the canvas. An element is a positioned box of code — a heading, an image, a card, a full page section, or an interactive React widget. Returns the created element with its id.',
              inputSchema: newElementSchema,
            },
            createElements: {
              description:
                'Add several elements in one call. Prefer this over repeated createElement when adding more than one element. Returns the created elements with their ids.',
              inputSchema: z.object({ elements: z.array(newElementSchema).min(1).max(40) }),
            },
            updateElement: {
              description:
                'Update an existing element by id. When changing code, send the complete new code, not a diff.',
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
            'Element code is either plain HTML or JSX. Plain HTML is the default for anything static: headings, paragraphs, images, cards, full page sections. Tailwind v3 utility classes work everywhere; add a <style> block or inline styles for anything beyond utilities; inline <script> tags run too. Write JSX defining function App only when the user wants working interactivity (forms, toggles, counters, mini apps): hooks like useState/useEffect work, imports/exports are stripped at runtime, prefer onClick/onChange over <form> submit, no external npm libraries.',
            'Each element renders in its own isolated sandboxed document sized exactly w×h with a transparent background — give sections an explicit background class (e.g. bg-white) and design at real widths (375 wide for mobile screens, 1280-1440 for desktop pages).',
            'Granularity: one cohesive thing per element. A landing page is usually ONE element (a full-page section stack) — or a few section elements stacked vertically when the user wants to rearrange sections. A logo, a headline, or a screenshot placed beside it are their own elements. Do not shred a design into dozens of absolutely positioned fragments.',
            'Always emit name, x, y, w, h before code (the canvas shows a live preview while code streams). Update an element by sending its complete new code via updateElement — never a diff or fragment.',
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
            'Current canvas elements (JSON):',
            JSON.stringify(shapes ?? []),
            selectedIds?.length
              ? `The user currently has these element ids selected: ${JSON.stringify(selectedIds)}. When the request says "this", "these", or "the selected", it refers to those elements.`
              : '',
            'Comment pins: a user message may end with a "Canvas comment pinned to:" block. It names the target element id plus a pin position as percentages inside that element\'s box. Locate what sits at that spot in the element\'s code (and in the canvas snapshot), change only what the comment asks, and send the complete updated code via updateElement. Do not touch other elements.',
          ].join('\n'),
          messages: await convertToModelMessages(
            messagesForModel(messages, imageInputsEnabled),
            { tools },
          ),
          stopWhen: stepCountIs(10),
          tools,
          // Design tasks (multi-shape layouts, components) routinely need >60s; a short abort
          // surfaces to the client as an empty successful stream and trips empty-response retries.
          abortSignal: AbortSignal.timeout(180_000),
          onError: ({ error }) => console.error('[chat] stream error:', error),
          onFinish: async ({ totalUsage }) => {
            try {
              await recordUsage(
                session.user.id,
                key,
                totalUsage.inputTokens ?? 0,
                totalUsage.outputTokens ?? 0,
              )
            } catch (error) {
              console.error('[chat] Failed to record usage:', error)
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
