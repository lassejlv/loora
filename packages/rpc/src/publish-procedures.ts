import { ORPCError } from '@orpc/server'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { compileStandaloneHtml } from '@loora/canvas/export'
import { db } from '@loora/db'
import {
  asset,
  design,
  publishedSite,
  user,
} from '@loora/db/schema'
import type { CanvasDocument } from '@loora/canvas/model'
import { assetIdFromSrc } from './asset-url'
import {
  assertHandle,
  assertSlug,
  normalizeHandle,
  normalizeSlug,
  sitePublicPath,
  siteStorageKey,
} from './publish-slug'
import {
  protectedProcedure,
  requireDesignAccess,
} from './procedures'
import { rateLimit, rateLimits } from './rate-limit'
import { assetPublicUrl, s3 } from './storage'

const SAFE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function siteSummary(row: {
  id: string
  designId: string
  pageId: string
  handle: string
  slug: string
  title: string
  publishedAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    designId: row.designId,
    pageId: row.pageId,
    handle: row.handle,
    slug: row.slug,
    title: row.title,
    path: sitePublicPath(row.handle, row.slug),
    publishedAt: row.publishedAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

async function requireOwnerHandle(userId: string) {
  const [account] = await db
    .select({ handle: user.handle })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!account?.handle) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Set a public handle in Settings before publishing.',
    })
  }
  return account.handle
}

/**
 * Rewrite image srcs to public HTTPS URLs when the bucket is public; otherwise
 * inline them as data URLs so anonymous visitors are not sent to /api/asset.
 */
async function resolvePublishAssetMap(
  userId: string,
  document: CanvasDocument,
) {
  const images = Object.values(document.nodes).filter(
    (node) => node.type === 'image',
  )
  const ids = [
    ...new Set(
      images
        .map((node) => assetIdFromSrc(node.src))
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const rows = await db
    .select({
      id: asset.id,
      data: asset.data,
      storageKey: asset.storageKey,
      mediaType: asset.mediaType,
    })
    .from(asset)
    .where(and(eq(asset.userId, userId), inArray(asset.id, ids)))

  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const image of images) {
    if (image.src.startsWith('data:') || image.src.startsWith('https://')) {
      continue
    }
    const id = assetIdFromSrc(image.src)
    if (!id) continue
    const row = byId.get(id)
    if (!row) continue
    const publicUrl = assetPublicUrl(row.storageKey)
    if (publicUrl) {
      map.set(image.src, publicUrl)
      continue
    }
    if (!SAFE_IMAGE_TYPES.has(row.mediaType)) continue
    let bytes: Buffer | null = null
    if (row.data) {
      bytes = Buffer.from(row.data, 'base64')
    } else if (row.storageKey && s3) {
      bytes = Buffer.from(await s3.file(row.storageKey).arrayBuffer())
    }
    if (!bytes || bytes.byteLength === 0) continue
    map.set(
      image.src,
      `data:${row.mediaType};base64,${bytes.toString('base64')}`,
    )
  }
  return map
}

export const getPublishHandle = protectedProcedure.handler(async ({ context }) => {
  const [account] = await db
    .select({ handle: user.handle })
    .from(user)
    .where(eq(user.id, context.user.id))
    .limit(1)
  return { handle: account?.handle ?? null }
})

export const setPublishHandle = protectedProcedure
  .input(z.object({ handle: z.string().min(1).max(64) }))
  .handler(async ({ context, input }) => {
    let handle: string
    try {
      handle = assertHandle(input.handle)
    } catch (cause) {
      throw new ORPCError('BAD_REQUEST', {
        message: cause instanceof Error ? cause.message : 'Invalid handle.',
      })
    }

    const [other] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.handle, handle))
      .limit(1)
    if (other && other.id !== context.user.id) {
      throw new ORPCError('CONFLICT', { message: 'That handle is taken.' })
    }

    const [previous] = await db
      .select({ handle: user.handle })
      .from(user)
      .where(eq(user.id, context.user.id))
      .limit(1)
    const previousHandle = previous?.handle ?? null

    try {
      await db
        .update(user)
        .set({ handle, updatedAt: new Date() })
        .where(eq(user.id, context.user.id))
    } catch {
      throw new ORPCError('CONFLICT', { message: 'That handle is taken.' })
    }

    if (previousHandle && previousHandle !== handle) {
      const sites = await db
        .select()
        .from(publishedSite)
        .where(eq(publishedSite.userId, context.user.id))
      for (const site of sites) {
        const nextKey = siteStorageKey(handle, site.slug)
        if (s3 && site.storageKey !== nextKey) {
          const bytes = new Uint8Array(
            await s3.file(site.storageKey).arrayBuffer(),
          )
          await s3.write(nextKey, bytes, {
            type: 'text/html; charset=utf-8',
          })
          await s3.delete(site.storageKey).catch(() => undefined)
        }
        await db
          .update(publishedSite)
          .set({
            handle,
            storageKey: nextKey,
            updatedAt: new Date(),
          })
          .where(eq(publishedSite.id, site.id))
      }
    }

    return { handle }
  })

export const listPublishedSites = protectedProcedure
  .input(
    z
      .object({
        designId: z.string().min(1).max(128).optional(),
      })
      .optional(),
  )
  .handler(async ({ context, input }) => {
    const rows = input?.designId
      ? await db
          .select()
          .from(publishedSite)
          .where(
            and(
              eq(publishedSite.userId, context.user.id),
              eq(publishedSite.designId, input.designId),
            ),
          )
      : await db
          .select()
          .from(publishedSite)
          .where(eq(publishedSite.userId, context.user.id))
    return rows.map(siteSummary)
  })

export const publishPage = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      pageId: z.string().min(1).max(128),
      slug: z.string().min(1).max(64).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const decision = await rateLimit(
      'publish',
      `user:${context.user.id}`,
      rateLimits.publish,
    )
    if (!decision.ok) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: 'Too many publish requests. Try again shortly.',
      })
    }

    if (!s3) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Publishing requires object storage to be configured.',
      })
    }

    const access = await requireDesignAccess(
      context.user,
      input.designId,
      'edit',
    )
    if (access.role !== 'owner') {
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the design owner can publish a page.',
      })
    }

    const handle = await requireOwnerHandle(context.user.id)

    const [row] = await db
      .select({
        document: design.canvasDocument,
        name: design.name,
      })
      .from(design)
      .where(
        and(eq(design.id, input.designId), eq(design.userId, context.user.id)),
      )
      .limit(1)
    if (!row?.document) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'This design has no Canvas document to publish.',
      })
    }

    const page = row.document.nodes[input.pageId]
    if (!page || page.type !== 'page') {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Choose a Page to publish.',
      })
    }

    let slug: string
    try {
      slug = assertSlug(input.slug ?? (page.name || row.name || 'page'))
    } catch (cause) {
      throw new ORPCError('BAD_REQUEST', {
        message: cause instanceof Error ? cause.message : 'Invalid slug.',
      })
    }

    const [existingForPage] = await db
      .select()
      .from(publishedSite)
      .where(
        and(
          eq(publishedSite.designId, input.designId),
          eq(publishedSite.pageId, input.pageId),
        ),
      )
      .limit(1)

    // Keep the slug on republish unless the caller asked for a new one.
    if (existingForPage && !input.slug) {
      slug = existingForPage.slug
    }

    const [slugTaken] = await db
      .select({ id: publishedSite.id, pageId: publishedSite.pageId })
      .from(publishedSite)
      .where(
        and(eq(publishedSite.handle, handle), eq(publishedSite.slug, slug)),
      )
      .limit(1)
    if (slugTaken && slugTaken.pageId !== input.pageId) {
      throw new ORPCError('CONFLICT', {
        message: 'That slug is already used by another published page.',
      })
    }

    const assetMap = await resolvePublishAssetMap(
      context.user.id,
      row.document,
    )
    const title = page.name || row.name || 'Untitled'
    const html = compileStandaloneHtml(row.document, {
      pageId: input.pageId,
      title,
      assetUrl: (src) => assetMap.get(src) ?? src,
    })

    if (html.includes('/api/asset/')) {
      throw new ORPCError('BAD_REQUEST', {
        message:
          'Some images could not be made public. Re-upload them or try again.',
      })
    }

    const storageKey = siteStorageKey(handle, slug)
    const bytes = new TextEncoder().encode(html)
    await s3.write(storageKey, bytes, { type: 'text/html; charset=utf-8' })

    const now = new Date()
    if (existingForPage) {
      // Slug change: drop the previous object so the old URL 404s.
      if (existingForPage.storageKey !== storageKey) {
        await s3.delete(existingForPage.storageKey).catch(() => undefined)
      }
      const [updated] = await db
        .update(publishedSite)
        .set({
          handle,
          slug,
          storageKey,
          title,
          updatedAt: now,
        })
        .where(eq(publishedSite.id, existingForPage.id))
        .returning()
      return siteSummary(updated!)
    }

    const id = `ps_${crypto.randomUUID().replaceAll('-', '')}`
    const [created] = await db
      .insert(publishedSite)
      .values({
        id,
        userId: context.user.id,
        designId: input.designId,
        pageId: input.pageId,
        handle,
        slug,
        storageKey,
        title,
        publishedAt: now,
        updatedAt: now,
      })
      .returning()
    return siteSummary(created!)
  })

export const unpublishPage = protectedProcedure
  .input(
    z.object({
      designId: z.string().min(1).max(128),
      pageId: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ context, input }) => {
    const access = await requireDesignAccess(
      context.user,
      input.designId,
      'edit',
    )
    if (access.role !== 'owner') {
      throw new ORPCError('FORBIDDEN', {
        message: 'Only the design owner can unpublish a page.',
      })
    }

    const [row] = await db
      .select()
      .from(publishedSite)
      .where(
        and(
          eq(publishedSite.userId, context.user.id),
          eq(publishedSite.designId, input.designId),
          eq(publishedSite.pageId, input.pageId),
        ),
      )
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND')

    if (s3) {
      await s3.delete(row.storageKey).catch(() => undefined)
    }
    await db.delete(publishedSite).where(eq(publishedSite.id, row.id))
    return { ok: true as const }
  })

/** Used by the public `/sites/$handle/$slug` route. */
export async function loadPublishedSiteHtml(handle: string, slug: string) {
  const normalizedHandle = normalizeHandle(handle)
  const normalizedSlug = normalizeSlug(slug)
  if (!normalizedHandle || !normalizedSlug) return null

  const [row] = await db
    .select({
      storageKey: publishedSite.storageKey,
      title: publishedSite.title,
    })
    .from(publishedSite)
    .where(
      and(
        eq(publishedSite.handle, normalizedHandle),
        eq(publishedSite.slug, normalizedSlug),
      ),
    )
    .limit(1)
  if (!row || !s3) return null

  try {
    const bytes = new Uint8Array(await s3.file(row.storageKey).arrayBuffer())
    return {
      html: new TextDecoder().decode(bytes),
      title: row.title,
    }
  } catch {
    return null
  }
}
