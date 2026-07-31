/**
 * One-shot backfill for documents that still point at `/api/asset/<id>` after a
 * public bucket domain (S3_PUBLIC_URL) was configured. Dry run by default:
 *
 *   bun run assets:backfill-urls                     # report every affected design
 *   bun run assets:backfill-urls --design <designId>
 *   bun run assets:backfill-urls --user <userId>
 *   bun run assets:backfill-urls --apply             # write the rewrites
 *
 * Main and every branch document are rewritten together, each behind a
 * compare-and-swap on the revision it was read at, so a design someone is
 * editing right now is skipped rather than clobbered. Version snapshots are
 * left untouched — they are the audit trail of what was actually saved, and the
 * old route keeps serving them.
 *
 * An asset still held as base64 in the asset table (no storage key) has nothing
 * public to point at, so references to it are left alone.
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designDraft } from '@loora/db/schema'
import {
  CANVAS_SCHEMA_VERSION,
  parseCanvasDocument,
  type CanvasDocument,
} from '@loora/canvas/model'
import { ASSET_ROUTE_PREFIX, assetIdFromSrc } from '../src/asset-url'
import { assetPublicUrl } from '../src/storage'

function flag(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : process.argv[index + 1] ?? null
}

const apply = process.argv.includes('--apply')
const designFilter = flag('design')
const userFilter = flag('user')

if (!assetPublicUrl('assets/probe/probe')) {
  console.error('S3_PUBLIC_URL is not set — there is no public URL to backfill to.')
  process.exit(1)
}

// Every asset that has bytes in the bucket, by id. Assets are user-scoped but a
// shared design can carry a collaborator's asset, so the lookup is not.
const publicUrls = new Map<string, string>()
for (const row of await db
  .select({ id: asset.id, storageKey: asset.storageKey })
  .from(asset)
  .where(isNotNull(asset.storageKey))) {
  const url = assetPublicUrl(row.storageKey)
  if (url) publicUrls.set(row.id, url)
}

let rewrittenReferences = 0

/**
 * Swaps every `/api/asset/<id>` string in the document — image sources, fills,
 * interaction URLs — for the asset's public URL.
 */
function rewriteValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (!value.startsWith(ASSET_ROUTE_PREFIX)) return value
    const id = assetIdFromSrc(value)
    const url = id ? publicUrls.get(id) : null
    if (!url) return value
    rewrittenReferences += 1
    return url
  }
  if (Array.isArray(value)) return value.map(rewriteValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        rewriteValue(item),
      ]),
    )
  }
  return value
}

interface Rewritten {
  document: CanvasDocument
  references: number
}

/** Rewrites and revalidates a stored document, or null when nothing changed. */
function rewrite(stored: unknown, now: number): Rewritten | null {
  const source = parseCanvasDocument(stored)
  const before = rewrittenReferences
  const rewrittenDocument = rewriteValue(source) as CanvasDocument
  const references = rewrittenReferences - before
  if (references === 0) return null
  const document: CanvasDocument = {
    ...rewrittenDocument,
    metadata: { ...rewrittenDocument.metadata, updatedAt: now },
  }
  return {
    // Revalidate before it goes anywhere near the database.
    document: parseCanvasDocument(document),
    references,
  }
}

const designs = await db
  .select({
    id: design.id,
    userId: design.userId,
    name: design.name,
    version: design.canvasVersion,
    revision: design.revision,
    document: design.canvasDocument,
  })
  .from(design)
  .where(
    designFilter
      ? eq(design.id, designFilter)
      : userFilter
        ? eq(design.userId, userFilter)
        : undefined,
  )

let scanned = 0
let touched = 0
let skipped = 0
let references = 0

for (const row of designs) {
  scanned += 1
  const now = Date.now()
  const mainRewrite =
    row.version === CANVAS_SCHEMA_VERSION && row.document ? rewrite(row.document, now) : null

  const drafts = await db
    .select({
      id: designDraft.id,
      name: designDraft.name,
      status: designDraft.status,
      version: designDraft.canvasVersion,
      baseVersion: designDraft.baseCanvasVersion,
      revision: designDraft.revision,
      document: designDraft.canvasDocument,
      baseDocument: designDraft.baseCanvasDocument,
    })
    .from(designDraft)
    .where(and(eq(designDraft.designId, row.id), eq(designDraft.userId, row.userId)))

  const draftRewrites = drafts
    .map((draft) => ({
      draft,
      current:
        draft.version === CANVAS_SCHEMA_VERSION && draft.document
          ? rewrite(draft.document, now)
          : null,
      base:
        draft.baseVersion === CANVAS_SCHEMA_VERSION && draft.baseDocument
          ? rewrite(draft.baseDocument, now)
          : null,
    }))
    .filter((entry) => entry.current || entry.base)

  if (!mainRewrite && draftRewrites.length === 0) continue

  const changed =
    (mainRewrite?.references ?? 0) +
    draftRewrites.reduce(
      (total, entry) => total + (entry.current?.references ?? 0) + (entry.base?.references ?? 0),
      0,
    )
  references += changed
  const detail = [
    mainRewrite ? `main ${mainRewrite.references}` : null,
    ...draftRewrites.map(
      (entry) =>
        `branch "${entry.draft.name}" ${(entry.current?.references ?? 0) + (entry.base?.references ?? 0)}`,
    ),
  ]
    .filter(Boolean)
    .join(', ')
  console.log(`${row.id}  ${row.name}  —  ${detail}`)

  if (!apply) continue

  const written = await db.transaction(async (tx) => {
    if (mainRewrite) {
      const [updated] = await tx
        .update(design)
        .set({
          canvasDocument: mainRewrite.document,
          revision: row.revision + 1,
          updatedAt: new Date(now),
        })
        .where(
          and(
            eq(design.id, row.id),
            eq(design.userId, row.userId),
            eq(design.revision, row.revision),
          ),
        )
        .returning({ id: design.id })
      if (!updated) return false
    }
    for (const entry of draftRewrites) {
      const [updated] = await tx
        .update(designDraft)
        .set({
          ...(entry.current
            ? { canvasDocument: entry.current.document, revision: entry.draft.revision + 1 }
            : {}),
          ...(entry.base ? { baseCanvasDocument: entry.base.document } : {}),
          updatedAt: new Date(now),
        })
        .where(
          and(
            eq(designDraft.id, entry.draft.id),
            eq(designDraft.userId, row.userId),
            eq(designDraft.revision, entry.draft.revision),
          ),
        )
        .returning({ id: designDraft.id })
      if (!updated) return false
    }
    return true
  })

  if (written) touched += 1
  else {
    skipped += 1
    console.log(`  skipped — ${row.id} changed while it was being rewritten; run again`)
  }
}

console.log(
  apply
    ? `\nScanned ${scanned} designs, rewrote ${touched}, skipped ${skipped}, ${references} asset references.` +
        '\nOpen editors are now a revision behind and will resync on reload.'
    : `\nScanned ${scanned} designs, ${references} asset references would change. Re-run with --apply to write.`,
)

process.exit(0)
