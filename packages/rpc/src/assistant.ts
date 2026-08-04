/**
 * The `assistant` namespace: the in-app agent's ChatGPT connection and the
 * threads it works in.
 *
 * The run itself is not here — it streams from `/api/assistant/chat`, because a
 * token stream is not an oRPC call. What lives here is everything around it:
 * whether a person can run the agent at all, which conversation the open
 * document is on, and what was said in it.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@loora/db'
import {
  assistantMessage,
  assistantThread,
  design,
  designDraft,
} from '@loora/db/schema'
import {
  chatgptAuth,
  chatgptEnabled,
} from '@loora/auth/chatgpt'
import { assistantModelId } from '@loora/assistant/model'
import { isInAppAgentEnabled } from '@loora/railway'
import { protectedProcedure, requireDesignAccess } from './procedures'

/** How much of a thread is replayed into the editor and back to the model. */
export const ASSISTANT_THREAD_WINDOW = 120

/** A stored message. Deliberately not typed as the AI SDK's `UIMessage`: this
 * module has no business pulling a model runtime into every oRPC bundle. */
export interface StoredAssistantMessage {
  id: string
  role: 'user' | 'assistant'
  parts: unknown[]
}

export const assistantTargetSchema = z.object({
  designId: z.string().min(1).max(128),
  draftId: z.string().min(1).max(128).nullish(),
})

export type AssistantTargetInput = z.infer<typeof assistantTargetSchema>

function threadId() {
  return `athread_${globalThis.crypto.randomUUID()}`
}

const targetWhere = (
  userId: string,
  target: { designId: string; draftId?: string | null },
) =>
  and(
    eq(assistantThread.userId, userId),
    eq(assistantThread.designId, target.designId),
    target.draftId
      ? eq(assistantThread.draftId, target.draftId)
      : isNull(assistantThread.draftId),
  )

/**
 * The conversation the open document is on. One thread per person per target;
 * a reload lands back in the same one, and `startAssistantThread` is the only
 * way to get a fresh one.
 */
export async function currentAssistantThread(
  userId: string,
  target: { designId: string; draftId?: string | null },
) {
  const [found] = await db
    .select({ id: assistantThread.id })
    .from(assistantThread)
    .where(targetWhere(userId, target))
    .orderBy(desc(assistantThread.updatedAt))
    .limit(1)
  if (found) return found.id
  const id = threadId()
  await db.insert(assistantThread).values({
    id,
    userId,
    designId: target.designId,
    draftId: target.draftId ?? null,
  })
  return id
}

export async function startAssistantThread(
  userId: string,
  target: { designId: string; draftId?: string | null },
) {
  const id = threadId()
  await db.insert(assistantThread).values({
    id,
    userId,
    designId: target.designId,
    draftId: target.draftId ?? null,
  })
  return id
}

/**
 * Adopt the thread the client named, or fall back to this target's current one.
 * A thread id from a request is never trusted: it has to belong to this person
 * and to this document, or it is ignored rather than refused — the person came
 * to type, not to debug an identifier.
 */
export async function ensureAssistantThread(
  userId: string,
  target: { designId: string; draftId?: string | null },
  requested?: string | null,
) {
  if (requested) {
    const [found] = await db
      .select({ id: assistantThread.id })
      .from(assistantThread)
      .where(and(eq(assistantThread.id, requested), targetWhere(userId, target)))
      .limit(1)
    if (found) return found.id
  }
  return currentAssistantThread(userId, target)
}

/** Names for the system prompt, without parsing a whole canvas document. */
export async function assistantTargetNames(
  userId: string,
  target: { designId: string; draftId?: string | null },
) {
  const [found] = await db
    .select({ name: design.name })
    .from(design)
    .where(and(eq(design.id, target.designId), eq(design.userId, userId)))
    .limit(1)
  if (!target.draftId) {
    return { designName: found?.name ?? null, branchName: null }
  }
  const [branch] = await db
    .select({ name: designDraft.name })
    .from(designDraft)
    .where(
      and(
        eq(designDraft.id, target.draftId),
        eq(designDraft.designId, target.designId),
        eq(designDraft.userId, userId),
      ),
    )
    .limit(1)
  return { designName: found?.name ?? null, branchName: branch?.name ?? null }
}

export async function readAssistantMessages(
  id: string,
): Promise<StoredAssistantMessage[]> {
  const rows = await db
    .select({
      id: assistantMessage.id,
      role: assistantMessage.role,
      parts: assistantMessage.parts,
    })
    .from(assistantMessage)
    .where(eq(assistantMessage.threadId, id))
    // Newest first, then reversed: the tail of a long thread is the part worth
    // replaying, and `seq` is the only field that orders a turn correctly.
    .orderBy(desc(assistantMessage.seq))
    .limit(ASSISTANT_THREAD_WINDOW)
  return rows
    .reverse()
    .map((row) => ({
      id: row.id,
      role: row.role,
      parts: Array.isArray(row.parts) ? row.parts : [],
    }))
}

/** The first thing somebody typed, which is a better name than "Untitled". */
function threadTitle(messages: StoredAssistantMessage[]) {
  const first = messages.find((message) => message.role === 'user')
  if (!first) return null
  for (const part of first.parts) {
    const shaped = part as { type?: string; text?: string }
    if (shaped?.type === 'text' && typeof shaped.text === 'string') {
      const text = shaped.text.trim()
      if (text) return text.slice(0, 120)
    }
  }
  return null
}

/**
 * Written by message id, so a run that streams the same assistant message
 * twice (a resumed stream, a retried write) updates one row instead of
 * growing the thread.
 */
export async function saveAssistantMessages(
  id: string,
  messages: StoredAssistantMessage[],
) {
  const window = messages.slice(-ASSISTANT_THREAD_WINDOW)
  if (window.length === 0) return
  await db
    .insert(assistantMessage)
    .values(
      window.map((message) => ({
        id: message.id,
        threadId: id,
        role: message.role,
        parts: message.parts,
      })),
    )
    .onConflictDoUpdate({
      target: assistantMessage.id,
      set: { parts: sql`excluded.parts` },
    })
  const title = threadTitle(window)
  await db
    .update(assistantThread)
    .set({ updatedAt: new Date(), ...(title ? { title } : {}) })
    .where(eq(assistantThread.id, id))
}

/**
 * The agent runs against the owner's document — `getCanvasTarget` is
 * owner-scoped, so a collaborator would otherwise get "design not found" from
 * the first tool call instead of a sentence they can act on.
 */
export async function requireAssistantTarget(
  user: { id: string; email: string; isAdmin?: boolean | null } & Record<string, unknown>,
  target: AssistantTargetInput,
) {
  if (!(await isInAppAgentEnabled(user))) {
    throw new ORPCError('FORBIDDEN', { message: 'The agent is not available.' })
  }
  const access = await requireDesignAccess(user, target.designId, 'edit')
  if (access.role !== 'owner') {
    throw new ORPCError('FORBIDDEN', {
      message: 'The agent works on designs you own.',
    })
  }
  return access
}

/**
 * What the editor needs before it can decide whether to show the agent at all:
 * whether this account is in the flag, whether the server can run it, and who
 * it would run as. Cheap enough to call on every editor mount.
 */
export const getAssistantStatus = protectedProcedure.handler(
  async ({ context }) => {
    const enabled = await isInAppAgentEnabled(context.user)
    if (!enabled) {
      return {
        enabled: false as const,
        configured: false,
        connection: null,
        model: assistantModelId(),
      }
    }
    const session = chatgptEnabled
      ? await chatgptAuth.getSession(context.request)
      : null
    const connection = session?.status === 'authenticated'
      ? {
          email: session.user?.email ?? null,
          name: session.user?.name ?? null,
          planType: session.user?.plan ?? null,
        }
      : null
    return {
      enabled: true as const,
      configured: chatgptEnabled,
      connection,
      model: assistantModelId(),
    }
  },
)

export const getAssistantThread = protectedProcedure
  .input(assistantTargetSchema)
  .handler(async ({ context, input }) => {
    await requireAssistantTarget(context.user, input)
    const id = await currentAssistantThread(context.user.id, input)
    return { threadId: id, messages: await readAssistantMessages(id) }
  })

export const newAssistantThread = protectedProcedure
  .input(assistantTargetSchema)
  .handler(async ({ context, input }) => {
    await requireAssistantTarget(context.user, input)
    return {
      threadId: await startAssistantThread(context.user.id, input),
      messages: [] as StoredAssistantMessage[],
    }
  })
