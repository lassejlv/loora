import type { CanvasElement, CanvasPage, CanvasPageItem } from './canvas'

export function pageId(prefix = 'pg') {
  return `${prefix}${crypto.randomUUID().replaceAll('-', '')}`
}

export function pageHeight(page: CanvasPage) {
  return Math.max(1, page.items.reduce((total, item) => total + item.height, 0))
}

export function createPageFromElements(
  elements: CanvasElement[],
  existingPages: CanvasPage[],
  preserveOrder = false,
): CanvasPage | null {
  if (elements.length === 0) return null
  const ordered = preserveOrder
    ? [...elements]
    : [...elements].sort((left, right) => left.y - right.y || left.x - right.x)
  const width = Math.max(...ordered.map((element) => element.w))
  const right = Math.max(...ordered.map((element) => element.x + element.w))
  const top = Math.min(...ordered.map((element) => element.y))
  const usedNames = new Set(existingPages.map((page) => page.name))
  let index = 1
  while (usedNames.has(`Page ${index}`)) index += 1

  return {
    id: pageId(),
    name: `Page ${index}`,
    x: right + 120,
    y: top,
    w: width,
    items: ordered.map((element) => ({
      id: pageId('pi'),
      elementId: element.id,
      height: Math.max(1, Math.round(element.h * (width / element.w))),
    })),
  }
}

export function duplicateCanvasPage(
  source: CanvasPage,
  existingPages: CanvasPage[],
  requestedName?: string,
): CanvasPage {
  const usedNames = new Set(existingPages.map((page) => page.name))
  const baseName = requestedName?.trim() || `${source.name} copy`
  let name = baseName
  let index = 2
  while (usedNames.has(name)) {
    name = `${baseName} ${index}`
    index += 1
  }

  return {
    ...source,
    id: pageId(),
    name,
    x: source.x + 80,
    y: source.y + 80,
    items: source.items.map((item) => ({ ...item, id: pageId('pi') })),
  }
}

// Page array order controls both the Pages rail and canvas stacking. Unknown
// and duplicate ids are ignored; omitted Pages retain their relative order
// after the explicitly ordered ones.
export function reorderCanvasPages(pages: CanvasPage[], orderedIds: string[]): CanvasPage[] {
  const byId = new Map(pages.map((page) => [page.id, page]))
  const seen = new Set<string>()
  const ordered: CanvasPage[] = []

  for (const id of orderedIds) {
    if (seen.has(id)) continue
    const page = byId.get(id)
    if (!page) continue
    seen.add(id)
    ordered.push(page)
  }
  for (const page of pages) {
    if (!seen.has(page.id)) ordered.push(page)
  }
  return ordered
}

export function onlyCanvasPages(value: unknown): CanvasPage[] {
  if (!Array.isArray(value)) return []
  return value.filter((page): page is CanvasPage => {
    if (!page || typeof page !== 'object') return false
    const candidate = page as Partial<CanvasPage>
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.x === 'number' &&
      Number.isFinite(candidate.x) &&
      typeof candidate.y === 'number' &&
      Number.isFinite(candidate.y) &&
      typeof candidate.w === 'number' &&
      Number.isFinite(candidate.w) &&
      candidate.w > 0 &&
      Array.isArray(candidate.items) &&
      candidate.items.every(isPageItem)
    )
  })
}

function isPageItem(value: unknown): value is CanvasPageItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<CanvasPageItem>
  return (
    typeof item.id === 'string' &&
    typeof item.elementId === 'string' &&
    typeof item.height === 'number' &&
    Number.isFinite(item.height) &&
    item.height > 0
  )
}

export function removeElementReferences(pages: CanvasPage[], elementIds: ReadonlySet<string>) {
  return pages.map((page) => ({
    ...page,
    items: page.items.filter((item) => !elementIds.has(item.elementId)),
  }))
}

export function pageElements(page: CanvasPage, elements: CanvasElement[]) {
  const byId = new Map(elements.map((element) => [element.id, element]))
  return page.items.map((item) => ({ item, element: byId.get(item.elementId) ?? null }))
}

export function hasMissingPageElements(page: CanvasPage, elements: CanvasElement[]) {
  return pageElements(page, elements).some(({ element }) => !element || element.hidden)
}
