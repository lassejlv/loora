import { neon } from '@neondatabase/ai-sdk-provider'

type JsonRecord = Record<string, unknown>
type NeonModel = ReturnType<typeof neon>
type NeonCallOptions = Parameters<NeonModel['doStream']>[0]

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function legacyFileData(value: unknown): unknown {
  const data = record(value)
  if (!data) return value
  if (data.type === 'data') return data.data
  if (data.type === 'url') return data.url
  return value
}

function legacyToolContentPart(value: unknown): unknown {
  const part = record(value)
  if (!part || part.type !== 'file') return value

  const data = legacyFileData(part.data)
  if (data === part.data) return value

  return {
    ...part,
    type: typeof part.mediaType === 'string' && part.mediaType.startsWith('image/')
      ? 'image-data'
      : 'file-data',
    data,
  }
}

function legacyPromptPart(value: unknown): unknown {
  const part = record(value)
  if (!part) return value

  if (part.type === 'file') {
    return { ...part, data: legacyFileData(part.data) }
  }

  if (part.type !== 'tool-result') return value
  const output = record(part.output)
  if (!output || output.type !== 'content' || !Array.isArray(output.value)) return value

  return {
    ...part,
    output: {
      ...output,
      value: output.value.map(legacyToolContentPart),
    },
  }
}

export function normalizeNeonPrompt(prompt: unknown): unknown {
  if (!Array.isArray(prompt)) return prompt
  return prompt.map((value) => {
    const message = record(value)
    if (!message || !Array.isArray(message.content)) return value
    return {
      ...message,
      content: message.content.map(legacyPromptPart),
    }
  })
}

function normalizeCallOptions(options: NeonCallOptions): NeonCallOptions {
  return {
    ...options,
    prompt: normalizeNeonPrompt(options.prompt) as NeonCallOptions['prompt'],
  }
}

export function createNeonModel(modelId: string): NeonModel {
  const model = neon(modelId)

  // Neon 0.7.x declares AI SDK 7 support but still implements the v3 model
  // interface. AI SDK 7 otherwise relabels it as v4 without converting v4
  // FileData objects, which the Neon Gemini route stringifies as
  // "[object Object]". Flatten files at the model boundary until Neon ships a
  // native v4 provider.
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property === 'specificationVersion') return 'v4'
      if (property === 'doGenerate') {
        return (options: NeonCallOptions) =>
          target.doGenerate(normalizeCallOptions(options))
      }
      if (property === 'doStream') {
        return (options: NeonCallOptions) =>
          target.doStream(normalizeCallOptions(options))
      }
      return Reflect.get(target, property, receiver)
    },
  })
}
