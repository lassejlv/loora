import { useEffect, useRef } from 'react'
import { sanitizeHtml } from '#/lib/sanitize'
import { mountFrameTailwind } from '#/lib/frame-tailwind'

const EDITOR_STYLE = `
:host { position: relative; }
[data-loora-selected] { outline: 2px solid #2440e6 !important; outline-offset: 2px; cursor: move !important; }
[data-loora-editing] { cursor: text !important; }
[data-loora-editor] {
  all: initial;
  box-sizing: border-box;
  position: absolute;
  z-index: 2147483647;
  top: 8px;
  left: 50%;
  translate: -50% 0;
  display: none;
  align-items: center;
  gap: 7px;
  max-width: calc(100% - 16px);
  padding: 6px 8px;
  border: 1px solid rgba(26, 25, 23, .16);
  border-radius: 10px;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 8px 24px rgba(26, 25, 23, .16);
  color: #1a1917;
  font: 500 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
}
[data-loora-editor][data-visible] { display: flex; }
[data-loora-editor] button {
  all: initial;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 6px;
  padding: 5px 7px;
  color: #1a1917;
  font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
[data-loora-editor] button:hover { background: #efeee9; }
[data-loora-editor] label { all: initial; display: flex; align-items: center; gap: 4px; color: #66635d; font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
[data-loora-editor] input[type=color] { all: initial; box-sizing: border-box; width: 20px; height: 20px; cursor: pointer; border: 1px solid rgba(26, 25, 23, .18); border-radius: 50%; overflow: hidden; }
[data-loora-editor] input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
[data-loora-editor] input[type=color]::-webkit-color-swatch { border: 0; }
[data-loora-tag] { color: #2440e6; }
[data-loora-help] { color: #8a867e; }
`

function colorToHex(value: string): string {
  if (/^#[\da-f]{6}$/i.test(value)) return value
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) return '#000000'
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function nodePath(root: ShadowRoot, element: HTMLElement): number[] {
  const path: number[] = []
  let node: Node = element
  while (node.parentNode && node.parentNode !== root) {
    path.unshift([...node.parentNode.childNodes].indexOf(node as ChildNode))
    node = node.parentNode
  }
  path.unshift([...root.childNodes].indexOf(node as ChildNode))
  return path
}

function elementAtPath(root: ShadowRoot, path: number[]): HTMLElement | null {
  let node: Node = root
  for (const index of path) {
    const next: ChildNode | undefined = node.childNodes[index]
    if (!next) return null
    node = next
  }
  return node instanceof HTMLElement ? node : null
}

function serializeFrame(root: ShadowRoot): string {
  const container = document.createElement('div')
  container.append(...[...root.childNodes].map((node) => node.cloneNode(true)))
  container.querySelectorAll('[data-loora-editor], [data-loora-frame-base]').forEach((node) => node.remove())
  container.querySelectorAll('[data-loora-selected]').forEach((node) => node.removeAttribute('data-loora-selected'))
  container.querySelectorAll('[data-loora-editing]').forEach((node) => {
    node.removeAttribute('data-loora-editing')
    node.removeAttribute('contenteditable')
  })
  return container.innerHTML
}

// Renders a frame's HTML inside a shadow root so styles stay scoped. In edit
// mode the real HTML nodes become selectable without letting their events leak
// to the outer canvas.
export function FrameBody({
  html,
  editable = false,
  onChange,
}: {
  html: string
  editable?: boolean
  onChange?: (html: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const selectedPathRef = useRef<number[] | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Mount-once: shadow root, twind engine, and navigation blocking survive
  // html updates so re-renders only swap innerHTML (no stylesheet teardown).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    // Frames should feel like a webpage (hover, cursors) but never navigate
    // the app: block link clicks and form submits inside the shadow tree.
    const blockNav = (event: Event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      if (path.some((node) => node instanceof HTMLAnchorElement && node.href)) {
        event.preventDefault()
      }
    }
    const blockSubmit = (event: Event) => event.preventDefault()
    root.addEventListener('click', blockNav, true)
    root.addEventListener('submit', blockSubmit, true)
    // Constructable stylesheets are missing in test DOMs; render unstyled there.
    const unmountTailwind =
      typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in root
        ? mountFrameTailwind(root)
        : undefined
    return () => {
      root.removeEventListener('click', blockNav, true)
      root.removeEventListener('submit', blockSubmit, true)
      unmountTailwind?.()
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style data-loora-frame-base>:host{display:block;height:100%;overflow:hidden}</style>${sanitizeHtml(html)}`
  }, [html])

  useEffect(() => {
    const root = hostRef.current?.shadowRoot
    if (!root || !editable) return

    const style = document.createElement('style')
    style.dataset.looraEditor = ''
    style.textContent = EDITOR_STYLE
    const toolbar = document.createElement('div')
    toolbar.dataset.looraEditor = ''
    toolbar.innerHTML = `
      <span data-loora-tag>element</span>
      <button type="button" data-loora-text>Edit text</button>
      <label>Text <input type="color" data-loora-color aria-label="Text color"></label>
      <label>Fill <input type="color" data-loora-fill aria-label="Background color"></label>
      <button type="button" data-loora-clear>Clear fill</button>
      <span data-loora-help>Drag to move</span>
    `
    root.append(style, toolbar)

    const tag = toolbar.querySelector<HTMLElement>('[data-loora-tag]')!
    const textButton = toolbar.querySelector<HTMLButtonElement>('[data-loora-text]')!
    const colorInput = toolbar.querySelector<HTMLInputElement>('[data-loora-color]')!
    const fillInput = toolbar.querySelector<HTMLInputElement>('[data-loora-fill]')!
    const clearButton = toolbar.querySelector<HTMLButtonElement>('[data-loora-clear]')!
    let selected: HTMLElement | null = null
    let stopTextEditing: (() => void) | null = null

    const commit = () => onChangeRef.current?.(sanitizeHtml(serializeFrame(root)))

    const select = (element: HTMLElement | null) => {
      selected?.removeAttribute('data-loora-selected')
      selected = element
      if (!selected) {
        selectedPathRef.current = null
        toolbar.removeAttribute('data-visible')
        return
      }
      selected.dataset.looraSelected = ''
      selectedPathRef.current = nodePath(root, selected)
      const computed = getComputedStyle(selected)
      tag.textContent = selected.tagName.toLowerCase()
      colorInput.value = colorToHex(computed.color)
      fillInput.value = colorToHex(computed.backgroundColor)
      toolbar.dataset.visible = ''
    }

    const startTextEditing = () => {
      if (!selected) return
      stopTextEditing?.()
      const element = selected
      element.dataset.looraEditing = ''
      element.contentEditable = 'true'
      element.focus()
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const finish = () => {
        element.removeEventListener('blur', finish)
        element.removeEventListener('keydown', onTextKeyDown)
        element.removeAttribute('data-loora-editing')
        element.removeAttribute('contenteditable')
        stopTextEditing = null
        commit()
      }
      const onTextKeyDown = (event: KeyboardEvent) => {
        event.stopPropagation()
        if (event.key === 'Escape') element.blur()
      }
      element.addEventListener('blur', finish)
      element.addEventListener('keydown', onTextKeyDown)
      stopTextEditing = finish
    }

    const onPointerDown = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent
      const target = event.composedPath().find(
        (node): node is HTMLElement => node instanceof HTMLElement && node.getRootNode() === root,
      )
      if (!target || target.closest('[data-loora-editor]')) return
      event.preventDefault()
      event.stopPropagation()
      select(target)
      if (target.hasAttribute('data-loora-editing')) return

      const existing = target.style.translate.match(/(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/)
      const originX = Number(existing?.[1] ?? 0)
      const originY = Number(existing?.[2] ?? 0)
      const startX = event.clientX
      const startY = event.clientY
      let moved = false

      const move = (next: PointerEvent) => {
        const dx = next.clientX - startX
        const dy = next.clientY - startY
        if (!moved && Math.hypot(dx, dy) < 2) return
        moved = true
        target.style.translate = `${Math.round(originX + dx)}px ${Math.round(originY + dy)}px`
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (moved) commit()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up, { once: true })
    }

    const onDoubleClick = (rawEvent: Event) => {
      const event = rawEvent as MouseEvent
      if ((event.target as Element).closest?.('[data-loora-editor]')) return
      event.preventDefault()
      event.stopPropagation()
      startTextEditing()
    }

    const restored = selectedPathRef.current ? elementAtPath(root, selectedPathRef.current) : null
    if (restored && !restored.matches('[data-loora-editor], [data-loora-frame-base]')) select(restored)

    textButton.addEventListener('click', startTextEditing)
    colorInput.addEventListener('input', () => {
      if (selected) selected.style.color = colorInput.value
    })
    colorInput.addEventListener('change', commit)
    fillInput.addEventListener('input', () => {
      if (selected) selected.style.backgroundColor = fillInput.value
    })
    fillInput.addEventListener('change', commit)
    clearButton.addEventListener('click', () => {
      if (!selected) return
      selected.style.backgroundColor = 'transparent'
      commit()
    })
    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('dblclick', onDoubleClick)

    return () => {
      stopTextEditing?.()
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('dblclick', onDoubleClick)
      style.remove()
      toolbar.remove()
      selected?.removeAttribute('data-loora-selected')
    }
  }, [editable, html])

  return (
    // Always pointer-events-auto: hover/cursor styles run in every mode, and
    // outside edit mode events bubble to the canvas so select/drag still work.
    <div
      ref={hostRef}
      className="relative h-full w-full pointer-events-auto"
      onPointerDown={editable ? (event) => event.stopPropagation() : undefined}
      onDoubleClick={editable ? (event) => event.stopPropagation() : undefined}
      // Native image/link drags would hijack the canvas move gesture.
      onDragStart={(event) => event.preventDefault()}
    />
  )
}
