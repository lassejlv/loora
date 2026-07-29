/**
 * One-shot repair for documents whose inserted nodes were pinned to `absolute`
 * at their parent's origin (see repairStackedLayout). Dry run by default:
 *
 *   bun run canvas:repair-layout                     # report every affected design
 *   bun run canvas:repair-layout --design <designId>
 *   bun run canvas:repair-layout --user <userId>
 *   bun run canvas:repair-layout --apply             # write the repairs
 *
 * Main and every branch document are repaired together, each behind a
 * compare-and-swap on the revision it was read at, so a design someone is
 * editing right now is skipped rather than clobbered. Version snapshots are
 * left untouched — they are the audit trail of what was actually saved.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { design, designDraft } from '@loora/db/schema'
import { repairStackedLayout } from '@loora/agent/repair-layout'
import {
  CANVAS_SCHEMA_VERSION,
  parseCanvasDocument,
  type CanvasDocument,
} from '@loora/canvas/model'

function flag(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : process.argv[index + 1] ?? null
}

const apply = process.argv.includes('--apply')
const designFilter = flag('design')
const userFilter = flag('user')

interface Repaired {
  document: CanvasDocument
  flowed: number
  unboxed: number
}

/** Repairs and revalidates a stored document, or null when nothing changed. */
function repair(stored: unknown, now: number): Repaired | null {
  const source = parseCanvasDocument(stored)
  const result = repairStackedLayout(source)
  if (result.flowed.length === 0) return null
  const document: CanvasDocument = {
    ...result.document,
    metadata: { ...result.document.metadata, updatedAt: now },
  }
  return {
    // Revalidate before it goes anywhere near the database.
    document: parseCanvasDocument(document),
    flowed: result.flowed.length,
    unboxed: result.unboxed.length,
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
let nodes = 0

for (const row of designs) {
  scanned += 1
  const now = Date.now()
  const mainRepair =
    row.version === CANVAS_SCHEMA_VERSION && row.document ? repair(row.document, now) : null

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

  const draftRepairs = drafts.map((draft) => ({
    draft,
    current:
      draft.version === CANVAS_SCHEMA_VERSION && draft.document
        ? repair(draft.document, now)
        : null,
    base:
      draft.baseVersion === CANVAS_SCHEMA_VERSION && draft.baseDocument
        ? repair(draft.baseDocument, now)
        : null,
  })).filter((entry) => entry.current || entry.base)

  if (!mainRepair && draftRepairs.length === 0) continue

  const changed =
    (mainRepair?.flowed ?? 0) +
    draftRepairs.reduce(
      (total, entry) => total + (entry.current?.flowed ?? 0) + (entry.base?.flowed ?? 0),
      0,
    )
  nodes += changed
  const detail = [
    mainRepair ? `main ${mainRepair.flowed} flowed / ${mainRepair.unboxed} unboxed` : null,
    ...draftRepairs.map(
      (entry) =>
        `branch "${entry.draft.name}" ${(entry.current?.flowed ?? 0) + (entry.base?.flowed ?? 0)} flowed`,
    ),
  ]
    .filter(Boolean)
    .join(', ')
  console.log(`${row.id}  ${row.name}  —  ${detail}`)

  if (!apply) continue

  const written = await db.transaction(async (tx) => {
    if (mainRepair) {
      const [updated] = await tx
        .update(design)
        .set({
          canvasDocument: mainRepair.document,
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
    for (const entry of draftRepairs) {
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
    console.log(`  skipped — ${row.id} changed while it was being repaired; run again`)
  }
}

console.log(
  apply
    ? `\nScanned ${scanned} designs, repaired ${touched}, skipped ${skipped}, ${nodes} nodes flowed.` +
        '\nOpen editors are now a revision behind and will resync on reload.'
    : `\nScanned ${scanned} designs, ${nodes} nodes would flow. Re-run with --apply to write.`,
)

process.exit(0)
