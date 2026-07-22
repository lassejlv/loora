import { z } from 'zod'

export const agentSystemPromptSchema = z.string().trim().max(8_000)
