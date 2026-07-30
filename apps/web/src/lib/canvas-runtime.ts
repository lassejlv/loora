import type {
  CanvasAction,
  CanvasEventTrigger,
  CanvasInteraction,
  CanvasStateDefinition,
  CanvasStateValue,
} from '@loora/canvas/model'

function findCanvasNode(root: ParentNode, id: string) {
  for (const node of root.querySelectorAll<HTMLElement>('[data-loora-node]')) {
    if (node.dataset.looraNode === id) return node
  }
  return null
}

export function setCanvasTheme(root: HTMLElement, themeId: string) {
  root.dataset.looraTheme = themeId
  const source =
    root.closest<HTMLElement>('[data-loora-theme-values]') ??
    root.querySelector<HTMLElement>('[data-loora-theme-values]')
  if (!source) return
  let themes: Record<string, Record<string, string | number>>
  try {
    themes = JSON.parse(source.dataset.looraThemeValues ?? '{}') as typeof themes
  } catch {
    return
  }
  for (const [property, value] of Object.entries(themes[themeId] ?? {})) {
    if (!/^--loora-token-[a-zA-Z0-9_-]+$/.test(property)) continue
    root.style.setProperty(property, String(value))
  }
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

export function initialCanvasState(
  definitions: Record<string, CanvasStateDefinition>,
) {
  return Object.fromEntries(
    Object.entries(definitions).map(([id, definition]) => [
      id,
      definition.initial,
    ]),
  ) as Record<string, CanvasStateValue>
}

export function canvasInteractionActions(
  interactions: CanvasInteraction[],
  trigger: CanvasEventTrigger,
  state: Record<string, CanvasStateValue>,
  changedStateId?: string,
) {
  return interactions
    .filter(
      (interaction) =>
        interaction.trigger === trigger &&
        (trigger !== 'state-change' ||
          changedStateId === undefined ||
          interaction.stateId === changedStateId) &&
        (interaction.when ?? []).every((condition) => {
          const equal = Object.is(state[condition.stateId], condition.value)
          return condition.operator === 'equals' ? equal : !equal
        }),
    )
    .flatMap((interaction) => interaction.actions)
}

export interface CanvasActionContext {
  state?: Record<string, CanvasStateValue>
  onStateChange?: (stateId: string) => void
}

export function applyCanvasActions(
  root: HTMLElement,
  actions: CanvasAction[],
  context: CanvasActionContext = {},
) {
  for (const action of actions) {
    if (
      action.type === 'set-state' ||
      action.type === 'toggle-state' ||
      action.type === 'increment-state'
    ) {
      if (!context.state) continue
      const current = context.state[action.stateId]
      const next =
        action.type === 'set-state'
          ? action.value
          : action.type === 'toggle-state'
            ? !current
            : (typeof current === 'number' ? current : 0) + action.amount
      if (Object.is(current, next)) continue
      context.state[action.stateId] = next
      context.onStateChange?.(action.stateId)
      continue
    }
    if (action.type === 'set-theme') {
      setCanvasTheme(root, action.themeId)
      continue
    }
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
    if (action.type === 'set-variant') {
      const instance = findCanvasNode(root, action.instanceId)
      if (instance) setCanvasVariant(instance, action.variant)
    }
  }
}
