import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { adminProcedure } from './procedures'
import {
  listFlags,
  getFlag,
  createFlag,
  updateFlagDefault,
  setFlagRule,
  unsetFlagRule,
  deleteFlag,
  evaluateFlag,
  type FlagType,
} from '@loora/railway'

function parseDefaultValue(type: FlagType, raw: string): unknown {
  try {
    if (type === 'bool') return raw === 'true'
    if (type === 'number') return Number(raw)
    if (type === 'json') return JSON.parse(raw)
    return raw
  } catch {
    throw new ORPCError('BAD_REQUEST', {
      message: `Default value is not valid ${type}.`,
    })
  }
}

export const adminListFlags = adminProcedure.handler(async () => {
  try {
    return await listFlags()
  } catch (cause) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: cause instanceof Error ? cause.message : 'Could not list flags.',
    })
  }
})

export const adminGetFlag = adminProcedure
  .input(z.object({ name: z.string().min(1).max(128) }))
  .handler(async ({ input }) => {
    try {
      return await getFlag(input.name)
    } catch (cause) {
      throw new ORPCError('NOT_FOUND', {
        message: cause instanceof Error ? cause.message : 'Flag not found.',
      })
    }
  })

export const adminCreateFlag = adminProcedure
  .input(
    z.object({
      name: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dots, dashes, underscores only.'),
      type: z.enum(['bool', 'string', 'number', 'json']),
      default: z.string().min(1).max(4096),
    }),
  )
  .handler(async ({ input }) => {
    const defaultValue = parseDefaultValue(input.type, input.default)
    try {
      return await createFlag(input.name, input.type, defaultValue)
    } catch (cause) {
      throw new ORPCError('CONFLICT', {
        message: cause instanceof Error ? cause.message : 'Could not create flag.',
      })
    }
  })

export const adminUpdateFlagDefault = adminProcedure
  .input(
    z.object({
      name: z.string().min(1).max(128),
      default: z.string().min(1).max(4096),
    }),
  )
  .handler(async ({ input }) => {
    const existing = await getFlag(input.name)
    const defaultValue = parseDefaultValue(existing.type, input.default)
    try {
      return await updateFlagDefault(input.name, defaultValue)
    } catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: cause instanceof Error ? cause.message : 'Could not update default.',
      })
    }
  })

export const adminSetFlagRule = adminProcedure
  .input(
    z.object({
      name: z.string().min(1).max(128),
      ruleId: z.string().min(1).max(128),
      expression: z.string().min(1).max(2048),
      value: z.string().min(1).max(4096),
    }),
  )
  .handler(async ({ input }) => {
    const existing = await getFlag(input.name)
    let parsedExpression: unknown
    try {
      parsedExpression = JSON.parse(input.expression)
    } catch {
      throw new ORPCError('BAD_REQUEST', { message: 'Expression must be valid JSON.' })
    }
    const ruleValue = parseDefaultValue(existing.type, input.value)
    try {
      return await setFlagRule(input.name, input.ruleId, parsedExpression, ruleValue)
    } catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: cause instanceof Error ? cause.message : 'Could not set rule.',
      })
    }
  })

export const adminUnsetFlagRule = adminProcedure
  .input(
    z.object({
      name: z.string().min(1).max(128),
      ruleId: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ input }) => {
    try {
      return await unsetFlagRule(input.name, input.ruleId)
    } catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: cause instanceof Error ? cause.message : 'Could not remove rule.',
      })
    }
  })

export const adminDeleteFlag = adminProcedure
  .input(z.object({ name: z.string().min(1).max(128) }))
  .handler(async ({ input }) => {
    try {
      return await deleteFlag(input.name)
    } catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: cause instanceof Error ? cause.message : 'Could not delete flag.',
      })
    }
  })

export const adminEvaluateFlag = adminProcedure
  .input(
    z.object({
      name: z.string().min(1).max(128),
      context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    }),
  )
  .handler(async ({ input }) => {
    try {
      return await evaluateFlag(input.name, input.context)
    } catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: cause instanceof Error ? cause.message : 'Could not evaluate flag.',
      })
    }
  })