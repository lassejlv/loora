import { and, eq, isNull, or } from 'drizzle-orm'
import { db } from './index'
import { design, designShare, user } from './schema'

export type DesignShareRole = 'view' | 'edit'
export type DesignRole = 'owner' | DesignShareRole
export type DesignLinkAccess = 'restricted' | DesignShareRole

/** How the viewer reached this design, which is what the UI explains to them. */
export type DesignAccessSource = 'owner' | 'share' | 'link'

export interface DesignAccess {
  designId: string
  ownerUserId: string
  role: DesignRole
  source: DesignAccessSource
  linkAccess: DesignLinkAccess
}

export interface DesignViewer {
  id: string
  email: string
}

const roleRank: Record<DesignRole, number> = { view: 0, edit: 1, owner: 2 }

export function allows(role: DesignRole, required: DesignRole) {
  return roleRank[role] >= roleRank[required]
}

export function canEdit(role: DesignRole) {
  return allows(role, 'edit')
}

/**
 * Emails are compared as identifiers, not as display text. An invitation
 * written `Lasse@Example.com ` has to match the account that signs in as
 * `lasse@example.com`.
 */
export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function isEmail(value: string) {
  const email = normalizeEmail(value)
  return (
    email.length > 2 &&
    email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
}

/**
 * Which design row `designId` refers to. Designs are keyed by (id, userId), so
 * a collaborator holds an id without knowing whose it is. Ids are generated as
 * UUIDs and a duplicate across two owners has never been possible in practice,
 * but the schema permits it, so an ambiguous id resolves to nothing rather than
 * to somebody else's document.
 */
async function ownerCandidates(designId: string) {
  return db
    .select({
      ownerUserId: design.userId,
      linkAccess: design.linkAccess,
    })
    .from(design)
    .where(eq(design.id, designId))
    .limit(2)
}

/**
 * The viewer's standing on a design, or null when they have none. Every
 * design-scoped read and write goes through this: it is the only place that
 * decides whose rows an id refers to.
 */
export async function resolveDesignAccess(
  designId: string,
  viewer: DesignViewer,
): Promise<DesignAccess | null> {
  if (!designId) return null
  const candidates = await ownerCandidates(designId)
  if (candidates.length !== 1) return null
  const candidate = candidates[0]!

  if (candidate.ownerUserId === viewer.id) {
    return {
      designId,
      ownerUserId: viewer.id,
      role: 'owner',
      source: 'owner',
      linkAccess: candidate.linkAccess,
    }
  }

  const email = normalizeEmail(viewer.email)
  const share = await db
    .select({ role: designShare.role })
    .from(designShare)
    .where(
      and(
        eq(designShare.designId, designId),
        eq(designShare.ownerUserId, candidate.ownerUserId),
        or(eq(designShare.userId, viewer.id), eq(designShare.email, email)),
      ),
    )
    .limit(1)
    .then((rows) => rows[0])

  if (share) {
    return {
      designId,
      ownerUserId: candidate.ownerUserId,
      role: share.role,
      source: 'share',
      linkAccess: candidate.linkAccess,
    }
  }

  if (candidate.linkAccess === 'restricted') return null
  return {
    designId,
    ownerUserId: candidate.ownerUserId,
    role: candidate.linkAccess,
    source: 'link',
    linkAccess: candidate.linkAccess,
  }
}

/**
 * Binds an invitation to the account that turned up for it. Invitations are
 * written against an email, so the first visit is what connects them to a user
 * id — after that a change of address on either side cannot orphan the grant.
 */
export async function claimDesignShares(viewer: DesignViewer) {
  const email = normalizeEmail(viewer.email)
  if (!email) return
  await db
    .update(designShare)
    .set({ userId: viewer.id, acceptedAt: new Date() })
    .where(and(eq(designShare.email, email), isNull(designShare.userId)))
}

export interface DesignCollaborator {
  id: string
  email: string
  role: DesignShareRole
  name: string | null
  image: string | null
  userId: string | null
  acceptedAt: Date | null
  createdAt: Date
}

export async function listDesignCollaborators(
  designId: string,
  ownerUserId: string,
): Promise<DesignCollaborator[]> {
  return db
    .select({
      id: designShare.id,
      email: designShare.email,
      role: designShare.role,
      userId: designShare.userId,
      acceptedAt: designShare.acceptedAt,
      createdAt: designShare.createdAt,
      name: user.name,
      image: user.image,
    })
    .from(designShare)
    .leftJoin(user, eq(user.id, designShare.userId))
    .where(
      and(
        eq(designShare.designId, designId),
        eq(designShare.ownerUserId, ownerUserId),
      ),
    )
    .orderBy(designShare.createdAt)
}

/** Designs somebody else owns that this viewer has been let into. */
export async function listSharedDesigns(viewer: DesignViewer) {
  const email = normalizeEmail(viewer.email)
  return db
    .select({
      id: design.id,
      name: design.name,
      ownerUserId: design.userId,
      ownerName: user.name,
      ownerEmail: user.email,
      ownerImage: user.image,
      role: designShare.role,
      updatedAt: design.updatedAt,
      canvasVersion: design.canvasVersion,
    })
    .from(designShare)
    .innerJoin(
      design,
      and(
        eq(design.id, designShare.designId),
        eq(design.userId, designShare.ownerUserId),
      ),
    )
    .leftJoin(user, eq(user.id, design.userId))
    .where(
      and(
        or(eq(designShare.userId, viewer.id), eq(designShare.email, email)),
        // An owner's archive is theirs alone; it leaves everybody else's list.
        isNull(design.archivedAt),
      ),
    )
    .orderBy(design.updatedAt)
}
