import { and, eq } from 'drizzle-orm'
import { requireSession } from '@loora/auth'
import {
  canUseApp,
  previewAccessRequiredResponse,
} from '@loora/auth/preview-access'
import {
  hasAcceptedCurrentLegal,
  legalConsentRequiredResponse,
} from '@loora/auth/legal-consent'
import {
  authorizeBilling,
  subscriptionRequiredResponse,
} from '@loora/billing/billing'
import { db } from '@loora/db'
import { resolveDesignAccess } from '@loora/db/design-access'
import { designDraft } from '@loora/db/schema'

/**
 * The one gate in front of realtime, shared by the WebSocket ticket endpoint
 * and the server-sent-events fallback. Both transports must agree on who may
 * watch a document; keeping the checks in one place is what makes that true.
 */

export type RealtimeSession = NonNullable<Awaited<ReturnType<typeof requireSession>>>

export interface RealtimeAccess {
  session: RealtimeSession
  ownerUserId: string
  role: 'owner' | 'edit' | 'view'
  designId: string
  draftId: string | null
}

export type RealtimeAccessResult =
  | { ok: true; access: RealtimeAccess }
  | { ok: false; response: Response }

export type RealtimeSessionResult =
  | { ok: true; session: RealtimeSession }
  | { ok: false; response: Response }

/**
 * Who is asking, before anything is looked up on their behalf. Split out from
 * the access check so a caller can turn away a flood of requests from one
 * account without paying for a design lookup per attempt.
 */
export async function requireRealtimeSession(
  request: Request,
): Promise<RealtimeSessionResult> {
  const session = await requireSession(request)
  if (!session) {
    return { ok: false, response: new Response('Unauthorized', { status: 401 }) }
  }
  if (!hasAcceptedCurrentLegal(session.user)) {
    return { ok: false, response: legalConsentRequiredResponse() }
  }
  return { ok: true, session }
}

function draftExists(ownerUserId: string, designId: string, draftId: string) {
  return db
    .select({ id: designDraft.id })
    .from(designDraft)
    .where(
      and(
        eq(designDraft.id, draftId),
        eq(designDraft.designId, designId),
        eq(designDraft.userId, ownerUserId),
      ),
    )
    .limit(1)
    .then((rows) => !!rows[0])
}

export async function resolveRealtimeAccess(
  request: Request,
  input: { designId: string; draftId: string | null },
): Promise<RealtimeAccessResult> {
  const authenticated = await requireRealtimeSession(request)
  if (!authenticated.ok) return authenticated
  return resolveRealtimeAccessForSession(authenticated.session, input)
}

export async function resolveRealtimeAccessForSession(
  session: RealtimeSession,
  input: { designId: string; draftId: string | null },
): Promise<RealtimeAccessResult> {
  const designId = input.designId.trim()
  const draftId = input.draftId?.trim() || null
  if (
    designId.length === 0 ||
    designId.length > 128 ||
    (draftId !== null && draftId.length > 128)
  ) {
    return {
      ok: false,
      response: new Response('Invalid Canvas target', { status: 400 }),
    }
  }

  const access = await resolveDesignAccess(designId, {
    id: session.user.id,
    email: session.user.email,
  })
  if (!access) {
    return { ok: false, response: new Response('Not found', { status: 404 }) }
  }
  // Owners are held to their own plan; a guest in a shared design rides the
  // owner's, which is what makes an invitation worth anything.
  if (access.role === 'owner') {
    if (!canUseApp(session.user)) {
      return { ok: false, response: previewAccessRequiredResponse() }
    }
    if (!(await authorizeBilling(session.user)).access) {
      return { ok: false, response: subscriptionRequiredResponse() }
    }
  }
  if (draftId && !(await draftExists(access.ownerUserId, designId, draftId))) {
    return { ok: false, response: new Response('Not found', { status: 404 }) }
  }

  return {
    ok: true,
    access: {
      session,
      ownerUserId: access.ownerUserId,
      role: access.role,
      designId,
      draftId,
    },
  }
}
