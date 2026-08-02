/**
 * Handle and slug rules for `/sites/<handle>/<slug>`. Pure helpers so the
 * public route, RPC, and tests share one definition.
 */

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/** Path segments that must never be claimed as a handle. */
export const RESERVED_HANDLES = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'callback',
  'design',
  'desktop',
  'docs',
  'features',
  'handoff',
  'login',
  'loora',
  'mcp',
  'pricing',
  'privacy',
  'settings',
  'share',
  'sites',
  'static',
  'status',
  'support',
  'terms',
  'www',
])

export function normalizeHandle(value: string) {
  return value.trim().toLowerCase()
}

export function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function isValidHandle(value: string) {
  const handle = normalizeHandle(value)
  return (
    handle.length >= 3 &&
    handle.length <= 32 &&
    HANDLE_RE.test(handle) &&
    !RESERVED_HANDLES.has(handle)
  )
}

export function isValidSlug(value: string) {
  const slug = normalizeSlug(value)
  return slug.length >= 1 && slug.length <= 64 && SLUG_RE.test(slug)
}

export function assertHandle(value: string) {
  const handle = normalizeHandle(value)
  if (!isValidHandle(handle)) {
    throw new Error(
      'Handle must be 3–32 characters: lowercase letters, numbers, and hyphens.',
    )
  }
  return handle
}

export function assertSlug(value: string) {
  const slug = normalizeSlug(value)
  if (!isValidSlug(slug)) {
    throw new Error(
      'Slug must be 1–64 characters: lowercase letters, numbers, and hyphens.',
    )
  }
  return slug
}

export function siteStorageKey(handle: string, slug: string) {
  return `sites/${handle}/${slug}/index.html`
}

export function sitePublicPath(handle: string, slug: string) {
  return `/sites/${handle}/${slug}`
}
