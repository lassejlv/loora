import { z } from 'zod'
import { MAX_AGENT_SYSTEM_PROMPT_LENGTH } from '@loora/agent/prompts'

export const agentSystemPromptSchema = z.string().trim().max(MAX_AGENT_SYSTEM_PROMPT_LENGTH)
