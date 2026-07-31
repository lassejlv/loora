import { ORPCError } from '@orpc/server'
import {
  and,
  eq,
  or,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  design,
  designShare,
  user,
} from '@loora/db/schema'
import {
  claimDesignShares,
  isEmail,
  listDesignCollaborators,
  normalizeEmail,
} from '@loora/db/design-access'
import {
  consentedProcedure,
  requireDesignAccess,
} from './procedures'

/**
 * The `share` namespace: who else may open a design, and how.
 */

export const designIdInput = z.object({ designId: z.string().min(1).max(128) })

export const shareRoleInput = z.enum(['view', 'edit'])

/** What the share dialog renders: link mode, everyone invited, and my standing. */
export const getDesignShare = consentedProcedure
  .input(designIdInput)
  .handler(async ({ context, input }) => {
    // Opening the design is what turns an invitation addressed to an email
    // into a grant held by an account.
    await claimDesignShares({ id: context.user.id, email: context.user.email })
    const access = await requireDesignAccess(context.user, input.designId)
    const collaborators =
      access.role === 'owner'
        ? await listDesignCollaborators(input.designId, access.ownerUserId)
        : []
    const [owner] = await db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(eq(user.id, access.ownerUserId))
      .limit(1)
    return {
      role: access.role,
      source: access.source,
      linkAccess: access.linkAccess,
      owner: owner ?? null,
      collaborators: collaborators.map((collaborator) => ({
        ...collaborator,
        acceptedAt: collaborator.acceptedAt?.getTime() ?? null,
        createdAt: collaborator.createdAt.getTime(),
      })),
    }
  })

export const setDesignLinkAccess = consentedProcedure
  .input(
    designIdInput.extend({
      linkAccess: z.enum(['restricted', 'view', 'edit']),
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    await db
      .update(design)
      .set({ linkAccess: input.linkAccess })
      .where(
        and(
          eq(design.id, input.designId),
          eq(design.userId, access.ownerUserId),
        ),
      )
    return { linkAccess: input.linkAccess }
  })

export const inviteDesignCollaborator = consentedProcedure
  .input(
    designIdInput.extend({
      email: z.string().trim().min(3).max(320),
      role: shareRoleInput,
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    const email = normalizeEmail(input.email)
    if (!isEmail(email)) {
      throw new ORPCError('BAD_REQUEST', { message: 'Enter a valid email address.' })
    }
    if (email === normalizeEmail(context.user.email)) {
      throw new ORPCError('BAD_REQUEST', { message: 'You already own this design.' })
    }
    const existing = await listDesignCollaborators(
      input.designId,
      access.ownerUserId,
    )
    if (
      existing.length >= 100 &&
      !existing.some((collaborator) => collaborator.email === email)
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'A design can be shared with at most 100 people.',
      })
    }
    // An invitation may be written before that person has an account, so the
    // account is looked up opportunistically and filled in on their first visit
    // otherwise.
    const [account] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)
    await db
      .insert(designShare)
      .values({
        id: crypto.randomUUID(),
        designId: input.designId,
        ownerUserId: access.ownerUserId,
        email,
        role: input.role,
        invitedByUserId: context.user.id,
        userId: account?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [designShare.designId, designShare.ownerUserId, designShare.email],
        set: { role: input.role, updatedAt: new Date() },
      })
    return { email, role: input.role }
  })

export const setDesignCollaboratorRole = consentedProcedure
  .input(designIdInput.extend({ shareId: z.string().min(1).max(128), role: shareRoleInput }))
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    const [updated] = await db
      .update(designShare)
      .set({ role: input.role })
      .where(
        and(
          eq(designShare.id, input.shareId),
          eq(designShare.designId, input.designId),
          eq(designShare.ownerUserId, access.ownerUserId),
        ),
      )
      .returning({ id: designShare.id })
    if (!updated) throw new ORPCError('NOT_FOUND')
    return { id: updated.id, role: input.role }
  })

export const revokeDesignCollaborator = consentedProcedure
  .input(designIdInput.extend({ shareId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId, 'owner')
    const removed = await db
      .delete(designShare)
      .where(
        and(
          eq(designShare.id, input.shareId),
          eq(designShare.designId, input.designId),
          eq(designShare.ownerUserId, access.ownerUserId),
        ),
      )
      .returning({ id: designShare.id })
    return { revoked: removed.length > 0 }
  })

/** Removes yourself from a design somebody else shared with you. */
export const leaveDesignShare = consentedProcedure
  .input(designIdInput)
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(context.user, input.designId)
    if (access.role === 'owner') {
      throw new ORPCError('BAD_REQUEST', { message: 'The owner cannot leave a design.' })
    }
    const removed = await db
      .delete(designShare)
      .where(
        and(
          eq(designShare.designId, input.designId),
          eq(designShare.ownerUserId, access.ownerUserId),
          or(
            eq(designShare.userId, context.user.id),
            eq(designShare.email, normalizeEmail(context.user.email)),
          ),
        ),
      )
      .returning({ id: designShare.id })
    return { left: removed.length > 0 }
  })
