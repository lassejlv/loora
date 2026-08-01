import { ORPCError } from '@orpc/server'
import {
  and,
  desc,
  eq,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@loora/db'
import { asset } from '@loora/db/schema'
import { assetKey, assetUrl, s3 } from './storage'
import {
  ensureStorageRoom,
  protectedProcedure,
} from './procedures'

/**
 * The `asset` namespace: uploads, listing, deletion.
 */

export const MAX_ASSET_BYTES = 5 * 1024 * 1024

export const listAssets = protectedProcedure.handler(async ({ context }) => {
  const assets = await db
    .select({
      id: asset.id,
      name: asset.name,
      mediaType: asset.mediaType,
      size: asset.size,
      storageKey: asset.storageKey,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .where(eq(asset.userId, context.user.id))
    .orderBy(desc(asset.createdAt))

  return assets.map(({ createdAt, storageKey, ...a }) => ({
    ...a,
    url: assetUrl(a.id, storageKey),
    at: createdAt.getTime(),
  }))
})

export const uploadAsset = protectedProcedure
  .input(
    z.object({
      name: z.string().trim().min(1).max(200),
      mediaType: z.string().regex(/^image\/[\w.+-]+$/),
      data: z.string().min(1), // base64, no data: prefix
    }),
  )
  .handler(async ({ context, input }) => {
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new ORPCError('PAYLOAD_TOO_LARGE', { message: 'Assets are capped at 5MB.' })
    }
    // Plan storage (Free 1 GB / Pro 50 GB) before writing to S3 so a rejected
    // upload never leaves an orphan object.
    await ensureStorageRoom(context.user, bytes.length)
    const id = `a${crypto.randomUUID().replaceAll('-', '')}`

    let storageKey: string | null = null
    if (s3) {
      storageKey = assetKey(context.user.id, id)
      await s3.write(storageKey, bytes, { type: input.mediaType })
    }

    const [saved] = await db
      .insert(asset)
      .values({
        id,
        userId: context.user.id,
        name: input.name,
        mediaType: input.mediaType,
        size: bytes.length,
        storageKey,
        data: storageKey ? null : input.data,
      })
      .returning({ id: asset.id, name: asset.name, mediaType: asset.mediaType, size: asset.size })

    return { ...saved, url: assetUrl(id, storageKey) }
  })

export const deleteAsset = protectedProcedure
  .input(z.object({ id: z.string().min(1).max(128) }))
  .handler(async ({ context, input }) => {
    const deleted = await db
      .delete(asset)
      .where(and(eq(asset.id, input.id), eq(asset.userId, context.user.id)))
      .returning({ id: asset.id, storageKey: asset.storageKey })

    const key = deleted[0]?.storageKey
    if (key && s3) {
      await s3.delete(key).catch((error) => console.error('[assets] S3 delete failed:', error))
    }
    return { deleted: deleted.length > 0 }
  })
