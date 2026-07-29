import type { CanvasAction } from '@loora/canvas/model'

function findCanvasNode(root: ParentNode, id: string) {
  for (const node of root.querySelectorAll<HTMLElement>('[data-loora-node]')) {
    if (node.dataset.looraNode === id) return node
  }
  return null
}

export function setCanvasVariant(instance: HTMLElement, variant: string) {
  instance.dataset.looraVariant = variant
  let variants: Record<
    string,
    Record<
      string,
      { html?: string; src?: string; alt?: string; variant?: string }
    >
  >
  try {
    variants = JSON.parse(
      instance.dataset.looraVariantContent ?? '{}',
    ) as typeof variants
  } catch {
    return
  }
  for (const [nodeId, value] of Object.entries(variants[variant] ?? {})) {
    const node = findCanvasNode(instance, nodeId)
    if (!node) continue
    if (typeof value.html === 'string') node.innerHTML = value.html
    if (node.tagName === 'IMG') {
      if (typeof value.src === 'string') node.setAttribute('src', value.src)
      if (typeof value.alt === 'string') node.setAttribute('alt', value.alt)
    }
    if (
      typeof value.variant === 'string' &&
      node.hasAttribute('data-loora-component')
    ) {
      setCanvasVariant(node, value.variant)
    }
  }
}

export function applyCanvasActions(
  root: HTMLElement,
  actions: CanvasAction[],
) {
  for (const action of actions) {
    if (action.type === 'open-url') {
      window.open(
        action.url,
        action.target ?? '_self',
        action.target === '_blank' ? 'noopener,noreferrer' : undefined,
      )
      continue
    }
    if (action.type === 'navigate') {
      findCanvasNode(root, action.pageId)?.scrollIntoView({
        behavior: 'smooth',
      })
      continue
    }
    if (action.type === 'visibility') {
      const node = findCanvasNode(root, action.nodeId)
      if (!node) continue
      const hidden = node.hidden || node.style.display === 'none'
      node.hidden =
        action.value === 'hide' ||
        (action.value === 'toggle' && !hidden)
      continue
    }
    if (action.type === 'open-overlay') {
      const overlay = findCanvasNode(root, action.pageId)
      if (overlay) overlay.dataset.looraOverlay = 'open'
      continue
    }
    if (action.type === 'close-overlay') {
      const overlay = root.querySelector<HTMLElement>(
        '[data-loora-overlay="open"]',
      )
      if (overlay) delete overlay.dataset.looraOverlay
      continue
    }
    const instance = findCanvasNode(root, action.instanceId)
    if (instance) setCanvasVariant(instance, action.variant)
  }
}
