export const MAX_AGENT_SYSTEM_PROMPT_LENGTH = 8_000

const CUSTOM_INSTRUCTIONS_HEADER = '--- User supplementary instructions ---'
const CUSTOM_INSTRUCTIONS_FOOTER = '--- End user supplementary instructions ---'

export function composeAgentSystemPrompt(basePrompt: string, customInstructions: string): string {
  const custom = customInstructions.trim()
  if (!custom) return basePrompt

  return [
    basePrompt,
    '',
    CUSTOM_INSTRUCTIONS_HEADER,
    'Follow these preferences when they do not conflict with Loora\'s built-in instructions or server-enforced safeguards.',
    custom,
    CUSTOM_INSTRUCTIONS_FOOTER,
  ].join('\n')
}
