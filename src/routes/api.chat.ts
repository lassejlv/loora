import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { z } from 'zod'
import type { Shape } from '#/lib/canvas'

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
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get('x-gemini-key')
        if (!apiKey) {
          return Response.json(
            { error: 'Missing Gemini API key. Add one in settings.' },
            { status: 401 },
          )
        }

        const { messages, shapes } = (await request.json()) as {
          messages: UIMessage[]
          shapes: Shape[]
        }

        const google = createGoogleGenerativeAI({ apiKey })

        const result = streamText({
          model: google('gemini-3.5-flash'),
          system: [
            'You are the design agent inside loora, a minimal canvas tool.',
            'Only touch the canvas when the user explicitly asks for a change. Greetings, questions, or chit-chat get a plain text reply with zero tool calls.',
            'Never delete or overwrite existing shapes unless the user asked for exactly that. When a request is ambiguous, use the askQuestion tool instead of guessing.',
            'Make the minimal set of changes that fulfills the request - no extra decoration, no unrequested layouts.',
            'You manipulate the canvas only through tools. Shapes are rect, ellipse, text, or frame.',
            'Frames are artboards: white containers that render behind other shapes. Design inside a frame when one exists (or create one for a screen/page design, e.g. 375x812 mobile or 1440x900 desktop). The frame name lives in its "text" field.',
            'Shapes support stroke (border color + strokeWidth), radius (rounded corners on rect/frame), and opacity (0-1). Use them: a rect with radius 8 and a subtle stroke reads as a button or card.',
            'The user message may include a PNG snapshot of the current canvas. Use it to judge layout, overlap, and balance before and after your edits.',
            'Coordinates: x/y is the top-left corner, y grows downward. The visible canvas is roughly 1200x800 around the origin.',
            'Palette to prefer: #1a1917 ink, #ffffff white, #2440e6 ultramarine, #e8442e vermilion, #f5c518 yellow, #23a25d green. Other CSS colors are allowed when asked.',
            'Text shapes render their text at fontSize (default 20) in the fill color; size the box to fit.',
            'When laying out multiple shapes, space them deliberately - aligned edges, consistent gaps.',
            'Keep replies to one or two short sentences; the user sees the canvas change live.',
            '',
            'Current canvas shapes (JSON):',
            JSON.stringify(shapes ?? []),
          ].join('\n'),
          messages: await convertToModelMessages(messages),
          stopWhen: stepCountIs(10),
          tools: {
            // All tools execute on the client against canvas state.
            createShape: {
              description: 'Add a shape to the canvas. Returns the created shape with its id.',
              inputSchema: z.object({
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
              }),
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
              }),
            },
            deleteShape: {
              description:
                'Remove a shape from the canvas by id. The user is asked to confirm each deletion and may decline.',
              inputSchema: z.object({ id: z.string() }),
            },
            askQuestion: {
              description:
                'Ask the user a question when a request is ambiguous or a design decision is theirs to make. Provide 2-4 short options. When a sensible default exists, include "Decide for me" as the last option and pick the default yourself if chosen.',
              inputSchema: z.object({
                question: z.string(),
                options: z.array(z.string()).min(2).max(4),
              }),
            },
          },
        })

        return result.toUIMessageStreamResponse()
      },
    },
  },
})
