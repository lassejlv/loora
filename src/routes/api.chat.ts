import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { z } from 'zod'
import type { Shape } from '#/lib/canvas'
import { DEFAULT_MODEL, type ModelKey } from '#/lib/models'
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

const shapePatch = {
  x: z.number().describe('left edge in canvas units'),
  y: z.number().describe('top edge in canvas units'),
  w: z.number().min(1).describe('width'),
  h: z.number().min(1).describe('height'),
  fill: z.string().describe('CSS color, e.g. #2440e6'),
  stroke: z.string().describe('border color; omit for no border'),
  strokeWidth: z.number().min(0).describe('border width in px, default 1'),
  radius: z.number().min(0).describe('corner radius in px (rect and frame only)'),
  opacity: z.number().min(0).max(1).describe('0-1, default 1'),
  text: z.string().describe('text content, or the frame name for frames'),
  fontSize: z.number().describe('font size in px (text shapes only)'),
  fontWeight: z
    .number()
    .describe('font weight for text shapes: 400, 500, 600, or 700 (default 400)'),
  align: z.enum(['left', 'center', 'right']).describe('text alignment within the box (text shapes only)'),
  html: z
    .string()
    .max(200_000)
    .describe(
      'frame shapes only: full HTML body rendered inside the frame. Tailwind v3 classes work; a <style> block and inline styles also work. Scripts are stripped.',
    ),
}

const newShapeSchema = z.object({
  type: z.enum(['rect', 'ellipse', 'text', 'frame', 'image']),
  x: shapePatch.x,
  y: shapePatch.y,
  w: shapePatch.w,
  h: shapePatch.h,
  fill: shapePatch.fill,
  stroke: shapePatch.stroke.optional(),
  strokeWidth: shapePatch.strokeWidth.optional(),
  radius: shapePatch.radius.optional(),
  opacity: shapePatch.opacity.optional(),
  text: shapePatch.text.optional(),
  fontSize: shapePatch.fontSize.optional(),
  fontWeight: shapePatch.fontWeight.optional(),
  align: shapePatch.align.optional(),
  html: shapePatch.html.optional(),
  src: z
    .string()
    .optional()
    .describe('image shapes only: the asset URL, e.g. /api/asset/{id} from the Assets list'),
})

const componentCodeSchema = z
  .string()
  .max(100_000)
  .describe(
    'Self-contained JSX defining App (function App or export default function App). Normal React idioms are fine: import { useState } from "react" and export default are stripped at runtime. Hooks and onClick/onChange work; prefer those over <form> submit. Tailwind utilities work. No external npm libraries.',
  )

// Server-only mapping; never send these ids to the client.
const WAFER_MODEL_IDS: Record<ModelKey, string> = {
  mini: 'MiniMax-M3',
  max: 'GLM-5.2',
  'max-fast': 'glm5.2-fast',
}

// Errors from the provider can echo the real model id; scrub before it reaches the client.
function sanitizeModelNames(text: string): string {
  let out = text
  for (const [key, id] of Object.entries(WAFER_MODEL_IDS)) {
    out = out.split(id).join(key)
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
          shapes: Shape[]
          selectedIds?: string[]
          model?: string
          forceCanvasAction?: boolean
        }

        const apiKey = process.env.WAFER_API_KEY
        if (!apiKey) {
          return Response.json(
            { error: 'Wafer is not configured on the server.' },
            { status: 503 },
          )
        }
        const wafer = createOpenAICompatible({
          name: 'wafer',
          baseURL: 'https://pass.wafer.ai/v1',
          apiKey,
        })
        const key: ModelKey =
          modelKey && modelKey in WAFER_MODEL_IDS ? (modelKey as ModelKey) : DEFAULT_MODEL
        const model = wafer(WAFER_MODEL_IDS[key])
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
            createShape: {
              description: 'Add a single shape to the canvas. Returns the created shape with its id.',
              inputSchema: newShapeSchema,
            },
            createShapes: {
              description:
                'Add many shapes to the canvas in one call. Always prefer this over repeated createShape when adding more than one shape. Prefer this for marketing sites, landing pages, and wireframes (frames + rects + text). Returns the created shapes with their ids.',
              inputSchema: z.object({ shapes: z.array(newShapeSchema).min(1).max(100) }),
            },
            updateShape: {
              description: 'Update properties of an existing shape by id.',
              inputSchema: z.object({
                id: z.string(),
                x: shapePatch.x.optional(),
                y: shapePatch.y.optional(),
                w: shapePatch.w.optional(),
                h: shapePatch.h.optional(),
                fill: shapePatch.fill.optional(),
                stroke: shapePatch.stroke.optional(),
                strokeWidth: shapePatch.strokeWidth.optional(),
                radius: shapePatch.radius.optional(),
                opacity: shapePatch.opacity.optional(),
                text: shapePatch.text.optional(),
                fontSize: shapePatch.fontSize.optional(),
                fontWeight: shapePatch.fontWeight.optional(),
                align: shapePatch.align.optional(),
                html: shapePatch.html.optional(),
              }),
            },
            deleteShape: {
              description:
                'Remove a shape from the canvas by id. The user is asked to confirm each deletion and may decline.',
              inputSchema: z.object({ id: z.string() }),
            },
            viewCanvas: {
              description: imageInputsEnabled
                ? 'Render the current canvas to an image and look at it. Call this after finishing edits for a design task to verify the result, then fix any problems you see.'
                : 'Canvas image viewing is temporarily unavailable. Use the current canvas shapes JSON instead.',
              // Non-empty schema: some providers reject function declarations with zero properties.
              inputSchema: z.object({
                focus: z.string().optional().describe('what you are checking, e.g. "spacing of the header"'),
              }),
              toModelOutput: ({ output }: { output: { image?: string; empty?: boolean } }) => {
                if (!imageInputsEnabled) {
                  return {
                    type: 'text' as const,
                    value: 'Canvas image viewing is temporarily disabled. Use the current canvas shapes JSON.',
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
            createComponent: {
              description:
                'Add a live interactive React component (forms, toggles, charts, mini apps). Only when the user explicitly wants working interactivity — not for ordinary websites, landing pages, or mockups (use createShapes for those). Code must define App; imports/exports are OK (stripped at runtime). Returns the created shape id.',
              inputSchema: z.object({
                name: z.string().describe('short human label, e.g. "Signup form"'),
                code: componentCodeSchema,
                x: shapePatch.x,
                y: shapePatch.y,
                w: shapePatch.w,
                h: shapePatch.h,
              }),
            },
            updateComponent: {
              description:
                'Replace the code (and optionally name or bounds) of an existing component shape by id. Send the complete new code, not a diff.',
              inputSchema: z.object({
                id: z.string(),
                code: componentCodeSchema.optional(),
                name: z.string().optional(),
                x: shapePatch.x.optional(),
                y: shapePatch.y.optional(),
                w: shapePatch.w.optional(),
                h: shapePatch.h.optional(),
              }),
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
            'Never delete or overwrite existing shapes unless the user asked for exactly that. When a request is ambiguous, use the askQuestion tool instead of guessing.',
            'Make the minimal set of changes that fulfills the request - no extra decoration, no unrequested layouts.',
            DESIGN_SKILL_PROMPT,
            'You manipulate the canvas only through tools. Shapes are rect, ellipse, text, or frame.',
            'Frames are artboards: white containers that render behind other shapes. Design inside a frame when one exists (or create one for a screen/page design, e.g. 375x812 mobile or 1440x900 desktop). The frame name lives in its "text" field.',
            'Frames can carry a full HTML body via the "html" field: real HTML rendered live inside the frame. THIS IS THE PREFERRED WAY to build websites, landing pages, app screens, and rich mockups — one frame with html beats dozens of positioned shapes. Tailwind v3 utility classes work; add a <style> block or inline styles for anything beyond utilities. Scripts are stripped. The body renders in an isolated scope sized to the frame, so design mobile frames at mobile widths and desktop frames at desktop widths. Images: only asset URLs from the Assets list, as <img src="/api/asset/...">. Update a design by sending the complete new html via updateShape.',
            'Shapes support stroke (border color + strokeWidth), radius (rounded corners on rect/frame), and opacity (0-1). Use them: a rect with radius 8 and a subtle stroke reads as a button or card.',
            imageInputsEnabled
              ? 'The user message may include a PNG snapshot of the current canvas. Use it to judge layout, overlap, and balance before and after your edits.'
              : 'Image input is temporarily disabled. Rely on the current canvas shapes JSON and do not call viewCanvas.',
            'Coordinates: x/y is the top-left corner, y grows downward. The visible canvas is roughly 1200x800 around the origin.',
            'Palette to prefer: #1a1917 ink, #ffffff white, #2440e6 ultramarine, #e8442e vermilion, #f5c518 yellow, #23a25d green. Other CSS colors are allowed when asked.',
            'Text shapes render at fontSize (default 20) with fontWeight (400-700) and align (left/center/right), in the fill color. Text wraps at the box width w and supports newlines - size the box for the content. Use weight and size for hierarchy: e.g. 32/700 titles, 14/400 body.',
            'When laying out multiple shapes, space them deliberately - aligned edges, consistent gaps. Use createShapes (batch) to add them all in one call.',
            'For websites, landing pages, and visual mockups: create a frame with an "html" body. Use loose shapes (rect/ellipse/text) only for freeform diagrams, wireframe scribbles, or annotations around frames. Do not use createComponent unless the user explicitly asks for a working interactive widget.',
            'Interactive components: createComponent adds a live React component in a sandboxed iframe. Self-contained JSX defining App (function App or export default function App). Normal React idioms work: import { useState } from "react" and export default are stripped at runtime; hooks and onClick/onChange work; prefer those over <form> submit. Tailwind utilities work inside components; no external npm libraries. Keep code under ~200 lines. Users double-click the component on the canvas to try interactions. Components render live in canvas snapshots, so viewCanvas verifies them too.',
            'Image shapes place uploaded assets: type "image" with src set to an asset URL from the Assets list below. Never invent asset URLs; if no fitting asset exists, say so or use styled shapes instead.',
            '',
            'Assets available (JSON):',
            JSON.stringify(assets.map((a) => ({ name: a.name, mediaType: a.mediaType, src: `/api/asset/${a.id}` }))),
            imageInputsEnabled
              ? 'Verify loop: after finishing the edits for a design task, call viewCanvas to see the actual result. If you spot problems (overlap, misalignment, cramped spacing, poor contrast), fix them and check again. Skip verification for trivial single-shape edits.'
              : 'Canvas image verification is temporarily disabled. Do not call viewCanvas.',
            'Keep replies to one or two short sentences; the user sees the canvas change live.',
            '',
            'Current canvas shapes (JSON):',
            JSON.stringify(shapes ?? []),
            selectedIds?.length
              ? `The user currently has these shape ids selected: ${JSON.stringify(selectedIds)}. When the request says "this", "these", or "the selected", it refers to those shapes.`
              : '',
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
