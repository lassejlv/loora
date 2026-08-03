import type { ReactNode } from 'react'
import type { CanvasColor } from '@loora/canvas/model'
import * as HugeIconsData from '@hugeicons/core-free-icons'
import * as LucideData from 'lucide'
import type { VectorDescriptor } from './svg-to-vector'
import { ICON_DEFAULT_COLOR, shapePathData, svgStringToVectorDescriptor } from './svg-to-vector'

export type IconLibraryId = 'hugeicons' | 'lucide' | 'svgl'

export interface IconEntry {
  id: string
  name: string
  library: IconLibraryId
  /**
   * Lazy conversion — computed only when the icon is inserted. May be async
   * for providers that fetch SVG data on demand (e.g. svgl).
   */
  toVector: () => VectorDescriptor | Promise<VectorDescriptor | null>
  /** Renders the icon preview at a given pixel size. */
  render: (size: number) => ReactNode
}

interface TupleAttr {
  readonly [key: string]: string | number
}

type IconData = readonly (readonly [string, TupleAttr])[]

function isIconData(value: unknown): value is IconData {
  return Array.isArray(value) && value.length > 0
}

const NEUTRAL_STROKE = '#475467'

function tupleToVector(
  data: IconData,
  viewBox: string,
  defaultStrokeWidth: number,
): VectorDescriptor {
  const paths: VectorDescriptor['paths'] = []
  for (const [tag, rawAttrs] of data) {
    const attributes: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawAttrs)) {
      attributes[key] = String(value)
    }
    const d = shapePathData(tag, attributes)
    if (!d) continue
    const stroke = typeof rawAttrs.stroke === 'string' ? rawAttrs.stroke : undefined
    const fill = typeof rawAttrs.fill === 'string' ? rawAttrs.fill : undefined
    const strokeWidth =
      typeof rawAttrs.strokeWidth === 'number'
        ? rawAttrs.strokeWidth
        : typeof rawAttrs.strokeWidth === 'string'
          ? Number.parseFloat(rawAttrs.strokeWidth)
          : undefined
    const hasFill = !!fill && fill !== 'none'
    const hasStroke = !!stroke && stroke !== 'none'

    paths.push({
      d,
      ...(hasFill
        ? { fill: (fill === 'currentColor' ? NEUTRAL_STROKE : fill) as CanvasColor }
        : {}),
      // Icon sets like Lucide omit stroke on each shape and rely on the SVG
      // root's `stroke="currentColor"` — default it so paths are not invisible.
      ...(hasStroke || !hasFill
        ? {
            stroke: (hasStroke && stroke !== 'currentColor'
              ? stroke
              : NEUTRAL_STROKE) as CanvasColor,
            strokeWidth:
              strokeWidth !== undefined && Number.isFinite(strokeWidth)
                ? strokeWidth
                : defaultStrokeWidth,
          }
        : {}),
    })
  }
  return { viewBox, paths }
}

function renderSvg(
  descriptor: VectorDescriptor,
  size: number,
): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox={descriptor.viewBox}
      fill="none"
      aria-hidden="true"
    >
      {descriptor.paths.map((vectorPath, index) => (
        <path
          key={index}
          d={vectorPath.d}
          fill={vectorPath.fill ? 'currentColor' : 'none'}
          stroke={vectorPath.stroke ? 'currentColor' : 'none'}
          strokeWidth={vectorPath.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

function buildHugeiconsEntries(): IconEntry[] {
  const entries: IconEntry[] = []
  for (const [exportName, data] of Object.entries(HugeIconsData)) {
    if (!isIconData(data)) continue
    const name = exportName.replace(/FreeIcons$/, '').replace(/Icon$/, '')
    if (!name) continue
    const toVector = () => tupleToVector(data, '0 0 24 24', 1.5)
    entries.push({
      id: `hugeicons:${exportName}`,
      name,
      library: 'hugeicons',
      toVector,
      render: (size: number) => renderSvg(toVector(), size),
    })
  }
  return entries
}

function buildLucideEntries(): IconEntry[] {
  const entries: IconEntry[] = []
  for (const [exportName, data] of Object.entries(LucideData)) {
    if (!isIconData(data)) continue
    const toVector = () => tupleToVector(data, '0 0 24 24', 2)
    entries.push({
      id: `lucide:${exportName}`,
      name: exportName,
      library: 'lucide',
      toVector,
      render: (size: number) => renderSvg(toVector(), size),
    })
  }
  return entries
}

let hugeiconsEntries: IconEntry[] | null = null
let lucideEntries: IconEntry[] | null = null

export function getHugeicons(): IconEntry[] {
  return (hugeiconsEntries ??= buildHugeiconsEntries())
}

export function getLucide(): IconEntry[] {
  return (lucideEntries ??= buildLucideEntries())
}

/* ── svgl ─────────────────────────────────────────────────────────────── */

interface SvglRoute {
  light: string
  dark: string
}

interface SvglItem {
  id: number
  title: string
  category: string | string[]
  route: string | SvglRoute
  url: string
  wordmark?: string | SvglRoute
  brandUrl?: string
}

const SVGL_API = 'https://api.svgl.app'
const SVGL_CACHE_MS = 5 * 60 * 1000

let svglCache: { entries: IconEntry[]; at: number } | null = null

/**
 * Fetch the SVGL directory once, then cache the entries for a few minutes to
 * respect the API's rate-limit guidance.
 */
export async function getSvgl(): Promise<IconEntry[]> {
  const now = Date.now()
  if (svglCache && now - svglCache.at < SVGL_CACHE_MS) return svglCache.entries

  const response = await fetch(SVGL_API)
  if (!response.ok) throw new Error(`svgl API returned ${response.status}`)
  const items = (await response.json()) as SvglItem[]

  const entries: IconEntry[] = []
  for (const item of items) {
    const route = typeof item.route === 'string' ? item.route : item.route.light
    if (!route) continue
    entries.push({
      id: `svgl:${item.id}`,
      name: item.title,
      library: 'svgl',
      toVector: () => fetchSvglVector(route),
      render: (size) => renderSvglPreview(route, size),
    })
  }

  svglCache = { entries, at: now }
  return entries
}

/** Fetch and convert a svgl icon to a VectorDescriptor at insert time. */
async function fetchSvglVector(route: string): Promise<VectorDescriptor | null> {
  const response = await fetch(route)
  if (!response.ok) return null
  const svg = await response.text()
  return svgStringToVectorDescriptor(svg)
}

/**
 * Lightweight preview that loads the SVG as an image. We use the route URL
 * directly as an `<img>` src — svgl serves the SVG with the correct
 * content-type, and the browser renders it natively.
 */
function renderSvglPreview(route: string, size: number): ReactNode {
  return (
    <img
      src={route}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      className="object-contain"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  )
}

export function getIcons(library: IconLibraryId): IconEntry[] | Promise<IconEntry[]> {
  if (library === 'hugeicons') return getHugeicons()
  if (library === 'lucide') return getLucide()
  return getSvgl()
}

export { ICON_DEFAULT_COLOR }