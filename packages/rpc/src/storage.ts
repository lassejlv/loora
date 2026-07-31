// Asset blob storage on Bun's built-in S3 client (R2 bucket), configured from
// S3_* env vars. When the client is unavailable — no bucket configured or a
// non-Bun runtime — callers fall back to base64 in the asset table's `data`.

import { assetRouteUrl } from './asset-url'

export { assetKey, assetRouteUrl, assetIdFromSrc } from './asset-url'

interface BunS3File {
  arrayBuffer(): Promise<ArrayBuffer>
}

interface BunS3Client {
  file(key: string): BunS3File
  write(key: string, data: Uint8Array, options?: { type?: string }): Promise<number>
  delete(key: string): Promise<void>
}

declare const Bun:
  | {
      S3Client?: new (options: {
        accessKeyId: string
        secretAccessKey: string
        bucket: string
        endpoint: string
        region?: string
      }) => BunS3Client
    }
  | undefined

function createClient(): BunS3Client | null {
  if (typeof Bun === 'undefined' || !Bun?.S3Client) return null
  const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_ENDPOINT } = process.env
  if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET || !S3_ENDPOINT) return null
  return new Bun.S3Client({
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    bucket: S3_BUCKET,
    endpoint: S3_ENDPOINT,
    region: process.env.S3_REGION,
  })
}

export const s3 = createClient()

// Public bucket domain (an R2 custom domain). With it set, image nodes point
// straight at the object and the browser never round-trips through the app;
// without it they keep going through the authenticated /api/asset route.
const publicBase = process.env.S3_PUBLIC_URL?.trim().replace(/\/+$/, '') || null

export function assetPublicUrl(storageKey: string | null | undefined) {
  if (!publicBase || !storageKey) return null
  return `${publicBase}/${storageKey.split('/').map(encodeURIComponent).join('/')}`
}

/** The URL an image node should carry for a stored asset. */
export function assetUrl(assetId: string, storageKey: string | null | undefined) {
  return assetPublicUrl(storageKey) ?? assetRouteUrl(assetId)
}
