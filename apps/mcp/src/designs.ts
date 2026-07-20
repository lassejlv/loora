import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '@loora/db'
import { asset, design, designVersion } from '@loora/db/schema'
import type { CanvasElement } from '@loora/db/canvas'

// Mirrors the oRPC shape limits (packages/rpc/src/router.ts) so anything the
// MCP server writes stays loadable and saveable by the web app.
export const MAX_ELEMENTS = 10_000
export const MAX_CODE_LENGTH = 200_000
export const MAX_NAME_LENGTH = 200

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now().toString(36)}${counter}`
}

export const newDesignId = () => `d${suffix()}`
export const newElementId = () => `e${suffix()}`

export async function listDesigns(userId: string) {
  const rows = await db
    .select({ id: design.id, name: design.name, updatedAt: design.updatedAt })
    .from(design)
    .where(eq(design.userId, userId))
    .orderBy(asc(design.createdAt))
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
}

export async function getDesign(userId: string, id: string) {
  const [found] = await db
    .select({ id: design.id, name: design.name, shapes: design.shapes, updatedAt: design.updatedAt })
    .from(design)
    .where(and(eq(design.id, id), eq(design.userId, userId)))
    .limit(1)
  if (!found) throw new Error(`Design "${id}" not found`)
  return found
}

export async function saveShapes(userId: string, id: string, shapes: CanvasElement[]) {
  if (shapes.length > MAX_ELEMENTS) {
    throw new Error(`Designs are capped at ${MAX_ELEMENTS} elements`)
  }
  await db
    .update(design)
    .set({ shapes, updatedAt: new Date() })
    .where(and(eq(design.id, id), eq(design.userId, userId)))
}

export async function createDesign(userId: string, name: string) {
  const [created] = await db
    .insert(design)
    .values({ id: newDesignId(), userId, name, shapes: [] })
    .returning({ id: design.id, name: design.name })
  return created
}

export async function renameDesign(userId: string, id: string, name: string) {
  const updated = await db
    .update(design)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(design.id, id), eq(design.userId, userId)))
    .returning({ id: design.id, name: design.name })
  if (updated.length === 0) throw new Error(`Design "${id}" not found`)
  return updated[0]
}

export async function deleteDesign(userId: string, id: string) {
  const deleted = await db
    .delete(design)
    .where(and(eq(design.id, id), eq(design.userId, userId)))
    .returning({ id: design.id })
  return deleted.length > 0
}

export async function listVersions(userId: string, designId: string, limit: number) {
  const rows = await db
    .select({
      id: designVersion.id,
      message: designVersion.message,
      added: designVersion.added,
      removed: designVersion.removed,
      changed: designVersion.changed,
      createdAt: designVersion.createdAt,
    })
    .from(designVersion)
    .where(and(eq(designVersion.designId, designId), eq(designVersion.userId, userId)))
    .orderBy(desc(designVersion.createdAt), desc(designVersion.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function listAssets(userId: string) {
  const rows = await db
    .select({
      id: asset.id,
      name: asset.name,
      mediaType: asset.mediaType,
      size: asset.size,
      createdAt: asset.createdAt,
    })
    .from(asset)
    .where(eq(asset.userId, userId))
    .orderBy(desc(asset.createdAt))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export function summarizeElement(element: CanvasElement) {
  const { code, ...rest } = element
  const firstLine = code.split('\n', 1)[0] ?? ''
  return {
    ...rest,
    codeLength: code.length,
    codePreview: firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine,
  }
}

export function searchElements(shapes: CanvasElement[], query: string, maxMatches = 50) {
  const needle = query.toLowerCase()
  const matches: { elementId: string; elementName: string; line: number; text: string }[] = []
  for (const shape of shapes) {
    const lines = shape.code.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue
      matches.push({
        elementId: shape.id,
        elementName: shape.name,
        line: i + 1,
        text: lines[i].trim().slice(0, 200),
      })
      if (matches.length >= maxMatches) return { matches, truncated: true }
    }
  }
  return { matches, truncated: false }
}
