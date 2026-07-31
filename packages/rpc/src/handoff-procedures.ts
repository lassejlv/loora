import { ORPCError } from '@orpc/server'
import {
  and,
  eq,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import { design } from '@loora/db/schema'
import { getOwnedDraft } from './branches'
import { createHandoffToken } from './handoff-token'
import {
  optionalDraftIdSchema,
  protectedProcedure,
} from './procedures'

/**
 * The `handoff` namespace: a token-scoped snapshot for an outside consumer.
 */

export const createDesignHandoff = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      draftId: optionalDraftIdSchema,
    }),
  )
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({ id: design.id })
      .from(design)
      .where(and(eq(design.id, input.designId), eq(design.userId, context.user.id)))
      .limit(1)
    if (!found) throw new ORPCError('NOT_FOUND')
    if (input.draftId) {
      await getOwnedDraft(context.user.id, input.designId, input.draftId)
    }
    return createHandoffToken(input.designId, context.user.id, undefined, input.draftId)
  })
