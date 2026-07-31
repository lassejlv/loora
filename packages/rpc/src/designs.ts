import { ORPCError } from '@orpc/server'
import {
  and,
  asc,
  eq,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import { design } from '@loora/db/schema'
import {
  claimDesignShares,
  listSharedDesigns,
} from '@loora/db/design-access'
import {
  consentedProcedure,
  ensureDesignFileRoom,
  pageSchema,
  protectedProcedure,
  shapeSchema,
} from './procedures'

/**
 * The `design` namespace: the legacy shape/page payload documents.
 */

export const listDesigns = protectedProcedure.handler(async ({ context }) => {
  return db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
    })
    .from(design)
    .where(eq(design.userId, context.user.id))
    .orderBy(asc(design.createdAt))
    .then((rows) => rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.getTime() })))
})

export const getDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [found] = await db
      .select({
        id: design.id,
        name: design.name,
        shapes: design.shapes,
        pages: design.pages,
        revision: design.revision,
        updatedAt: design.updatedAt,
      })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!found) throw new ORPCError('NOT_FOUND')
    return { ...found, updatedAt: found.updatedAt.getTime() }
  })

export const saveDesign = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      shapes: z.array(shapeSchema).max(10_000),
      pages: z.array(pageSchema).max(1_000).default([]),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const { expectedRevision, ...values } = input
    const [existing] = await db
      .select({ revision: design.revision })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!existing) {
      await ensureDesignFileRoom(context.user)
      const [created] = await db
        .insert(design)
        .values({ ...values, userId: context.user.id })
        .returning({
          id: design.id,
          revision: design.revision,
          updatedAt: design.updatedAt,
        })
      return { ...created, updatedAt: created.updatedAt.getTime() }
    }

    if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
      throw new ORPCError('CONFLICT', { message: 'Main changed since it was loaded.' })
    }

    const [saved] = await db
      .update(design)
      .set({
        name: input.name,
        shapes: input.shapes,
        pages: input.pages,
        revision: existing.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(design.id, input.id),
          eq(design.userId, context.user.id),
          eq(design.revision, existing.revision),
        ),
      )
      .returning({
        id: design.id,
        revision: design.revision,
        updatedAt: design.updatedAt,
      })

    if (!saved) throw new ORPCError('CONFLICT', { message: 'Main changed while it was saving.' })
    return { ...saved, updatedAt: saved.updatedAt.getTime() }
  })

export const deleteDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .returning({ id: design.id })

    return { deleted: deleted.length > 0 }
  })

export const listDesignsSharedWithMe = consentedProcedure.handler(async ({ context }) => {
  await claimDesignShares({ id: context.user.id, email: context.user.email })
  const designs = await listSharedDesigns({
    id: context.user.id,
    email: context.user.email,
  })
  return designs.map((entry) => ({
    ...entry,
    updatedAt: entry.updatedAt.getTime(),
  }))
})
