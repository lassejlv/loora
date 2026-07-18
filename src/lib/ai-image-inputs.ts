import type { UIMessage } from 'ai'
import type { ModelKey } from '#/lib/models'

// Add a model key here when its provider model supports image input.
const IMAGE_INPUT_MODELS = new Set<ModelKey>(['mini'])

export function modelSupportsImageInput(model: string): boolean {
  return IMAGE_INPUT_MODELS.has(model as ModelKey)
}

export function withoutImageParts(
  messages: UIMessage[],
  imageInputsEnabled: boolean,
): UIMessage[] {
  if (imageInputsEnabled) return messages

  return messages.flatMap((message) => {
    const parts = message.parts.filter(
      (part) => part.type !== 'file' || !part.mediaType.startsWith('image/'),
    )
    return parts.length > 0 ? [{ ...message, parts }] : []
  })
}
