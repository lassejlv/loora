import { and, asc, desc, eq } from 'drizzle-orm'
import { ORPCError, os } from '@orpc/server'
import { z } from 'zod'
import { db } from '#/db'
import { design, designChat, designVersion } from '#/db/schema'
import type { getSession } from '#/lib/auth'
import type { Shape } from '#/lib/canvas'
import type { UIMessage } from 'ai'

type Session = Awaited<ReturnType<typeof getSession>>

export interface ORPCContext {
  session: Session
}

const shapeSchema = z.object({
  id: z.string(),
  type: z.enum(['rect', 'ellipse', 'text', 'frame']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fill: z.string(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  radius: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
})

const requireUser = os.$context<ORPCContext>().middleware(async ({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user } })
})

const protectedProcedure = os.$context<ORPCContext>().use(requireUser)

function shapeDiff(previous: Shape[], next: Shape[]) {
  const previousById = new Map(previous.map((shape) => [shape.id, shape]))
  const nextIds = new Set(next.map((shape) => shape.id))
  let added = 0
  let changed = 0
  for (const shape of next) {
    const old = previousById.get(shape.id)
    if (!old) added += 1
    else if (JSON.stringify(old) !== JSON.stringify(shape)) changed += 1
  }
  return {
    added,
    removed: previous.filter((shape) => !nextIds.has(shape.id)).length,
    changed,
  }
}

const listDesigns = protectedProcedure.handler(async ({ context }) => {
  return db
    .select({ id: design.id, name: design.name, shapes: design.shapes })
    .from(design)
    .where(eq(design.userId, context.user.id))
    .orderBy(asc(design.createdAt))
})

const saveDesign = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      name: z.string().trim().min(1).max(200),
      shapes: z.array(shapeSchema).max(10_000),
    }),
  )
  .handler(async ({ context, input }) => {
    const [saved] = await db
      .insert(design)
      .values({ ...input, userId: context.user.id })
      .onConflictDoUpdate({
        target: [design.id, design.userId],
        set: { name: input.name, shapes: input.shapes, updatedAt: new Date() },
      })
      .returning({ id: design.id, updatedAt: design.updatedAt })

    return saved
  })

const deleteDesign = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(design)
      .where(and(eq(design.id, input.id), eq(design.userId, context.user.id)))
      .returning({ id: design.id })

    return { deleted: deleted.length > 0 }
  })

const listVersions = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const versions = await db
      .select()
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
        ),
      )
      .orderBy(desc(designVersion.createdAt))

    return versions.map(({ createdAt, userId: _userId, designId: _designId, ...version }) => ({
      ...version,
      at: createdAt.getTime(),
    }))
  })

const commitVersion = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      designId: z.string().min(1).max(128),
      message: z.string().trim().min(1).max(200),
      shapes: z.array(shapeSchema).max(10_000),
      skipIfUnchanged: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const [latest] = await db
      .select({ shapes: designVersion.shapes })
      .from(designVersion)
      .where(
        and(
          eq(designVersion.designId, input.designId),
          eq(designVersion.userId, context.user.id),
        ),
      )
      .orderBy(desc(designVersion.createdAt))
      .limit(1)

    if (
      input.skipIfUnchanged &&
      (input.shapes.length === 0 || JSON.stringify(latest?.shapes) === JSON.stringify(input.shapes))
    ) {
      return null
    }

    const changes = shapeDiff(latest?.shapes ?? [], input.shapes)
    const [version] = await db
      .insert(designVersion)
      .values({
        id: input.id,
        designId: input.designId,
        userId: context.user.id,
        message: input.message,
        shapes: input.shapes,
        ...changes,
      })
      .returning()

    return {
      id: version.id,
      message: version.message,
      shapes: version.shapes,
      added: version.added,
      removed: version.removed,
      changed: version.changed,
      at: version.createdAt.getTime(),
    }
  })

const listChats = protectedProcedure
  .input(z.object({ designId: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const chats = await db
      .select({ id: designChat.id, title: designChat.title, updatedAt: designChat.updatedAt })
      .from(designChat)
      .where(
        and(eq(designChat.designId, input.designId), eq(designChat.userId, context.user.id)),
      )
      .orderBy(desc(designChat.updatedAt))

    return chats.map(({ updatedAt, ...chat }) => ({ ...chat, updatedAt: updatedAt.getTime() }))
  })

const createChat = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      designId: z.string().min(1).max(128),
      title: z.string().trim().min(1).max(200).default('New chat'),
    }),
  )
  .handler(async ({ context, input }) => {
    const [chat] = await db
      .insert(designChat)
      .values({ ...input, userId: context.user.id, messages: [] })
      .onConflictDoNothing({ target: [designChat.id, designChat.userId] })
      .returning({ id: designChat.id, title: designChat.title, updatedAt: designChat.updatedAt })

    if (chat) return { ...chat, updatedAt: chat.updatedAt.getTime() }

    const [existing] = await db
      .select({ id: designChat.id, title: designChat.title, updatedAt: designChat.updatedAt })
      .from(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .limit(1)

    if (!existing) throw new ORPCError('INTERNAL_SERVER_ERROR')
    return { ...existing, updatedAt: existing.updatedAt.getTime() }
  })

const getChat = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const [chat] = await db
      .select({ messages: designChat.messages })
      .from(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .limit(1)

    if (!chat) throw new ORPCError('NOT_FOUND')
    return { messages: chat.messages }
  })

const saveChat = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1).max(128),
      title: z.string().trim().min(1).max(200),
      messages: z.array(z.unknown()).max(1_000),
    }),
  )
  .handler(async ({ context, input }) => {
    const saved = await db
      .update(designChat)
      .set({
        title: input.title,
        messages: input.messages as UIMessage[],
        updatedAt: new Date(),
      })
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .returning({ id: designChat.id })

    if (saved.length === 0) throw new ORPCError('NOT_FOUND')
    return { saved: input.messages.length }
  })

const deleteChat = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(designChat)
      .where(and(eq(designChat.id, input.id), eq(designChat.userId, context.user.id)))
      .returning({ id: designChat.id })

    return { deleted: deleted.length > 0 }
  })

export const appRouter = {
  design: {
    list: listDesigns,
    save: saveDesign,
    delete: deleteDesign,
  },
  history: {
    list: listVersions,
    commit: commitVersion,
  },
  chat: {
    list: listChats,
    create: createChat,
    get: getChat,
    save: saveChat,
    delete: deleteChat,
  },
}
