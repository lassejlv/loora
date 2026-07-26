import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  migrateLegacyCanvas,
  type LegacyCanvasElement,
  type LegacyCanvasPage,
  type LegacyMigrationReport,
  type LegacyRenderResult,
} from '@loora/canvas/migration'
import type { CanvasDocumentV2 } from '@loora/canvas/model'
import {
  ElementFrame,
  awaitRenderResult,
  snapshotLegacyElement,
} from '#/components/element-frame'
import {
  renderComponentPng,
  visualSimilarity,
} from '#/lib/canvas-v2-capture'
import { orpc } from '#/lib/orpc-client'

export interface CanvasMigrationOutcome {
  revision: number
  document: CanvasDocumentV2
  reports: { target: string; report: LegacyMigrationReport }[]
}

async function renderLegacyElement(
  element: LegacyCanvasElement,
): Promise<LegacyRenderResult> {
  const runtimeId = `migration-${element.id}-${crypto.randomUUID()}`
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = `${element.w}px`
  host.style.height = `${element.h}px`
  host.style.pointerEvents = 'none'
  host.style.overflow = 'hidden'
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    root.render(
      createElement(
        'div',
        { style: { width: element.w, height: element.h } },
        createElement(ElementFrame, {
          elementId: element.id,
          frameId: runtimeId,
          code: element.code,
          interactive: false,
          networkRestricted: true,
        }),
      ),
    )
    const rendered = await awaitRenderResult(runtimeId, 10_000)
    if (!rendered?.ok) {
      throw new Error(
        rendered?.error
          ? `${element.name} could not render: ${rendered.error}`
          : `${element.name} did not finish rendering`,
      )
    }
    const snapshot = await snapshotLegacyElement(runtimeId, 8_000)
    if (!snapshot.root || !snapshot.png) {
      throw new Error(
        snapshot.error
          ? `${element.name} could not be captured for migration: ${snapshot.error}`
          : `${element.name} could not be captured for migration`,
      )
    }
    return {
      root: snapshot.root,
      png: snapshot.png,
      warnings: [],
    }
  } finally {
    root.unmount()
    host.remove()
  }
}

function dataUrlParts(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s)
  if (!match) throw new Error('Migration capture is not a base64 data URL')
  return { mediaType: match[1]!, data: match[2]! }
}

function createLegacyMigrationRunner() {
  const renderCache = new Map<string, Promise<LegacyRenderResult>>()
  const assetCache = new Map<string, Promise<string>>()
  const render = (element: LegacyCanvasElement) => {
    const key = `${element.w}:${element.h}:${element.code}`
    const existing = renderCache.get(key)
    if (existing) return existing.then((result) => structuredClone(result))
    const pending = renderLegacyElement(element)
    renderCache.set(key, pending)
    return pending.then((result) => structuredClone(result))
  }
  const storeFallbackImage = (
    element: LegacyCanvasElement,
    png: string,
  ) => {
    const existing = assetCache.get(png)
    if (existing) return existing
    const pending = (async () => {
      const { mediaType, data } = dataUrlParts(png)
      const saved = await orpc.asset.upload({
        name: `${element.name} migration fallback.png`,
        mediaType,
        data,
      })
      return `/api/asset/${saved.id}`
    })()
    assetCache.set(png, pending)
    return pending
  }
  const compare = async ({
    document,
    componentId,
    width,
    height,
    legacyPng,
  }: {
    document: CanvasDocumentV2
    componentId: string
    width: number
    height: number
    legacyPng: string
  }) => {
    const v2Png = await renderComponentPng(
      document,
      componentId,
      width,
      height,
    )
    return visualSimilarity(legacyPng, v2Png, width, height)
  }
  return (
    id: string,
    name: string,
    elements: LegacyCanvasElement[],
    pages: LegacyCanvasPage[],
  ) =>
    migrateLegacyCanvas(
      { id, name, elements, pages },
      {
        render,
        storeFallbackImage,
        compare,
        minimumSimilarity: 0.98,
      },
    )
}

export async function migrateCanvasDesign(
  designId: string,
  onProgress?: (message: string) => void,
): Promise<CanvasMigrationOutcome> {
  const leaseId = `migration-${crypto.randomUUID()}`
  const lease = await orpc.canvas.beginMigration({ designId, leaseId })
  if (!lease.acquired) {
    throw new Error('This design is being migrated in another tab. It will reopen automatically.')
  }
  if (lease.alreadyMigrated) {
    return {
      revision: lease.revision,
      document: lease.document,
      reports: [],
    }
  }

  let migrationCommitted = false
  let leaseFailure: unknown = null
  let latestRenewal: Promise<void> | null = null
  const renewLease = () => {
    if (latestRenewal) return latestRenewal
    latestRenewal = orpc.canvas
      .renewMigration({ designId, leaseId })
      .then(() => {
        leaseFailure = null
      })
      .catch((cause) => {
        leaseFailure = cause
      })
      .finally(() => {
        latestRenewal = null
      })
    return latestRenewal
  }
  const heartbeat = window.setInterval(() => {
    void renewLease()
  }, 30_000)

  try {
    const migrate = createLegacyMigrationRunner()

    onProgress?.('Migrating Main')
    const main = await migrate(
      lease.main.id,
      lease.main.name,
      lease.main.shapes,
      lease.main.pages,
    )
    const reports: CanvasMigrationOutcome['reports'] = [{
      target: 'Main',
      report: main.report,
    }]
    const drafts: {
      id: string
      sourceRevision: number
      document: CanvasDocumentV2
      baseDocument: CanvasDocumentV2
    }[] = []
    for (const draft of lease.drafts) {
      onProgress?.(`Migrating ${draft.name}`)
      const [current, base] = await Promise.all([
        migrate(designId, draft.name, draft.shapes, draft.pages),
        migrate(
          designId,
          `${draft.name} base`,
          draft.baseShapes,
          draft.basePages,
        ),
      ])
      drafts.push({
        id: draft.id,
        sourceRevision: draft.revision,
        document: current.document,
        baseDocument: base.document,
      })
      reports.push(
        { target: draft.name, report: current.report },
        { target: `${draft.name} base`, report: base.report },
      )
    }
    onProgress?.('Committing migration')
    await renewLease()
    if (leaseFailure) {
      throw new Error('The Canvas migration lease could not be renewed.')
    }
    const committed = await orpc.canvas.commitMigration({
      designId,
      leaseId,
      sourceRevision: lease.main.revision,
      document: main.document,
      drafts,
    })
    migrationCommitted = true
    return {
      revision: committed.revision,
      document: main.document,
      reports,
    }
  } finally {
    window.clearInterval(heartbeat)
    await latestRenewal
    if (!migrationCommitted) {
      await orpc.canvas.cancelMigration({ designId, leaseId }).catch(() => {})
    }
  }
}

export async function migrateCanvasVersion(
  target: { designId: string; draftId: string | null },
  versionId: string,
  onProgress?: (message: string) => void,
) {
  const source = await orpc.history.getForMigration({
    ...target,
    id: versionId,
  })
  if (source.status === 'ready') {
    return { document: source.document, report: null }
  }
  onProgress?.('Migrating historical checkpoint')
  const migrate = createLegacyMigrationRunner()
  const migrated = await migrate(
    target.designId,
    source.name,
    source.shapes,
    source.pages,
  )
  onProgress?.('Saving historical checkpoint')
  const committed = await orpc.history.commitMigration({
    ...target,
    id: versionId,
    document: migrated.document,
  })
  return {
    document: committed.document,
    report: migrated.report,
  }
}
