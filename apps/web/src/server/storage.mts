import { env } from 'cloudflare:workers'
import { assetRouteUrl } from '@loora/rpc/asset-url'

class R2StoredFile {
  constructor(private readonly key: string) {}

  async arrayBuffer() {
    const object = await env.ASSETS_BUCKET.get(this.key)
    if (!object) throw new Error(`Stored object not found: ${this.key}`)
    return object.arrayBuffer()
  }
}

export const s3 = {
  file(key: string) {
    return new R2StoredFile(key)
  },
  async write(key: string, data: Uint8Array, options?: { type?: string }) {
    await env.ASSETS_BUCKET.put(key, data, {
      httpMetadata: options?.type ? { contentType: options.type } : undefined,
    })
    return data.byteLength
  },
  async delete(key: string) {
    await env.ASSETS_BUCKET.delete(key)
  },
}

export { assetKey, assetRouteUrl, assetIdFromSrc } from '@loora/rpc/asset-url'

const publicBase =
  process.env.S3_PUBLIC_URL?.trim().replace(/\/+$/, '') || null

export function assetPublicUrl(storageKey: string | null | undefined) {
  if (!publicBase || !storageKey) return null
  return `${publicBase}/${storageKey.split('/').map(encodeURIComponent).join('/')}`
}

export function assetUrl(
  assetId: string,
  storageKey: string | null | undefined,
) {
  return assetPublicUrl(storageKey) ?? assetRouteUrl(assetId)
}
