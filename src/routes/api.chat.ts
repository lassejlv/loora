import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createChatGPTProxyProvider } from '@opencoredev/loginwithchatgpt-ai'
import { convertToModelMessages, stepCountIs, streamText, type LanguageModel, type UIMessage } from 'ai'
import { z } from 'zod'
import type { Shape } from '#/lib/canvas'
import { chatgptAuth } from '#/lib/chatgpt-auth'
import { CHATGPT_PREFERRED, GEMINI_MODELS } from '#/lib/models'
import { requireSession } from '#/lib/auth'
import frontendDesignSkill from '#/skills/frontend-design.md?raw'

const SKILLS = {
  'frontend-design': {
    description:
      "Anthropic's frontend design guide: distinctive palette, type, and layout choices, plus calibration against generic AI-generated looks.",
    content: frontendDesignSkill,
  },
} as const

type SkillName = keyof typeof SKILLS

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
}

const newShapeSchema = z.object({
  type: z.enum(['rect', 'ellipse', 'text', 'frame']),
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
})

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await requireSession(request))) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { messages, shapes, provider, model: requestedModel } = (await request.json()) as {
          messages: UIMessage[]
          shapes: Shape[]
          provider?: 'gemini' | 'chatgpt'
          model?: string
        }

        let model: LanguageModel
        if (provider === 'chatgpt') {
          // Model availability is per ChatGPT account - discover, then pick.
          const models = await chatgptAuth.getModels(request)
          if (!models || models.length === 0) {
            return Response.json(
              { error: 'Not signed in with ChatGPT. Connect your account in settings.' },
              { status: 401 },
            )
          }
          const slug =
            requestedModel &&
            (models.includes(requestedModel) || CHATGPT_PREFERRED.includes(requestedModel))
              ? requestedModel
              : (CHATGPT_PREFERRED.find((m) => models.includes(m)) ?? models[0])
          const chatgpt = createChatGPTProxyProvider({ fetch: chatgptAuth.proxyFetch(request) })
          model = chatgpt(slug)
        } else {
          const apiKey = request.headers.get('x-gemini-key')
          if (!apiKey) {
            return Response.json(
              { error: 'Missing Gemini API key. Add one in settings.' },
              { status: 401 },
            )
          }
          const google = createGoogleGenerativeAI({ apiKey })
          model = google(
            requestedModel && GEMINI_MODELS.includes(requestedModel)
              ? requestedModel
              : GEMINI_MODELS[0],
          )
        }

        const tools = {
            // All tools execute on the client against canvas state.
            createShape: {
              description: 'Add a single shape to the canvas. Returns the created shape with its id.',
              inputSchema: newShapeSchema,
            },
            createShapes: {
              description:
                'Add many shapes to the canvas in one call. Always prefer this over repeated createShape when adding more than one shape. Returns the created shapes with their ids.',
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
              }),
            },
            deleteShape: {
              description:
                'Remove a shape from the canvas by id. The user is asked to confirm each deletion and may decline.',
              inputSchema: z.object({ id: z.string() }),
            },
            viewCanvas: {
              description:
                'Render the current canvas to an image and look at it. Call this after finishing edits for a design task to verify the result, then fix any problems you see.',
              // Non-empty schema: Gemini rejects function declarations with zero properties.
              inputSchema: z.object({
                focus: z.string().optional().describe('what you are checking, e.g. "spacing of the header"'),
              }),
              toModelOutput: ({ output }: { output: { image?: string; empty?: boolean } }) => {
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
            loadSkill: {
              description:
                'Load a skill: expert instructions to follow for the current task. Read the returned text and apply it. Available skills: ' +
                Object.entries(SKILLS)
                  .map(([name, s]) => `${name} (${s.description})`)
                  .join('; '),
              inputSchema: z.object({ name: z.enum(['frontend-design']) }),
              execute: async ({ name }: { name: SkillName }) => SKILLS[name].content,
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
            'Never delete or overwrite existing shapes unless the user asked for exactly that. When a request is ambiguous, use the askQuestion tool instead of guessing.',
            'Make the minimal set of changes that fulfills the request - no extra decoration, no unrequested layouts.',
            'Skills: before any substantial design task (a screen, a page layout, a multi-shape composition), call loadSkill with "frontend-design" and follow its guidance. Skip it for trivial edits.',
            'You manipulate the canvas only through tools. Shapes are rect, ellipse, text, or frame.',
            'Frames are artboards: white containers that render behind other shapes. Design inside a frame when one exists (or create one for a screen/page design, e.g. 375x812 mobile or 1440x900 desktop). The frame name lives in its "text" field.',
            'Shapes support stroke (border color + strokeWidth), radius (rounded corners on rect/frame), and opacity (0-1). Use them: a rect with radius 8 and a subtle stroke reads as a button or card.',
            'The user message may include a PNG snapshot of the current canvas. Use it to judge layout, overlap, and balance before and after your edits.',
            'Coordinates: x/y is the top-left corner, y grows downward. The visible canvas is roughly 1200x800 around the origin.',
            'Palette to prefer: #1a1917 ink, #ffffff white, #2440e6 ultramarine, #e8442e vermilion, #f5c518 yellow, #23a25d green. Other CSS colors are allowed when asked.',
            'Text shapes render at fontSize (default 20) with fontWeight (400-700) and align (left/center/right), in the fill color. Text wraps at the box width w and supports newlines - size the box for the content. Use weight and size for hierarchy: e.g. 32/700 titles, 14/400 body.',
            'When laying out multiple shapes, space them deliberately - aligned edges, consistent gaps. Use createShapes (batch) to add them all in one call.',
            'Verify loop: after finishing the edits for a design task, call viewCanvas to see the actual result. If you spot problems (overlap, misalignment, cramped spacing, poor contrast), fix them and check again. Skip verification for trivial single-shape edits.',
            'Keep replies to one or two short sentences; the user sees the canvas change live.',
            '',
            'Current canvas shapes (JSON):',
            JSON.stringify(shapes ?? []),
          ].join('\n'),
          messages: await convertToModelMessages(messages, { tools }),
          stopWhen: stepCountIs(10),
          tools,
          // Kill hung upstream calls instead of leaving the client spinning forever.
          abortSignal: AbortSignal.timeout(120_000),
          onError: ({ error }) => console.error('[chat] stream error:', error),
        })

        return result.toUIMessageStreamResponse({
          onError: (error) =>
            error instanceof Error ? error.message : 'The model request failed.',
        })
      },
    },
  },
})
