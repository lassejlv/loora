/**
 * The run itself: one `streamText` loop over the canvas tools, wrapped so the
 * host route stays thin and every caller gets the same step ceiling, the same
 * message conversion and the same stream shape.
 */
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from 'ai'

/**
 * A real design task takes a handful of reads and several batched writes. This
 * is the ceiling on one turn, not a target — the loop stops as soon as the
 * model has nothing left to call.
 */
export const DEFAULT_ASSISTANT_MAX_STEPS = 32

export interface AssistantRunOptions {
  model: LanguageModel
  system: string
  /** The thread so far, as UI messages from the client. */
  messages: UIMessage[]
  tools: ToolSet
  maxSteps?: number
  abortSignal?: AbortSignal
}

export async function runAssistant(options: AssistantRunOptions) {
  return streamText({
    model: options.model,
    system: options.system,
    tools: options.tools,
    messages: await convertToModelMessages(options.messages, {
      tools: options.tools,
      // A tool call the client never finished is history, not an instruction.
      ignoreIncompleteToolCalls: true,
    }),
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_ASSISTANT_MAX_STEPS),
    abortSignal: options.abortSignal,
  })
}

export interface AssistantStreamOptions extends AssistantRunOptions {
  generateMessageId?: () => string
  /**
   * The finished thread, once the stream ends — including an aborted one, so a
   * half-finished run is still what the person sees when they come back.
   */
  onEnd?: (event: {
    messages: UIMessage[]
    responseMessage: UIMessage
    isAborted: boolean
  }) => void | Promise<void>
}

/** The whole endpoint in one call: run, stream, persist. */
export async function assistantStreamResponse(options: AssistantStreamOptions) {
  const result = await runAssistant(options)
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: options.tools,
      originalMessages: options.messages,
      generateMessageId: options.generateMessageId,
      onEnd: options.onEnd,
      // Errors reach the person as one sentence; the detail stays in the log.
      onError: (error) => {
        console.error('[loora-assistant] stream error', error)
        return error instanceof Error
          ? error.message
          : 'The agent could not finish this run.'
      },
    }),
  })
}
