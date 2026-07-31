// Asset URL shapes, shared by server and client. An asset object lives under
// `assets/<userId>/<assetId>` in the bucket, so both the authenticated
// `/api/asset/<id>` route and a public bucket URL carry the asset id — anything
// that has to recognise a stored asset (paste import, handoff, screenshots)
// reads it back with `assetIdFromSrc`.
//
// No env, no runtime dependencies: this module is safe in a browser bundle.

export const ASSET_ROUTE_PREFIX = '/api/asset/'

/** `a` + a hyphen-stripped UUID, as minted by the upload procedure. */
const ASSET_ID = /^a[0-9a-f]{32}$/

export function assetKey(userId: string, assetId: string) {
  return `assets/${userId}/${assetId}`
}

export function assetRouteUrl(assetId: string) {
  return `${ASSET_ROUTE_PREFIX}${encodeURIComponent(assetId)}`
}

function decode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * The asset id behind an image src, whether it points at the API route or at a
 * public bucket URL. Returns null for anything else — a data URL, or an image
 * hosted somewhere that is not ours.
 */
export function assetIdFromSrc(src: string): string | null {
  const path = src.startsWith('/') ? src : pathname(src)
  if (!path) return null
  if (path.startsWith(ASSET_ROUTE_PREFIX)) {
    const id = decode(path.slice(ASSET_ROUTE_PREFIX.length))
    return id && !id.includes('/') ? id : null
  }
  // Public bucket object. The id pattern keeps an unrelated remote URL that
  // happens to have an `/assets/x/y` path from reading as one of ours.
  const match = /\/assets\/[^/]+\/([^/]+)$/.exec(path)
  const id = match?.[1] ? decode(match[1]) : null
  return id && ASSET_ID.test(id) ? id : null
}

function pathname(value: string) {
  try {
    return new URL(value).pathname
  } catch {
    return null
  }
}
