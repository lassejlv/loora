import type { UIMessage } from 'ai'
import { getModel } from '#/lib/models'

export function modelSupportsImageInput(model: string): boolean {
  return getModel(model).supportsImageInput
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
