import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ClipboardIcon, CodeXmlIcon } from '@loora/ui/icons'
import {
  CheckIcon,
  DownloadIcon,
  EyeIcon,
  ExternalLinkIcon,
  Globe2Icon,
  Link2Icon,
  RefreshCwIcon,
  Trash2Icon,
} from '@loora/ui/icons'
import {
  compileJsxComponent,
  compileStandaloneHtml,
  compileTailwindComponent,
  prepareCanvasExport,
  serializeCanvasDocument,
  type CanvasExportOptions,
} from '@loora/canvas/export'
import {
  buildChildIndex,
  orderedChildren,
  type CanvasChildIndex,
  type CanvasDocument,
  type CanvasNode,
  type NodeId,
  type NodeRef,
  type PageNode,
} from '@loora/canvas/model'
import {
  useCanvasDocument,
  useCanvasDomRegistry,
  useCanvasSelection,
} from '@loora/canvas/react'
import { captureCanvasPng, captureNodePng } from '../lib/canvas-capture'
import { copyText } from '../lib/copy-text'
import { orpc } from '@loora/rpc/client'
import { appUrl } from '@loora/platform'
import { Button } from '@loora/ui/button'
import {
  Dialog,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import { Spinner } from '@loora/ui/spinner'
import { Switch } from '@loora/ui/switch'
import { cn } from '@loora/ui/utils'
import type { CanvasEditorController } from './editor'
import { UpgradeToProButton } from './upgrade-to-pro'

type ExportFormat =
  | 'png'
  | 'html'
  | 'jsx'
  | 'tailwind'
  | 'json'
  | 'handoff'
  | 'publish'
type ExportScope = 'canvas' | 'page' | 'selection'

type PublishedSiteSummary = {
  id: string
  designId: string
  pageId: string
  handle: string
  slug: string
  title: string
  path: string
  customDomain: {
    hostname: string
    providerId: string | null
    status:
      | 'pending'
      | 'pending_dns'
      | 'pending_verification'
      | 'pending_certificate'
      | 'active'
      | 'misconfigured'
      | 'failed'
      | 'unknown'
    records: {
      type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'CAA' | 'ALIAS' | 'ANAME'
      name: string
      value: string
      purpose: 'routing' | 'ownership' | 'certificate' | 'other'
      required: boolean
      status: 'pending' | 'valid' | 'invalid' | 'unknown'
    }[]
    updatedAt: number | null
  } | null
  publishedAt: number
  updatedAt: number
}

type DnsRecord = NonNullable<PublishedSiteSummary['customDomain']>['records'][number]

function customDomainStatusLabel(status: NonNullable<PublishedSiteSummary['customDomain']>['status']) {
  if (status === 'active') return 'Active'
  if (status === 'failed' || status === 'misconfigured') return 'Needs attention'
  return status
    .replace(/^pending_?/, 'Pending ')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function customDomainStatusHelp(status: NonNullable<PublishedSiteSummary['customDomain']>['status']): string | null {
  switch (status) {
    case 'pending':
      return 'Connecting to your DNS provider.'
    case 'pending_dns':
      return 'Waiting for DNS records to propagate. This can take a few minutes to several hours.'
    case 'pending_verification':
      return 'Verifying domain ownership through your DNS records.'
    case 'pending_certificate':
      return 'Issuing an SSL certificate. This usually takes a few minutes.'
    case 'failed':
    case 'misconfigured':
      return 'Your DNS records look incorrect. Update them at your provider, then refresh.'
    default:
      return null
  }
}

const FORMATS: {
  id: ExportFormat
  extension: string
  name: string
  description: string
}[] = [
  {
    id: 'png',
    extension: 'PNG',
    name: 'Image',
    description: 'A flat capture of what is on the canvas',
  },
  {
    id: 'html',
    extension: 'HTML',
    name: 'Web page',
    description: 'One file: markup, CSS, and the interaction runtime',
  },
  {
    id: 'jsx',
    extension: 'JSX',
    name: 'JSX component',
    description: 'Portable JSX with inline structured styles',
  },
  {
    id: 'tailwind',
    extension: 'JSX',
    name: 'Tailwind component',
    description: 'JSX with literal Tailwind utility classes',
  },
  {
    id: 'json',
    extension: 'JSON',
    name: 'Canvas document',
    description: 'The structured source of truth',
  },
  {
    id: 'publish',
    extension: 'SITE',
    name: 'Publish',
    description: 'A public snapshot at loora.design/sites/…',
  },
  {
    id: 'handoff',
    extension: 'LINK',
    name: 'Agent handoff',
    description: 'A private link and prompt for another agent',
  },
]

const PNG_SCALES = [1, 2, 3] as const
const IMAGE_EMBED_CONCURRENCY = 4

export function safeExportName(name: string, extension: string) {
  const base =
    name
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'loora-design'
  return `${base}.${extension}`
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadDataUrl(filename: string, url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Base64 carries four characters per three bytes, padding included. */
function dataUrlBytes(url: string) {
  const base64 = url.slice(url.indexOf(',') + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

function pagesOf(document: CanvasDocument) {
  return Object.values(document.nodes)
    .filter((node): node is PageNode => node.type === 'page')
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

/**
 * The nodes an export actually contains. Instances pull in their component, so
 * the count matches the generated markup rather than the layer tree.
 */
function subtreeNodes(
  document: CanvasDocument,
  roots: CanvasNode[],
  index: CanvasChildIndex,
) {
  const seen = new Set<NodeId>()
  const queue = [...roots]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor]!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    if (node.type === 'instance') {
      const component = document.nodes[node.componentId]
      if (component) queue.push(component)
      continue
    }
    queue.push(...orderedChildren(document, node.id, index))
  }
  return [...seen].map((id) => document.nodes[id]!).filter(Boolean)
}

function ancestorPage(document: CanvasDocument, nodeId: NodeId | undefined) {
  let node = nodeId ? document.nodes[nodeId] : null
  while (node) {
    if (node.type === 'page') return node
    node = node.parentId ? document.nodes[node.parentId] ?? null : null
  }
  return null
}

/** What the chosen scope resolves to: compile options, roots, and a name. */
function exportTarget(
  document: CanvasDocument,
  scope: ExportScope,
  pageId: NodeId | null,
  selectedRef: NodeRef | null,
) {
  if (scope === 'selection' && selectedRef) {
    const node = document.nodes[selectedRef.nodeId]
    if (node && node.type !== 'component') {
      return {
        options:
          node.type === 'page'
            ? ({ pageId: node.id } satisfies CanvasExportOptions)
            : ({ nodeId: node.id } satisfies CanvasExportOptions),
        roots: [node],
        name: node.name,
        ref: selectedRef,
      }
    }
  }
  if (scope === 'page' && pageId) {
    const page = document.nodes[pageId]
    if (page?.type === 'page') {
      return {
        options: { pageId: page.id } satisfies CanvasExportOptions,
        roots: [page],
        name: page.name,
        ref: { nodeId: page.id, instancePath: [] } satisfies NodeRef,
      }
    }
  }
  const pages = pagesOf(document)
  return {
    options: {} satisfies CanvasExportOptions,
    roots: pages as CanvasNode[],
    name: document.name,
    ref: null,
  }
}

function imageSources(
  document: CanvasDocument,
  roots: CanvasNode[],
  index: CanvasChildIndex,
) {
  return [
    ...new Set(
      subtreeNodes(document, roots, index)
        .filter((node) => node.type === 'image')
        .map((node) => node.src),
    ),
  ].filter((src) => src && !src.startsWith('data:'))
}

/** Fetches every referenced image so a downloaded file survives its links. */
async function embedImages(sources: string[]) {
  const entries: Array<readonly [string, string]> = []
  let cursor = 0
  await Promise.all(
    Array.from(
      { length: Math.min(IMAGE_EMBED_CONCURRENCY, sources.length) },
      async () => {
        while (cursor < sources.length) {
          const src = sources[cursor++]!
          try {
            const response = await fetch(src, { credentials: 'same-origin' })
            if (!response.ok) continue
            const blob = await response.blob()
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () =>
                reject(reader.error ?? new Error('Image could not be read'))
              reader.readAsDataURL(blob)
            })
            entries.push([src, data] as const)
          } catch {
            // One unreadable asset should not prevent the rest of the export.
          }
        }
      },
    ),
  )
  return new Map(entries)
}

function useMeasuredBox(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const host = ref.current
    if (!host || !enabled) return
    const measure = () => {
      const rect = host.getBoundingClientRect()
      setBox({ width: rect.width, height: rect.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [enabled])
  return { ref, box }
}

function ScopeButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={cn(
        'h-6 flex-1 rounded text-xs text-muted-foreground',
        active ? 'bg-secondary text-foreground' : 'hover:text-foreground',
        disabled && 'opacity-40',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-2xs font-medium text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

export function CanvasExport({
  controller,
  open,
  onOpenChange,
}: {
  controller: CanvasEditorController
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const document = useCanvasDocument()
  const registry = useCanvasDomRegistry()
  const selection = useCanvasSelection()

  const pages = useMemo(() => pagesOf(document), [document])
  const childIndex = useMemo(() => buildChildIndex(document), [document])
  const widths = useMemo(
    () => [...document.breakpoints].sort((left, right) => left.minWidth - right.minWidth),
    [document.breakpoints],
  )
  const selectedRef =
    selection.length === 1 &&
    selection[0]!.instancePath.length === 0 &&
    document.nodes[selection[0]!.nodeId] &&
    document.nodes[selection[0]!.nodeId]!.type !== 'component'
      ? selection[0]!
      : null

  const [format, setFormat] = useState<ExportFormat>('html')
  const [scope, setScope] = useState<ExportScope>('canvas')
  const [pageId, setPageId] = useState<NodeId | null>(null)
  const [width, setWidth] = useState(1440)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [embed, setEmbed] = useState(false)
  const [assets, setAssets] = useState<Map<string, string> | null>(null)
  const [assetsBusy, setAssetsBusy] = useState(false)
  const [scale, setScale] = useState<(typeof PNG_SCALES)[number]>(2)
  const [png, setPng] = useState<{ key: string; url: string } | null>(null)
  const [pngSize, setPngSize] = useState<{ width: number; height: number } | null>(null)
  const [pngBusy, setPngBusy] = useState(false)
  const [dropped, setDropped] = useState<string[]>([])
  const [handoff, setHandoff] = useState<{ url: string; expiresAt: number } | null>(null)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [publishHandle, setPublishHandle] = useState<string | null>(null)
  const [sitesEnabled, setSitesEnabled] = useState(false)
  const [handleDraft, setHandleDraft] = useState('')
  const [handleBusy, setHandleBusy] = useState(false)
  const [customDomainsAllowed, setCustomDomainsAllowed] = useState(false)
  const [customDomainsEnabled, setCustomDomainsEnabled] = useState(true)
  const [customDomainsConfigured, setCustomDomainsConfigured] = useState(false)
  const [domainDraft, setDomainDraft] = useState('')
  const [domainBusy, setDomainBusy] = useState(false)
  const [domainRemoving, setDomainRemoving] = useState(false)
  const [publishedSites, setPublishedSites] = useState<PublishedSiteSummary[]>(
    [],
  )
  const [publishBusy, setPublishBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [dnsCopied, setDnsCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Opening the dialog adopts whatever the canvas is showing.
  useEffect(() => {
    if (!open) return
    setError(null)
    setCopied(false)
    // A capture from a previous visit is stale the moment the canvas changes.
    setPng(null)
    setPngSize(null)
    setScope(selectedRef ? 'selection' : 'canvas')
    setPageId(
      (selectedRef ? ancestorPage(document, selectedRef.nodeId)?.id : null) ??
        pages[0]?.id ??
        null,
    )
    setWidth(widths.at(-1)?.previewWidth ?? 1440)
    // Preload publish eligibility so the Publish tab can appear for admins
    // without requiring the user to first select a format they can't see.
    void orpc.publish
      .getHandle()
      .then((result) => {
        setSitesEnabled(result.sitesEnabled)
        setPublishHandle(result.handle)
        setHandleDraft(result.handle ?? '')
      })
      .catch(() => undefined)
  }, [open])

  useEffect(() => {
    if (!open || format !== 'publish') return
    setScope('page')
    if (!pageId && pages[0]) setPageId(pages[0].id)
  }, [open, format, pageId, pages])

  useEffect(() => {
    if (!open || format !== 'publish' || !controller.target) return
    let cancelled = false
    void (async () => {
      try {
        const sites = await orpc.publish.list({ designId: controller.target!.designId })
        if (cancelled) return
        setCustomDomainsAllowed(false)
        setCustomDomainsEnabled(true)
        setCustomDomainsConfigured(false)
        setPublishedSites(sites)
        // Refresh handle + domain eligibility in case it changed since open.
        const handleState = await orpc.publish.getHandle()
        if (cancelled) return
        setPublishHandle(handleState.handle)
        setHandleDraft(handleState.handle ?? '')
        setCustomDomainsAllowed(handleState.customDomains.allowed)
        setCustomDomainsEnabled(handleState.customDomains.enabled)
        setCustomDomainsConfigured(handleState.customDomains.configured)
      } catch {
        if (!cancelled) {
          setError('Could not load publish status.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, format, controller.target])

  const target = useMemo(
    () => exportTarget(document, scope, pageId, selectedRef),
    [document, scope, pageId, selectedRef],
  )
  const scoped =
    format !== 'json' && format !== 'handoff' && format !== 'publish'
  const publishedForPage =
    publishedSites.find((site) => site.pageId === pageId) ?? null
  const publishedUrl = publishedForPage
    ? appUrl(publishedForPage.path)
    : null
  const customDomain = publishedForPage?.customDomain ?? null
  useEffect(() => {
    setDomainDraft(customDomain?.hostname ?? '')
  }, [customDomain?.hostname, pageId])

  const domainStatus = customDomain?.status
  useEffect(() => {
    if (!open || format !== 'publish' || !domainStatus) return
    const isPending =
      domainStatus === 'pending' ||
      domainStatus === 'pending_dns' ||
      domainStatus === 'pending_verification' ||
      domainStatus === 'pending_certificate'
    if (!isPending) return
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const sites = await orpc.publish.list({ designId: controller.target!.designId })
          setPublishedSites(sites)
        } catch {
          // Silent failure — the user can still refresh manually.
        }
      })()
    }, 15000)
    return () => window.clearInterval(interval)
  }, [open, format, domainStatus, controller.target])

  const options = useMemo<CanvasExportOptions>(
    () => ({
      ...target.options,
      width,
      ...(embed && assets && assets.size > 0
        ? { assetUrl: (url: string) => assets.get(url) ?? url }
        : {}),
    }),
    [target, width, embed, assets],
  )

  const sources = useMemo(
    () => (open ? imageSources(document, target.roots, childIndex) : []),
    [open, document, target, childIndex],
  )
  // Keyed by the URLs themselves: an edit elsewhere in the document must not
  // re-download images that did not change.
  const sourceKey = sources.join('|')

  // Images are pulled in once per scope, and only when asked for.
  useEffect(() => {
    if (!open || !embed || sources.length === 0) {
      setAssets(null)
      return
    }
    let cancelled = false
    setAssetsBusy(true)
    void embedImages(sources)
      .then((map) => {
        if (!cancelled) setAssets(map)
      })
      .finally(() => {
        if (!cancelled) setAssetsBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, embed, sourceKey])

  const webExportEnabled =
    format === 'html' ||
    format === 'jsx' ||
    format === 'tailwind'
  const preparedWebExport = useMemo(() => {
    if (!open || !webExportEnabled) return null
    try {
      return { plan: prepareCanvasExport(document, options), error: null }
    } catch (cause) {
      return {
        plan: null,
        error:
          cause instanceof Error
            ? cause.message
            : 'This selection could not be compiled.',
      }
    }
  }, [open, webExportEnabled, document, options])

  const webCompiled = useMemo(() => {
    if (!preparedWebExport) return null
    if (!preparedWebExport.plan) {
      return {
        text: '',
        previewHtml: null,
        error: preparedWebExport.error,
      }
    }
    try {
      const previewHtml = compileStandaloneHtml(preparedWebExport.plan)
      return {
        text:
          format === 'html'
            ? previewHtml
            : format === 'jsx'
              ? compileJsxComponent(preparedWebExport.plan)
              : compileTailwindComponent(preparedWebExport.plan),
        previewHtml,
        error: null,
      }
    } catch (cause) {
      return {
        text: '',
        previewHtml: null,
        error:
          cause instanceof Error
            ? cause.message
            : 'This selection could not be compiled.',
      }
    }
  }, [preparedWebExport, format])

  const compiled = useMemo(() => {
    if (
      !open ||
      format === 'png' ||
      format === 'handoff' ||
      format === 'publish'
    ) {
      return null
    }
    if (format !== 'json') return webCompiled
    try {
      return {
        text: serializeCanvasDocument(document),
        previewHtml: null,
        error: null,
      }
    } catch (cause) {
      return {
        text: '',
        previewHtml: null,
        error:
          cause instanceof Error
            ? cause.message
            : 'This document could not be serialized.',
      }
    }
  }, [open, format, document, webCompiled])

  const previewHtml = webCompiled?.previewHtml ?? null

  const pngKey = `${scope}:${pageId ?? ''}:${target.ref?.nodeId ?? ''}:${scale}`
  useEffect(() => {
    if (!open || format !== 'png') return
    if (png?.key === pngKey) return
    let cancelled = false
    setPngBusy(true)
    setError(null)
    setPngSize(null)
    setDropped([])
    const missed = new Set<string>()
    const captureOptions = {
      pixelRatio: scale,
      onSkippedImage: (src: string) => missed.add(src),
    }
    const capture = target.ref
      ? captureNodePng(registry, target.ref, captureOptions)
      : captureCanvasPng(document, registry, captureOptions)
    void capture
      .then((url) => {
        if (cancelled) return
        setPng({ key: pngKey, url })
        setDropped([...missed])
      })
      .catch((cause) => {
        if (cancelled) return
        setPng(null)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The image could not be captured.',
        )
      })
      .finally(() => {
        if (!cancelled) setPngBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, format, pngKey])

  const nodeCount = useMemo(
    () =>
      open ? subtreeNodes(document, target.roots, childIndex).length : 0,
    [open, document, target, childIndex],
  )
  const byteSize = useMemo(() => {
    if (format === 'png') return png ? dataUrlBytes(png.url) : 0
    if (!compiled?.text) return 0
    return new TextEncoder().encode(compiled.text).length
  }, [format, png, compiled])

  const handoffPrompt = handoff
    ? `Fetch the Loora Canvas handoff from ${handoff.url}. Read the version 3 JSON document and assets. Recreate the selected UI faithfully using its normalized nodes, parentId/order hierarchy, structured layout and styles, responsive overrides, components, instances, tokens, typed local states, and declarative event interactions. Runtime state is ephemeral; CanvasDocument remains the authoring source of truth. Do not look for editable source strings.`
    : ''

  const createHandoff = async () => {
    if (!controller.target) return
    setHandoffBusy(true)
    setError(null)
    setCopied(false)
    try {
      await controller.flush?.()
      const created = await orpc.handoff.create({
        designId: controller.target.designId,
        draftId: controller.target.draftId,
      })
      setHandoff({
        url: appUrl(`/api/handoff/${created.token}`),
        expiresAt: created.expiresAt,
      })
    } catch {
      setError('Could not create the handoff link. Try again.')
    } finally {
      setHandoffBusy(false)
    }
  }

  const savePublishHandle = async () => {
    setHandleBusy(true)
    setError(null)
    try {
      const result = await orpc.publish.setHandle({ handle: handleDraft })
      setPublishHandle(result.handle)
      setHandleDraft(result.handle)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save that handle. Try another.',
      )
    } finally {
      setHandleBusy(false)
    }
  }

  const replacePublishedSite = (site: PublishedSiteSummary) => {
    setPublishedSites((current) => [
      ...current.filter((entry) => entry.pageId !== site.pageId),
      site,
    ])
  }

  const publishCurrentPage = async () => {
    if (!controller.target || !pageId) return
    setPublishBusy(true)
    setError(null)
    try {
      await controller.flush?.()
      const site = await orpc.publish.publish({
        designId: controller.target.designId,
        pageId,
      })
      replacePublishedSite(site)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not publish this page. Try again.',
      )
    } finally {
      setPublishBusy(false)
    }
  }

  const connectCustomDomain = async () => {
    if (!publishedForPage || !domainDraft.trim()) return
    setDomainBusy(true)
    setError(null)
    try {
      replacePublishedSite(
        await orpc.publish.connectDomain({
          siteId: publishedForPage.id,
          hostname: domainDraft,
        }),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not connect this domain. Try again.',
      )
    } finally {
      setDomainBusy(false)
    }
  }

  const refreshCustomDomain = async () => {
    if (!publishedForPage?.customDomain) return
    setDomainBusy(true)
    setError(null)
    try {
      replacePublishedSite(
        await orpc.publish.refreshDomain({ siteId: publishedForPage.id }),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not refresh this domain. Try again.',
      )
    } finally {
      setDomainBusy(false)
    }
  }

  const removeCustomDomain = async () => {
    if (!publishedForPage?.customDomain) return
    setDomainBusy(true)
    setError(null)
    try {
      replacePublishedSite(
        await orpc.publish.removeDomain({ siteId: publishedForPage.id }),
      )
      setDomainRemoving(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not remove this domain. Try again.',
      )
    } finally {
      setDomainBusy(false)
    }
  }

  const unpublishCurrentPage = async () => {
    if (!controller.target || !pageId) return
    setPublishBusy(true)
    setError(null)
    try {
      await orpc.publish.unpublish({
        designId: controller.target.designId,
        pageId,
      })
      setPublishedSites((current) =>
        current.filter((entry) => entry.pageId !== pageId),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not unpublish this page. Try again.',
      )
    } finally {
      setPublishBusy(false)
    }
  }

  const flash = () => {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const flashDns = (key: string) => {
    setDnsCopied(key)
    window.setTimeout(() => setDnsCopied((current) => (current === key ? null : current)), 1800)
  }

  const copyRecordField = async (record: DnsRecord, field: 'name' | 'value') => {
    try {
      await copyText(record[field])
      flashDns(`${record.type}:${record.name}:${field}`)
    } catch {
      setError('Clipboard access was blocked. Copy it by hand instead.')
    }
  }

  const downloadDnsFile = () => {
    if (!customDomain || customDomain.records.length === 0) return
    const lines = customDomain.records
      .filter((r) => r.required)
      .map((r) => {
        const ttl = 3600
        const host = r.name === '' || r.name === '@' ? customDomain.hostname : r.name
        return `${host}\t${ttl}\tIN\t${r.type}\t${r.value}`
      })
    const zone = `; DNS records for ${customDomain.hostname}\n; Generated by Loora — add these at your DNS provider\n\n${lines.join('\n')}\n`
    download(`${customDomain.hostname}.txt`, zone, 'text/plain')
  }

  const copyAllRecords = async () => {
    if (!customDomain || customDomain.records.length === 0) return
    const text = customDomain.records
      .filter((r) => r.required)
      .map((r) => `${r.type}  ${r.name}  ${r.value}`)
      .join('\n')
    try {
      await copyText(text)
      flashDns('all')
    } catch {
      setError('Clipboard access was blocked. Copy it by hand instead.')
    }
  }

  const copy = async () => {
    setError(null)
    try {
      if (format === 'publish') {
        if (!publishedUrl) return
        await copyText(publishedUrl)
      } else if (format === 'handoff') {
        await copyText(handoffPrompt)
      } else if (format === 'png') {
        if (!png) return
        const blob = await (await fetch(png.url)).blob()
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type || 'image/png']: blob }),
        ])
      } else {
        await copyText(compiled?.text ?? '')
      }
      flash()
    } catch {
      setError('Clipboard access was blocked. Copy it by hand instead.')
    }
  }

  const save = () => {
    setError(null)
    if (format === 'png') {
      if (png) downloadDataUrl(safeExportName(target.name, 'png'), png.url)
      return
    }
    if (!compiled || compiled.error) return
    const extension =
      format === 'jsx' || format === 'tailwind' ? 'jsx' : format
    download(
      safeExportName(format === 'json' ? document.name : target.name, extension),
      compiled.text,
      format === 'json' ? 'application/json' : 'text/plain',
    )
  }

  const preview = useMeasuredBox(open && view === 'preview')
  const previewScale =
    preview.box.width > 0 ? Math.min(1, (preview.box.width - 24) / width) : 0

  const scopeLabel =
    !scoped
      ? 'The whole document'
      : scope === 'selection' && target.ref
        ? `“${target.name}”`
        : scope === 'page'
          ? `Page “${target.name}”`
          : `${pages.length} ${pages.length === 1 ? 'Page' : 'Pages'}`

  const canCopy =
    format === 'publish'
      ? Boolean(publishedUrl)
      : format === 'handoff'
        ? Boolean(handoff)
        : format === 'png'
          ? Boolean(png) && typeof ClipboardItem !== 'undefined'
          : Boolean(compiled?.text)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl p-0" bottomStickOnMobile={false}>
        <DialogHeader className="border-b px-4 py-2.5">
          <DialogTitle>Export</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[min(78svh,36rem)] flex-col">
          <div className="contents">
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2">
              {FORMATS.filter((item) => item.id !== 'publish' || sitesEnabled).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={format === item.id}
                  className={cn(
                    'flex h-7 shrink-0 items-center rounded-full px-3 text-xs font-medium transition-colors duration-150',
                    format === item.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                  )}
                  onClick={() => setFormat(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="grid shrink-0 gap-3 border-b p-3 sm:grid-cols-2">
              <Row label="What">
                {format === 'publish' ? (
                  <>
                    {pages.length > 1 ? (
                      <select
                        aria-label="Page"
                        value={pageId ?? ''}
                        className="h-7 w-full rounded-md border bg-background px-1.5 text-xs outline-none"
                        onChange={(event) => setPageId(event.target.value)}
                      >
                        {pages.map((page) => (
                          <option key={page.id} value={page.id}>
                            {page.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Publishes a frozen HTML snapshot of one Page.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex rounded-md border bg-background p-0.5">
                      <ScopeButton
                        active={scoped && scope === 'canvas'}
                        disabled={!scoped}
                        onClick={() => setScope('canvas')}
                      >
                        Canvas
                      </ScopeButton>
                      <ScopeButton
                        active={scoped && scope === 'page'}
                        disabled={!scoped || pages.length === 0}
                        onClick={() => setScope('page')}
                      >
                        Page
                      </ScopeButton>
                      <ScopeButton
                        active={scoped && scope === 'selection'}
                        disabled={!scoped || !selectedRef}
                        title={
                          selectedRef
                            ? undefined
                            : 'Select one node on the canvas'
                        }
                        onClick={() => setScope('selection')}
                      >
                        Selection
                      </ScopeButton>
                    </div>
                    {scoped && scope === 'page' && pages.length > 1 ? (
                      <select
                        aria-label="Page"
                        value={pageId ?? ''}
                        className="h-7 w-full rounded-md border bg-background px-1.5 text-xs outline-none"
                        onChange={(event) => setPageId(event.target.value)}
                      >
                        {pages.map((page) => (
                          <option key={page.id} value={page.id}>
                            {page.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {scopeLabel}
                      {scoped ? ` · ${nodeCount} nodes` : null}
                      {byteSize > 0 ? ` · ${formatBytes(byteSize)}` : null}
                    </p>
                  </>
                )}
              </Row>

              {format === 'html' ||
              format === 'jsx' ||
              format === 'tailwind' ? (
                <>
                  <Row label="Width">
                    <div className="flex rounded-md border bg-background p-0.5">
                      {widths.map((breakpoint) => (
                        <ScopeButton
                          key={breakpoint.id}
                          active={width === breakpoint.previewWidth}
                          title={`${breakpoint.name} · ${breakpoint.previewWidth}px`}
                          onClick={() => setWidth(breakpoint.previewWidth)}
                        >
                          {`${breakpoint.previewWidth}`}
                        </ScopeButton>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Responsive overrides for this width are baked in; the rest
                      stay as media queries.
                    </p>
                  </Row>
                  <Row label="Images">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        aria-label="Embed images"
                        checked={embed}
                        disabled={sources.length === 0}
                        onCheckedChange={(next) => setEmbed(next)}
                      />
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        {sources.length === 0
                          ? 'No linked images in this export'
                          : assetsBusy
                            ? `Embedding ${sources.length}…`
                            : `Embed ${sources.length} image${sources.length === 1 ? '' : 's'} in the file`}
                      </span>
                      {assetsBusy ? <Spinner className="size-3" /> : null}
                    </label>
                    {sources.length > 0 && !embed ? (
                      <p className="text-xs text-muted-foreground">
                        Left linked, images break when the asset link expires.
                      </p>
                    ) : null}
                  </Row>
                </>
              ) : null}

              {format === 'png' ? (
                <Row label="Scale">
                  <div className="flex rounded-md border bg-background p-0.5">
                    {PNG_SCALES.map((value) => (
                      <ScopeButton
                        key={value}
                        active={scale === value}
                        onClick={() => setScale(value)}
                      >
                        {`${value}×`}
                      </ScopeButton>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pngSize
                      ? `${pngSize.width} × ${pngSize.height} pixels`
                      : 'Captured from the rendered canvas.'}
                  </p>
                  {dropped.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {dropped.length} image
                      {dropped.length === 1 ? ' is' : 's are'} blank: hosted
                      elsewhere, and that site does not allow reading it back.
                      Upload {dropped.length === 1 ? 'it' : 'them'} to this
                      design to include {dropped.length === 1 ? 'it' : 'them'}.
                    </p>
                  ) : null}
                </Row>
              ) : null}

              {format === 'json' ? (
                <p className="self-end text-xs text-muted-foreground">
                  The document is always exported whole — its nodes reference
                  each other, so a partial file would not open.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
              {format === 'handoff' ? (
                <p className="px-1 text-xs text-muted-foreground">
                  A private, expiring link to this document and its assets.
                </p>
              ) : format === 'publish' ? (
                <p className="px-1 text-xs text-muted-foreground">
                  A public HTML snapshot. Republish to update it.
                </p>
              ) : (
                <>
                  <Button
                    size="xs"
                    variant={view === 'preview' ? 'secondary' : 'ghost'}
                    disabled={format === 'json'}
                    onClick={() => setView('preview')}
                  >
                    <EyeIcon />
                    Preview
                  </Button>
                  <Button
                    size="xs"
                    variant={view === 'code' || format === 'json' ? 'secondary' : 'ghost'}
                    disabled={format === 'png'}
                    onClick={() => setView('code')}
                  >
                    <CodeXmlIcon />
                    Code
                  </Button>
                </>
              )}
              <div className="ms-auto flex items-center gap-1">
                {canCopy ? (
                  <Button size="xs" variant="ghost" onClick={() => void copy()}>
                    {copied ? <CheckIcon /> : <ClipboardIcon />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                ) : null}
              </div>
            </div>

            <div ref={preview.ref} className="h-56 shrink-0 overflow-auto bg-cx-canvas">
              {format === 'publish' ? (
                <div className="space-y-3 p-4">
                  {!publishHandle ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-3 px-6">
                      <p className="text-center text-xs text-muted-foreground">
                        Choose a public handle. Sites are served at{' '}
                        <span className="font-mono">
                          /sites/&lt;handle&gt;/&lt;id&gt;
                        </span>
                        .
                      </p>
                      <div className="flex w-full max-w-xs items-center gap-2">
                        <Input
                          value={handleDraft}
                          placeholder="your-name"
                          aria-label="Public handle"
                          className="font-mono"
                          disabled={handleBusy}
                          onChange={(event) =>
                            setHandleDraft(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void savePublishHandle()
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          disabled={handleBusy || handleDraft.trim().length < 3}
                          onClick={() => void savePublishHandle()}
                        >
                          {handleBusy ? <Spinner /> : 'Save'}
                        </Button>
                      </div>
                    </div>
                  ) : publishedForPage && publishedUrl ? (
                    <>
                      <input
                        readOnly
                        value={publishedUrl}
                        aria-label="Published site URL"
                        className="h-9 w-full rounded-lg border bg-background px-3 font-mono text-xs outline-none"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <p className="text-xs text-muted-foreground">
                        Last published{' '}
                        {new Date(publishedForPage.updatedAt).toLocaleString()}.
                        Visitors see this snapshot until you republish.
                      </p>
                      <div className="space-y-2 border-t pt-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">Custom domain</p>
                          {customDomain ? null : (
                            <span className="text-2xs text-muted-foreground">Pro</span>
                          )}
                        </div>
                        {customDomain ? (
                          <div className="space-y-2 rounded-md border bg-background p-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'size-1.5 rounded-full',
                                  customDomain.status === 'active'
                                    ? 'bg-emerald-500'
                                    : customDomain.status === 'failed' ||
                                        customDomain.status === 'misconfigured'
                                      ? 'bg-destructive'
                                      : 'bg-amber-500',
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                {customDomain.hostname}
                              </span>
                              <span className="text-2xs text-muted-foreground">
                                {customDomainStatusLabel(customDomain.status)}
                              </span>
                              {customDomain.status === 'active' ? (
                                <a
                                  href={`https://${customDomain.hostname}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label="Open custom domain"
                                >
                                  <ExternalLinkIcon className="size-3.5" />
                                </a>
                              ) : null}
                            </div>
                            {customDomainStatusHelp(customDomain.status) ? (
                              <p className="text-2xs text-muted-foreground">
                                {customDomainStatusHelp(customDomain.status)}
                              </p>
                            ) : null}
                            {customDomain.records.length > 0 &&
                            customDomain.status !== 'active' ? (
                              <div className="space-y-2 border-t pt-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-2xs text-muted-foreground">
                                    Add these records at your DNS provider.
                                  </p>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="flex items-center gap-1 rounded text-2xs text-muted-foreground transition-colors hover:text-foreground"
                                      onClick={() => void copyAllRecords()}
                                    >
                                      {dnsCopied === 'all' ? <CheckIcon className="size-3" /> : <ClipboardIcon className="size-3" />}
                                      {dnsCopied === 'all' ? 'Copied' : 'Copy all'}
                                    </button>
                                    <button
                                      type="button"
                                      className="flex items-center gap-1 rounded text-2xs text-muted-foreground transition-colors hover:text-foreground"
                                      onClick={() => downloadDnsFile()}
                                    >
                                      <DownloadIcon className="size-3" />
                                      Download
                                    </button>
                                  </div>
                                </div>
                                {customDomain.records
                                  .filter((record) => record.required)
                                  .map((record) => {
                                    const nameKey = `${record.type}:${record.name}:name`
                                    const valueKey = `${record.type}:${record.name}:value`
                                    return (
                                      <div
                                        key={`${record.purpose}:${record.type}:${record.name}:${record.value}`}
                                        className="grid gap-0.5 font-mono text-2xs"
                                      >
                                        <span className="text-muted-foreground">
                                          {record.type} · {record.purpose}
                                        </span>
                                        <button
                                          type="button"
                                          className="group flex items-center gap-1.5 truncate text-start hover:text-cx-accent"
                                          title="Copy record name"
                                          onClick={() => void copyRecordField(record, 'name')}
                                        >
                                          <span className="truncate">{record.name}</span>
                                          {dnsCopied === nameKey ? (
                                            <CheckIcon className="size-3 shrink-0 text-emerald-500" />
                                          ) : (
                                            <ClipboardIcon className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          className="group flex items-center gap-1.5 truncate text-start text-muted-foreground hover:text-cx-accent"
                                          title="Copy record value"
                                          onClick={() => void copyRecordField(record, 'value')}
                                        >
                                          <span className="truncate">{record.value}</span>
                                          {dnsCopied === valueKey ? (
                                            <CheckIcon className="size-3 shrink-0 text-emerald-500" />
                                          ) : (
                                            <ClipboardIcon className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
                                          )}
                                        </button>
                                      </div>
                                    )
                                  })}
                              </div>
                            ) : null}
                            <div className="flex justify-end gap-1 border-t pt-2">
                              {customDomainsAllowed &&
                              customDomainsEnabled &&
                              customDomainsConfigured ? (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  disabled={domainBusy}
                                  onClick={() => void refreshCustomDomain()}
                                >
                                  {domainBusy ? <Spinner /> : <RefreshCwIcon />}
                                  Refresh
                                </Button>
                              ) : null}
                              {customDomainsConfigured ? (
                                domainRemoving ? (
                                  <>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      disabled={domainBusy}
                                      onClick={() => setDomainRemoving(false)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      disabled={domainBusy}
                                      onClick={() => void removeCustomDomain()}
                                    >
                                      {domainBusy ? <Spinner /> : <Trash2Icon />}
                                      Confirm remove
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    disabled={domainBusy}
                                    onClick={() => setDomainRemoving(true)}
                                  >
                                    <Trash2Icon />
                                    Remove
                                  </Button>
                                )
                              ) : null}
                            </div>
                          </div>
                        ) : !customDomainsEnabled ? (
                          <p className="text-xs text-muted-foreground">
                            Custom domains are currently disabled.
                          </p>
                        ) : !customDomainsAllowed ? (
                          <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-2.5">
                            <p className="text-xs text-muted-foreground">
                              Serve this site from your own domain with managed TLS.
                            </p>
                            <UpgradeToProButton size="xs" />
                          </div>
                        ) : !customDomainsConfigured ? (
                          <p className="text-xs text-muted-foreground">
                            Custom domains are not configured on this deployment.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Input
                                value={domainDraft}
                                placeholder="www.example.com"
                                aria-label="Custom domain"
                                className="font-mono"
                                disabled={domainBusy}
                                onChange={(event) => setDomainDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void connectCustomDomain()
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                disabled={domainBusy || !domainDraft.trim()}
                                onClick={() => void connectCustomDomain()}
                              >
                                {domainBusy ? <Spinner /> : <Globe2Icon />}
                                Connect
                              </Button>
                            </div>
                            <p className="text-2xs text-muted-foreground">
                              After connecting, add the DNS records shown here at your provider. DNS propagation can take a few minutes to several hours.
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="grid h-40 place-items-center px-6 text-center">
                      <p className="text-xs text-muted-foreground">
                        Publish this Page to{' '}
                        <span className="font-mono">
                          /sites/{publishHandle}/…
                        </span>
                        .
                      </p>
                    </div>
                  )}
                </div>
              ) : format === 'handoff' ? (
                <div className="space-y-3 p-4">
                  {handoff ? (
                    <>
                      <textarea
                        readOnly
                        value={handoffPrompt}
                        aria-label="Agent handoff prompt"
                        className="min-h-40 w-full resize-none rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed outline-none"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <p className="text-xs text-muted-foreground">
                        Expires {new Date(handoff.expiresAt).toLocaleString()}.
                        Anyone with the link can read this document, so treat it
                        like a password.
                      </p>
                    </>
                  ) : (
                    <div className="grid h-40 place-items-center">
                      <Button
                        variant="outline"
                        disabled={handoffBusy || !controller.target}
                        onClick={() => void createHandoff()}
                      >
                        {handoffBusy ? <Spinner /> : <Link2Icon />}
                        {handoffBusy ? 'Creating link…' : 'Create handoff link'}
                      </Button>
                    </div>
                  )}
                </div>
              ) : format === 'png' ? (
                pngBusy ? (
                  <div className="grid size-full place-items-center">
                    <Spinner />
                  </div>
                ) : png ? (
                  <div className="grid size-full place-items-center p-4">
                    <img
                      src={png.url}
                      alt="Export preview"
                      className="max-h-full max-w-full object-contain"
                      onLoad={(event) =>
                        setPngSize({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="grid size-full place-items-center px-8 text-center">
                    <p className="text-xs text-muted-foreground">
                      Nothing was captured.
                    </p>
                  </div>
                )
              ) : view === 'code' || format === 'json' ? (
                <pre className="h-full overflow-auto bg-muted p-3 text-xs leading-5">
                  <code>{compiled?.error ?? compiled?.text ?? ''}</code>
                </pre>
              ) : compiled?.error || !previewHtml ? (
                <div className="grid size-full place-items-center px-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    {compiled?.error ?? 'Nothing to preview.'}
                  </p>
                </div>
              ) : (
                <div className="relative size-full">
                  <iframe
                    title="Export preview"
                    srcDoc={previewHtml}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    className="absolute top-0 border-0 bg-white"
                    style={{
                      width,
                      height:
                        previewScale > 0
                          ? Math.max(preview.box.height, 1) / previewScale
                          : preview.box.height,
                      left: Math.max(
                        12,
                        (preview.box.width - width * previewScale) / 2,
                      ),
                      transform: `scale(${previewScale || 1})`,
                      transformOrigin: 'top left',
                    }}
                  />
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t p-2.5">
              {error ? (
                <p className="min-w-0 flex-1 truncate text-xs text-destructive-foreground">
                  {error}
                </p>
              ) : (
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {format === 'publish'
                    ? publishedUrl
                      ? 'Anyone with the link can view the snapshot.'
                      : 'HTML is uploaded to storage; nothing is stored in the database.'
                    : format === 'handoff'
                      ? 'The prompt points an agent at the document itself.'
                      : `Saved as ${safeExportName(
                          format === 'json' ? document.name : target.name,
                          format === 'jsx' || format === 'tailwind'
                            ? 'jsx'
                            : format,
                        )}`}
                </p>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {format === 'publish' ? (
                <>
                  {publishedForPage ? (
                    <Button
                      variant="outline"
                      disabled={publishBusy || !controller.target || !pageId}
                      onClick={() => void unpublishCurrentPage()}
                    >
                      Unpublish
                    </Button>
                  ) : null}
                  {publishedForPage ? (
                    <Button
                      variant="outline"
                      disabled={
                        publishBusy ||
                        !controller.target ||
                        !pageId ||
                        Boolean(controller.target.draftId)
                      }
                      onClick={() => void publishCurrentPage()}
                    >
                      {publishBusy ? <Spinner /> : <Globe2Icon />}
                      Republish
                    </Button>
                  ) : null}
                  <Button
                    disabled={
                      publishBusy ||
                      !controller.target ||
                      !pageId ||
                      !publishHandle ||
                      Boolean(controller.target.draftId) ||
                      (Boolean(publishedUrl) && !canCopy)
                    }
                    title={
                      controller.target?.draftId
                        ? 'Publish from Main, not a branch'
                        : undefined
                    }
                    onClick={() =>
                      void (publishedUrl ? copy() : publishCurrentPage())
                    }
                  >
                    {publishBusy ? (
                      <Spinner />
                    ) : publishedUrl ? (
                      <ClipboardIcon />
                    ) : (
                      <Globe2Icon />
                    )}
                    {publishedUrl ? (copied ? 'Copied' : 'Copy link') : 'Publish'}
                  </Button>
                </>
              ) : format === 'handoff' ? (
                <Button
                  disabled={handoffBusy || !controller.target}
                  onClick={() => void (handoff ? copy() : createHandoff())}
                >
                  {handoffBusy ? <Spinner /> : <Link2Icon />}
                  {handoff ? 'Copy prompt' : 'Create link'}
                </Button>
              ) : (
                <Button
                  disabled={
                    pngBusy ||
                    assetsBusy ||
                    (format === 'png' ? !png : Boolean(compiled?.error))
                  }
                  onClick={save}
                >
                  {pngBusy || assetsBusy ? <Spinner /> : <DownloadIcon />}
                  Download
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
