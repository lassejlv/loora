import { existsSync } from 'node:fs'
import { and, eq, inArray } from 'drizzle-orm'
import {
  chromium,
  type Browser,
  type ElementHandle,
} from 'playwright-core'
import { db } from '@loora/db'
import { asset } from '@loora/db/schema'
import { compileStandaloneHtml } from '@loora/canvas/export'
import {
  orderedChildren,
  type CanvasDocument,
  type NodeId,
  type NodeRef,
} from '@loora/canvas/model'
import { readCanvasNodeRef } from '@loora/agent/canvas-tools'
import { s3 } from '@loora/rpc/storage'

const BLANK_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const MAX_ASSET_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 30 * 1024 * 1024
const MAX_ASSET_COUNT = 50
const MAX_SCREENSHOT_DIMENSION = 4_096
const MAX_SCREENSHOT_AREA = 12_000_000
const MAX_PNG_BYTES = 8 * 1024 * 1024
const SAFE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

interface LoadedAsset {
  data: string
  mediaType: string
}

export interface CanvasScreenshotOptions {
  pageId?: NodeId
  ref?: NodeRef
  width?: number
  pixelRatio?: number
}

export interface CanvasScreenshot {
  png: Uint8Array
  width: number
  height: number
  pageId: NodeId | null
  ref: NodeRef | null
  skippedImages: string[]
}

function localAssetId(source: string) {
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return null
    }
  }
  if (source.startsWith('/api/asset/')) {
    const id = source.slice('/api/asset/'.length)
    return id && !id.includes('/') ? decode(id) : null
  }
  try {
    const url = new URL(source)
    const match = /^\/api\/asset\/([^/]+)$/.exec(url.pathname)
    return match?.[1] ? decode(match[1]) : null
  } catch {
    return null
  }
}

async function loadAssets(userId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, LoadedAsset>()
  const rows = await db
    .select({
      id: asset.id,
      data: asset.data,
      storageKey: asset.storageKey,
      mediaType: asset.mediaType,
      size: asset.size,
    })
    .from(asset)
    .where(
      and(
        eq(asset.userId, userId),
        inArray(asset.id, ids.slice(0, MAX_ASSET_COUNT)),
      ),
    )
  const output = new Map<string, LoadedAsset>()
  let remainingBytes = MAX_TOTAL_ASSET_BYTES
  for (const row of rows) {
    if (
      row.size > MAX_ASSET_BYTES ||
      row.size > remainingBytes ||
      !SAFE_IMAGE_TYPES.has(row.mediaType)
    ) {
      continue
    }
    if (row.data) {
      output.set(row.id, { data: row.data, mediaType: row.mediaType })
      remainingBytes -= row.size
      continue
    }
    if (!row.storageKey || !s3) continue
    const bytes = new Uint8Array(
      await s3.file(row.storageKey).arrayBuffer(),
    )
    if (bytes.byteLength > MAX_ASSET_BYTES) continue
    if (bytes.byteLength > remainingBytes) continue
    output.set(row.id, {
      data: Buffer.from(bytes).toString('base64'),
      mediaType: row.mediaType,
    })
    remainingBytes -= bytes.byteLength
  }
  return output
}

async function prepareDocument(userId: string, source: CanvasDocument) {
  const document = structuredClone(source)
  const images = Object.values(document.nodes).filter(
    (node) => node.type === 'image',
  )
  const assetIds = [
    ...new Set(
      images
        .map((node) => localAssetId(node.src))
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const assets = await loadAssets(userId, assetIds)
  const skippedImages: string[] = []
  for (const image of images) {
    if (image.src.startsWith('data:image/')) continue
    const id = localAssetId(image.src)
    const loaded = id ? assets.get(id) : null
    if (loaded) {
      image.src = `data:${loaded.mediaType};base64,${loaded.data}`
      continue
    }
    skippedImages.push(image.src)
    image.src = BLANK_IMAGE
  }
  return { document, skippedImages }
}

function chromiumExecutable() {
  const configured =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
    process.env.CHROMIUM_PATH?.trim()
  const candidates = [
    configured,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    chromium.executablePath(),
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

let browserPromise: Promise<Browser> | null = null

async function browser() {
  if (browserPromise) return browserPromise
  browserPromise = (async () => {
    const executablePath = chromiumExecutable()
    if (!executablePath) {
      throw new Error(
        'Screenshot rendering needs Chromium. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.',
      )
    }
    const launched = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
    launched.on('disconnected', () => {
      browserPromise = null
    })
    return launched
  })().catch((error) => {
    browserPromise = null
    throw error
  })
  return browserPromise
}

function screenshotTarget(
  document: CanvasDocument,
  options: CanvasScreenshotOptions,
) {
  if (options.ref) {
    readCanvasNodeRef(document, options.ref)
    return {
      exportNodeId: options.ref.instancePath[0] ?? options.ref.nodeId,
      targetNodeId: options.ref.nodeId,
      pageId: null,
      ref: options.ref,
    }
  }
  const page =
    (options.pageId ? document.nodes[options.pageId] : null) ??
    orderedChildren(document, null).find(
      (node) => node.type === 'page' && !node.hidden,
    )
  if (!page || page.type !== 'page') {
    throw new Error(
      options.pageId
        ? `Page "${options.pageId}" does not exist`
        : 'The Canvas has no visible Page to capture',
    )
  }
  return {
    exportNodeId: page.id,
    targetNodeId: page.id,
    pageId: page.id,
    ref: null,
  }
}

export async function renderCanvasScreenshot(
  userId: string,
  source: CanvasDocument,
  options: CanvasScreenshotOptions = {},
): Promise<CanvasScreenshot> {
  const width = Math.round(Math.max(200, Math.min(options.width ?? 1_440, 3_840)))
  const pixelRatio = Math.max(1, Math.min(options.pixelRatio ?? 1, 2))
  const prepared = await prepareDocument(userId, source)
  const target = screenshotTarget(prepared.document, options)
  const html = compileStandaloneHtml(prepared.document, {
    nodeId: target.exportNodeId,
    width,
    title: prepared.document.name,
  })
  const activeBrowser = await browser()
  const context = await activeBrowser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: pixelRatio,
  })
  try {
    await context.route('**/*', (route) => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(async () => {
      await document.fonts?.ready
      await Promise.all(
        [...document.images].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true })
                image.addEventListener('error', () => resolve(), { once: true })
              }),
        ),
      )
    })

    const root = page.locator('[data-loora-export-root="true"]').first()
    await root.waitFor({ state: 'visible' })
    const handle = (
      target.targetNodeId === target.exportNodeId
        ? await root.elementHandle()
        : (
            await root.evaluateHandle(
              (element, nodeId) =>
                [...element.querySelectorAll('[data-loora-node]')].find(
                  (node) => node.getAttribute('data-loora-node') === nodeId,
                ) ?? null,
              target.targetNodeId,
            )
          ).asElement()
    ) as ElementHandle<HTMLElement> | null
    if (!handle) {
      throw new Error(
        `Canvas node "${target.targetNodeId}" did not render`,
      )
    }

    await handle.evaluate(
      (element, limits) => {
        const htmlElement = element as HTMLElement
        const bounds = htmlElement.getBoundingClientRect()
        const areaScale = Math.sqrt(
          limits.maxArea /
            Math.max(1, bounds.width * bounds.height),
        )
        const scale = Math.min(
          1,
          limits.maxDimension / Math.max(1, bounds.width),
          limits.maxDimension / Math.max(1, bounds.height),
          areaScale,
        )
        if (scale < 1) {
          htmlElement.style.transformOrigin = 'top left'
          htmlElement.style.transform = `scale(${scale})`
        }
      },
      {
        maxArea: MAX_SCREENSHOT_AREA / (pixelRatio * pixelRatio),
        maxDimension: MAX_SCREENSHOT_DIMENSION / pixelRatio,
      },
    )
    const bounds = await handle.boundingBox()
    if (!bounds) throw new Error('Canvas screenshot target has no visible bounds')
    const png = await handle.screenshot({
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
    })
    if (png.byteLength > MAX_PNG_BYTES) {
      throw new Error(
        'The PNG is too large for one MCP response. Use a smaller width, pixelRatio, Page, or NodeRef.',
      )
    }
    return {
      png,
      width: Math.max(1, Math.round(bounds.width * pixelRatio)),
      height: Math.max(1, Math.round(bounds.height * pixelRatio)),
      pageId: target.pageId,
      ref: target.ref,
      skippedImages: prepared.skippedImages,
    }
  } finally {
    await context.close()
  }
}
