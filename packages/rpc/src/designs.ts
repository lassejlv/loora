import { ORPCError } from '@orpc/server'
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import { assistantThread, design, publishedSite } from '@loora/db/schema'
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
import { customDomainOrpcError } from './publish-domain'
import { cleanupPublishedSiteArtifacts } from './published-site-artifacts'

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
    .where(and(eq(design.userId, context.user.id), isNull(design.archivedAt)))
    .orderBy(asc(design.createdAt))
    .then((rows) => rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.getTime() })))
})

/** The archive, most recently archived first — the order people look in. */
export const listArchivedDesigns = protectedProcedure.handler(async ({ context }) => {
  return db
    .select({
      id: design.id,
      name: design.name,
      revision: design.revision,
      updatedAt: design.updatedAt,
      archivedAt: design.archivedAt,
    })
    .from(design)
    .where(and(eq(design.userId, context.user.id), isNotNull(design.archivedAt)))
    .orderBy(desc(design.archivedAt))
    .then((rows) =>
      rows.map(({ updatedAt, archivedAt, ...row }) => ({
        ...row,
        updatedAt: updatedAt.getTime(),
        archivedAt: (archivedAt ?? updatedAt).getTime(),
      })),
    )
})

export const archiveDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [archived] = await db
      .update(design)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(design.id, input.id),
          eq(design.userId, context.user.id),
          isNull(design.archivedAt),
        ),
      )
      .returning({ id: design.id, archivedAt: design.archivedAt })

    if (!archived) throw new ORPCError('NOT_FOUND')
    return { archivedAt: (archived.archivedAt ?? new Date()).getTime() }
  })

export const restoreDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    // Restoring puts a file back in the count, so it has to fit the plan.
    await ensureDesignFileRoom(context.user)
    const [restored] = await db
      .update(design)
      .set({ archivedAt: null })
      .where(
        and(
          eq(design.id, input.id),
          eq(design.userId, context.user.id),
          isNotNull(design.archivedAt),
        ),
      )
      .returning({ id: design.id })

    if (!restored) throw new ORPCError('NOT_FOUND')
    return { restored: true }
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

/**
 * Permanent, and only from the archive. Archiving is the delete people reach
 * for; this is the one that empties it, so it refuses a file that is still in
 * use rather than trusting the caller to have asked twice.
 */
export const deleteDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [existing] = await db
      .select({ archivedAt: design.archivedAt })
      .from(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .limit(1)

    if (!existing) throw new ORPCError('NOT_FOUND')
    if (!existing.archivedAt) {
      throw new ORPCError('CONFLICT', {
        message: 'Archive this file before deleting it permanently.',
      })
    }

    const sites = await db
      .select({
        customDomain: publishedSite.customDomain,
        storageKey: publishedSite.storageKey,
      })
      .from(publishedSite)
      .where(
        and(
          eq(publishedSite.designId, input.id),
          eq(publishedSite.userId, context.user.id),
        ),
      )
    try {
      await cleanupPublishedSiteArtifacts(sites, {
        strictCustomDomains: true,
        logScope: 'design-delete',
      })
    } catch (error) {
      customDomainOrpcError(error)
    }

    // Agent threads have no foreign key onto `design` (it is keyed on
    // `(id, user_id)`), so a permanent delete takes them out by hand — the
    // conversation about a file should not outlive the file.
    await db
      .delete(assistantThread)
      .where(
        and(
          eq(assistantThread.designId, input.id),
          eq(assistantThread.userId, context.user.id),
        ),
      )

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
