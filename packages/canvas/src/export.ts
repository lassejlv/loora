import {
  type CanvasAction,
  type CanvasColor,
  type CanvasDocument,
  type CanvasLength,
  type CanvasNode,
  type CanvasPaint,
  type CanvasStyle,
  type InstanceNode,
  type NodeId,
  type NodePatch,
  assertDocument,
  orderedChildren,
  resolveNodeAtWidth,
  stateDefinitionsForNode,
} from './model'

export interface CanvasExportOptions {
  pageId?: NodeId
  nodeId?: NodeId
  title?: string
  assetUrl?: (url: string) => string
  width?: number
}

export interface CompiledCanvas {
  html: string
  css: string
  runtime: string
}

export interface CanvasPngRenderOptions {
  width?: number
  height?: number
  pixelRatio?: number
  /** Called for each image that had to be left out of the capture. */
  onSkippedImage?: (src: string) => void
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('`', '&#96;')
}

function className(id: string) {
  return `loora-${[...id]
    .map((character) =>
      /[a-zA-Z0-9-]/.test(character)
        ? character
        : `_u${character.codePointAt(0)!.toString(16)}_`,
    )
    .join('')}`
}

function escapeCssString(value: string) {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0)!
      if (character === '\\' || character === '"' || code < 32 || code === 127) {
        return `\\${code.toString(16)} `
      }
      return character
    })
    .join('')
}

function colorValue(_document: CanvasDocument, color: CanvasColor) {
  if (typeof color === 'string') return color
  return `var(--loora-token-${color.token.replace(/[^a-zA-Z0-9_-]/g, '-')})`
}

function paintValue(document: CanvasDocument, paint: CanvasPaint) {
  if (paint.type === 'solid') return colorValue(document, paint.color)
  return `linear-gradient(${paint.angle}deg, ${paint.stops
    .map((stop) => `${colorValue(document, stop.color)} ${stop.offset * 100}%`)
    .join(', ')})`
}

function lengthValue(length: CanvasLength, axis: 'width' | 'height') {
  switch (length.unit) {
    case 'px':
      return `${length.value}px`
    case 'percent':
      return `${length.value}%`
    case 'fill':
      return '100%'
    case 'hug':
      return axis === 'width' ? 'fit-content' : 'auto'
  }
}

function styleDeclarations(document: CanvasDocument, node: CanvasNode) {
  const { layout, style } = node
  const declarations: string[] = [
    'box-sizing:border-box',
    `position:${layout.position === 'absolute' ? 'absolute' : 'relative'}`,
    `width:${lengthValue(layout.width, 'width')}`,
    `height:${lengthValue(layout.height, 'height')}`,
    `opacity:${style.opacity}`,
    `overflow:${style.overflow}`,
  ]
  if (layout.position === 'absolute') {
    declarations.push(`left:${layout.x}px`, `top:${layout.y}px`)
  }
  if (layout.minWidth !== undefined) declarations.push(`min-width:${layout.minWidth}px`)
  if (layout.maxWidth !== undefined) declarations.push(`max-width:${layout.maxWidth}px`)
  if (layout.minHeight !== undefined) declarations.push(`min-height:${layout.minHeight}px`)
  if (layout.maxHeight !== undefined) declarations.push(`max-height:${layout.maxHeight}px`)
  if (layout.aspectRatio !== undefined) declarations.push(`aspect-ratio:${layout.aspectRatio}`)
  if (node.rotation) declarations.push(`transform:rotate(${node.rotation}deg)`)
  if (node.type === 'text' && style.fills[0]?.type === 'solid') {
    declarations.push(`color:${colorValue(document, style.fills[0].color)}`)
  } else if (style.fills.length > 0) {
    declarations.push(`background:${style.fills.map((paint) => paintValue(document, paint)).join(',')}`)
  }
  if (style.stroke) {
    declarations.push(
      `border:${style.stroke.width}px ${style.stroke.style ?? 'solid'} ${colorValue(document, style.stroke.color)}`,
    )
  }
  const radii = Array.isArray(style.radius) ? style.radius : [style.radius]
  declarations.push(`border-radius:${radii.map((radius) => `${radius}px`).join(' ')}`)
  if (style.shadows.length > 0) {
    declarations.push(
      `box-shadow:${style.shadows
        .map(
          (shadow) =>
            `${shadow.inset ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${colorValue(document, shadow.color)}`,
        )
        .join(',')}`,
    )
  }
  if (style.blendMode) declarations.push(`mix-blend-mode:${style.blendMode}`)
  if (layout.mode === 'flex') {
    declarations.push(
      'display:flex',
      `flex-direction:${layout.direction ?? 'row'}`,
      `flex-wrap:${layout.wrap ? 'wrap' : 'nowrap'}`,
      `gap:${layout.gap ?? 0}px`,
      `align-items:${layout.align ?? 'stretch'}`,
      `justify-content:${layout.justify ?? 'start'}`,
    )
  } else if (layout.mode === 'grid') {
    declarations.push(
      'display:grid',
      `grid-template-columns:repeat(${Math.max(1, layout.columns ?? 1)},minmax(0,1fr))`,
      `gap:${layout.gap ?? 0}px`,
      `align-items:${layout.align ?? 'stretch'}`,
      `justify-content:${layout.justify ?? 'start'}`,
    )
  }
  if (layout.padding) {
    declarations.push(
      `padding:${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px`,
    )
  }
  if (style.typography) {
    const typography = style.typography
    declarations.push(
      `font-family:${JSON.stringify(typography.family)}`,
      `font-size:${typography.size}px`,
      `font-weight:${typography.weight}`,
      `line-height:${typography.lineHeight}`,
      `letter-spacing:${typography.letterSpacing}px`,
      `text-align:${typography.align}`,
      `text-decoration:${typography.decoration ?? 'none'}`,
      `text-transform:${typography.transform ?? 'none'}`,
    )
  }
  // Must come last: flex/grid layout also emits a display declaration.
  if (node.hidden) declarations.push('display:none')
  return declarations.join(';')
}

function applyPatch(node: CanvasNode, patch: NodePatch | undefined): CanvasNode {
  if (!patch) return node
  return {
    ...node,
    ...patch,
    layout: patch.layout ? { ...node.layout, ...patch.layout } : node.layout,
    style: patch.style ? { ...node.style, ...patch.style } as CanvasStyle : node.style,
  } as CanvasNode
}

function asInstanceComponentRoot(node: CanvasNode): CanvasNode {
  const layout = { ...node.layout }
  delete layout.minWidth
  delete layout.maxWidth
  delete layout.minHeight
  delete layout.maxHeight
  delete layout.aspectRatio
  return {
    ...node,
    layout: {
      ...layout,
      position: 'flow',
      x: 0,
      y: 0,
      width: { unit: 'fill' },
      height: { unit: 'fill' },
    },
  } as CanvasNode
}

function instanceVariant(
  document: CanvasDocument,
  instance: InstanceNode,
) {
  const component = document.nodes[instance.componentId]
  if (component?.type !== 'component') return undefined
  return instance.variant ?? component.defaultVariant
}

function applyInstancePatches(
  document: CanvasDocument,
  node: CanvasNode,
  instance: InstanceNode | undefined,
  variant = instance ? instanceVariant(document, instance) : undefined,
) {
  if (!instance) return node
  const component = document.nodes[instance.componentId]
  const variantPatch =
    component?.type === 'component' && variant
      ? component.variantOverrides[variant]?.[node.id]
      : undefined
  return applyPatch(
    applyPatch(node, variantPatch),
    instance.overrides[node.id],
  )
}

function renderActions(actions: CanvasAction[]) {
  return escapeAttribute(JSON.stringify(actions))
}

function runtimeThemeValues(document: CanvasDocument) {
  return Object.fromEntries(
    Object.values(document.themes).map((theme) => [
      theme.id,
      Object.fromEntries(
        Object.values(document.tokens).map((token) => [
          `--loora-token-${token.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
          token.modes?.[theme.id] ?? token.value,
        ]),
      ),
    ]),
  )
}

function renderInteractions(
  interactions: CanvasNode['interactions'],
) {
  return escapeAttribute(JSON.stringify(interactions))
}

function renderedStateDefinitions(
  document: CanvasDocument,
  node: CanvasNode,
  exportedRoot: boolean,
) {
  const own =
    node.type === 'page' || node.type === 'component'
      ? node.states ?? {}
      : {}
  if (Object.keys(own).length > 0) return own
  return exportedRoot ? stateDefinitionsForNode(document, node.id) : {}
}

function textMarkup(document: CanvasDocument, node: Extract<CanvasNode, { type: 'text' }>) {
  if (node.runs.length === 0) return escapeHtml(node.text)
  const boundaries = new Set([0, node.text.length])
  for (const run of node.runs) {
    boundaries.add(Math.max(0, Math.min(node.text.length, run.start)))
    boundaries.add(Math.max(0, Math.min(node.text.length, run.end)))
  }
  const sorted = [...boundaries].sort((left, right) => left - right)
  return sorted
    .slice(0, -1)
    .map((start, index) => {
      const end = sorted[index + 1]
      const run = node.runs.find((candidate) => candidate.start <= start && candidate.end >= end)
      if (!run) return escapeHtml(node.text.slice(start, end))
      const styles: string[] = []
      if (run.color) styles.push(`color:${colorValue(document, run.color)}`)
      for (const [key, value] of Object.entries(run.typography ?? {})) {
        const cssKey = key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
        styles.push(`${cssKey}:${typeof value === 'number' && key !== 'weight' && key !== 'lineHeight' ? `${value}px` : value}`)
      }
      return `<span style="${escapeAttribute(styles.join(';'))}">${escapeHtml(node.text.slice(start, end))}</span>`
    })
    .join('')
}

function instanceVariantContent(
  document: CanvasDocument,
  componentId: NodeId,
  instance: InstanceNode,
  options: CanvasExportOptions,
) {
  const component = document.nodes[componentId]
  if (component?.type !== 'component') return {}
  const sourceNodes: CanvasNode[] = []
  const queue = [...orderedChildren(document, component.id)]
  while (queue.length > 0) {
    const source = queue.shift()!
    sourceNodes.push(source)
    if (source.type !== 'instance') {
      queue.push(...orderedChildren(document, source.id))
    }
  }
  const output: Record<
    string,
    Record<
      NodeId,
      { html?: string; src?: string; alt?: string; variant?: string }
    >
  > = {}
  for (const variant of component.variants) {
    const values: Record<
      NodeId,
      { html?: string; src?: string; alt?: string; variant?: string }
    > = {}
    for (const source of sourceNodes) {
      const node = applyInstancePatches(
        document,
        source,
        instance,
        variant,
      )
      if (node.type === 'text') {
        values[node.id] = { html: textMarkup(document, node) }
      } else if (node.type === 'image') {
        values[node.id] = {
          src: options.assetUrl?.(node.src) ?? node.src,
          alt: node.alt,
        }
      } else if (node.type === 'instance') {
        const nested = document.nodes[node.componentId]
        const nestedVariant =
          node.variant ??
          (nested?.type === 'component'
            ? nested.defaultVariant
            : undefined)
        if (nestedVariant) values[node.id] = { variant: nestedVariant }
      }
    }
    output[variant] = values
  }
  return output
}

function renderNode(
  document: CanvasDocument,
  rawNode: CanvasNode,
  options: CanvasExportOptions,
  instance?: InstanceNode,
  exportedRoot = false,
): string {
  const width = options.width ?? 1440
  const responsive = resolveNodeAtWidth(document, rawNode, width)
  const node = applyInstancePatches(document, responsive, instance)
  const classes = className(instance ? `${instance.id}-${node.id}` : node.id)
  const clickActions = node.interactions.flatMap((interaction) =>
    interaction.trigger === 'click' ? interaction.actions : [],
  )
  const states = renderedStateDefinitions(document, rawNode, exportedRoot)
  const common = `class="${classes}" data-loora-node="${escapeAttribute(node.id)}"${
    exportedRoot
      ? ` data-loora-export-root="true" data-loora-theme="${escapeAttribute(document.activeThemeId)}" data-loora-theme-values="${escapeAttribute(JSON.stringify(runtimeThemeValues(document)))}"`
      : ''
  }${
    clickActions.length > 0 ? ` data-loora-actions="${renderActions(clickActions)}"` : ''
  }${
    node.interactions.length > 0
      ? ` data-loora-interactions="${renderInteractions(node.interactions)}"`
      : ''
  }${
    Object.keys(states).length > 0
      ? ` data-loora-states="${escapeAttribute(JSON.stringify(states))}"`
      : ''
  }`
  if (node.type === 'text') {
    return `<div ${common}>${textMarkup(document, node)}</div>`
  }
  if (node.type === 'image') {
    const src = options.assetUrl?.(node.src) ?? node.src
    return `<img ${common} src="${escapeAttribute(src)}" alt="${escapeAttribute(node.alt)}" style="object-fit:${node.fit}" />`
  }
  if (node.type === 'shape') {
    return `<div ${common}></div>`
  }
  if (node.type === 'vector') {
    const paths = node.paths
      .map(
        (path) =>
          `<path d="${escapeAttribute(path.d)}"${
            path.fill ? ` fill="${escapeAttribute(colorValue(document, path.fill))}"` : ' fill="none"'
          }${path.stroke ? ` stroke="${escapeAttribute(colorValue(document, path.stroke))}"` : ''}${
            path.strokeWidth !== undefined ? ` stroke-width="${path.strokeWidth}"` : ''
          } />`,
      )
      .join('')
    return `<svg ${common} viewBox="${escapeAttribute(node.viewBox)}" aria-hidden="true">${paths}</svg>`
  }
  if (node.type === 'instance') {
    const component = document.nodes[node.componentId]
    if (!component || component.type !== 'component') return ''
    const children = renderNode(document, component, options, node)
    const variant = node.variant ?? component.defaultVariant ?? ''
    const content = instanceVariantContent(
      document,
      component.id,
      node,
      options,
    )
    return `<div ${common} data-loora-component="${escapeAttribute(component.id)}" data-loora-variant="${escapeAttribute(variant)}" data-loora-variant-content="${escapeAttribute(JSON.stringify(content))}">${children}</div>`
  }
  if (node.type === 'component') {
    if (!instance) return ''
    const children = orderedChildren(document, node.id)
      .map((child) => renderNode(document, child, options, instance))
      .join('')
    return `<div ${common} data-loora-component-root="${escapeAttribute(instance.id)}">${children}</div>`
  }
  const tag = node.type === 'frame' ? node.semanticTag : node.type === 'page' ? 'main' : 'div'
  const children = orderedChildren(document, node.id)
    .map((child) => renderNode(document, child, options, instance))
    .join('')
  return `<${tag} ${common}>${children}</${tag}>`
}

function cssForNode(
  document: CanvasDocument,
  node: CanvasNode,
  instance?: InstanceNode,
  variant?: string,
  selectorPrefix = '',
) {
  const selector = `${selectorPrefix}.${className(instance ? `${instance.id}-${node.id}` : node.id)}`
  const patched = applyInstancePatches(
    document,
    node,
    instance,
    variant,
  )
  const styled =
    instance && patched.type === 'component'
      ? asInstanceComponentRoot(patched)
      : patched
  const base = `${selector}{${styleDeclarations(document, styled)}}`
  const pageBase =
    node.type === 'page'
      ? `${selector}{position:relative;left:0;top:0;width:100%;height:auto;min-height:${node.viewport.minHeight}px}`
      : ''
  const responsive = document.breakpoints
    .filter((breakpoint) => breakpoint.minWidth > 0 && node.responsive[breakpoint.id])
    .map((breakpoint) => {
      const resolved = resolveNodeAtWidth(document, node, breakpoint.minWidth)
      const responsive = applyInstancePatches(
        document,
        resolved,
        instance,
        variant,
      )
      return `@media(min-width:${breakpoint.minWidth}px){${selector}{${styleDeclarations(document, instance && responsive.type === 'component' ? asInstanceComponentRoot(responsive) : responsive)}}}`
    })
  return [base, pageBase, ...responsive].join('')
}

function collectCss(document: CanvasDocument) {
  const output: string[] = []
  for (const node of Object.values(document.nodes)) {
    output.push(cssForNode(document, node))
    if (node.type === 'instance') {
      const component = document.nodes[node.componentId]
      if (component?.type === 'component') {
        output.push(cssForNode(document, component, node))
        for (const variant of component.variants) {
          output.push(
            cssForNode(
              document,
              component,
              node,
              variant,
              `[data-loora-node="${escapeCssString(node.id)}"][data-loora-variant="${escapeCssString(variant)}"] `,
            ),
          )
        }
        const queue = [...orderedChildren(document, component.id)]
        while (queue.length > 0) {
          const child = queue.shift()!
          output.push(cssForNode(document, child, node))
          for (const variant of component.variants) {
            output.push(
              cssForNode(
                document,
                child,
                node,
                variant,
                `[data-loora-node="${escapeCssString(node.id)}"][data-loora-variant="${escapeCssString(variant)}"] `,
              ),
            )
          }
          queue.push(...orderedChildren(document, child.id))
        }
      }
    }
  }
  return output.join('\n')
}

export function compileCanvas(
  document: CanvasDocument,
  options: CanvasExportOptions = {},
): CompiledCanvas {
  assertDocument(document)
  const requestedNode = options.nodeId
    ? document.nodes[options.nodeId]
    : null
  if (
    options.nodeId &&
    (!requestedNode || requestedNode.type === 'component')
  ) {
    throw new Error(`Canvas export target "${options.nodeId}" does not exist`)
  }
  const roots = requestedNode
    ? [requestedNode]
    : Object.values(document.nodes)
        .filter(
          (node) =>
            node.type === 'page' &&
            (!options.pageId || node.id === options.pageId),
        )
        .sort(
          (left, right) =>
            left.order - right.order || left.id.localeCompare(right.id),
        )
  if (options.pageId && roots.length === 0) {
    throw new Error(`Canvas export Page "${options.pageId}" does not exist`)
  }
  const html = roots
    .map((root) => renderNode(document, root, options, undefined, true))
    .join('')
  const tokenCss = Object.values(document.tokens)
    .map((token) => {
      const value = token.modes?.[document.activeThemeId] ?? token.value
      return `--loora-token-${token.id.replace(/[^a-zA-Z0-9_-]/g, '-')}:${value};`
    })
    .join('')
  const themeCss = Object.values(document.themes)
    .map((theme) => {
      const values = Object.values(document.tokens)
        .filter((token) => token.modes?.[theme.id] !== undefined)
        .map(
          (token) =>
            `--loora-token-${token.id.replace(/[^a-zA-Z0-9_-]/g, '-')}:${token.modes![theme.id]};`,
        )
        .join('')
      return values
        ? `[data-loora-theme="${escapeAttribute(theme.id)}"]{${values}}`
        : ''
    })
    .join('')
  const css = `:root{${tokenCss}}\n${themeCss}\n${collectCss(document)}\n[data-loora-export-root="true"]{position:relative;left:0;top:0}`
  const runtime = `(function(){
var stateByScope=new WeakMap();
function read(target,name,fallback){try{return JSON.parse(target.getAttribute(name)||fallback)}catch(error){return JSON.parse(fallback)}}
function applyTheme(scope,themeId){
  scope.setAttribute('data-loora-theme',themeId);
  var source=(scope.matches&&scope.matches('[data-loora-theme-values]')?scope:null)||
    (scope.closest&&scope.closest('[data-loora-theme-values]'))||
    scope.querySelector('[data-loora-theme-values]')||
    document.querySelector('[data-loora-theme-values]');
  var values=source?read(source,'data-loora-theme-values','{}')[themeId]||{}:{};
  Object.keys(values).forEach(function(property){
    if(/^--loora-token-[a-zA-Z0-9_-]+$/.test(property))scope.style.setProperty(property,String(values[property]))
  })
}
function scopeFor(target){return target.closest('[data-loora-states]')||document.body}
function stateFor(scope){
  var current=stateByScope.get(scope);if(current)return current;
  var definitions=read(scope,'data-loora-states','{}');current={};
  Object.keys(definitions).forEach(function(id){current[id]=definitions[id].initial});
  stateByScope.set(scope,current);scope.setAttribute('data-loora-state-values',JSON.stringify(current));return current
}
function matches(item,state){
  return (item.when||[]).every(function(condition){
    var equal=Object.is(state[condition.stateId],condition.value);
    return condition.operator==='equals'?equal:!equal
  })
}
function actionsFor(target,trigger,scope,changedStateId){
  var state=stateFor(scope);
  return read(target,'data-loora-interactions','[]').filter(function(item){
    return item.trigger===trigger&&
      (trigger!=='state-change'||changedStateId===undefined||item.stateId===changedStateId)&&
      matches(item,state)
  }).flatMap(function(item){return item.actions||[]})
}
function findNode(scope,id){
  if(scope.matches&&scope.matches('[data-loora-node="'+CSS.escape(id)+'"]'))return scope;
  return scope.querySelector('[data-loora-node="'+CSS.escape(id)+'"]')||
    document.querySelector('[data-loora-node="'+CSS.escape(id)+'"]')
}
function setVariant(instance,variant){
  instance.dataset.looraVariant=variant;
  var variants=read(instance,'data-loora-variant-content','{}');
  var values=variants[variant]||{};
  Object.keys(values).forEach(function(nodeId){
    var node=instance.querySelector('[data-loora-node="'+CSS.escape(nodeId)+'"]');if(!node)return;
    var value=values[nodeId]||{};
    if(typeof value.html==='string')node.innerHTML=value.html;
    if(typeof value.src==='string'&&node.tagName==='IMG')node.setAttribute('src',value.src);
    if(typeof value.alt==='string'&&node.tagName==='IMG')node.setAttribute('alt',value.alt);
    if(typeof value.variant==='string'&&node.hasAttribute('data-loora-component'))setVariant(node,value.variant);
  })
}
function interactionTargets(scope){
  var targets=Array.from(scope.querySelectorAll('[data-loora-interactions]'));
  if(scope.matches&&scope.matches('[data-loora-interactions]'))targets.unshift(scope);
  return targets.filter(function(target){return scopeFor(target)===scope})
}
function runState(scope,stateId,depth){
  if(depth>20)return;
  interactionTargets(scope).forEach(function(target){
    applyActions(actionsFor(target,'state-change',scope,stateId),scope,depth+1)
  })
}
function applyActions(actions,scope,depth){
  actions.forEach(function(action){
    if(action.type==='set-state'||action.type==='toggle-state'||action.type==='increment-state'){
      var state=stateFor(scope),current=state[action.stateId],next=
        action.type==='set-state'?action.value:
        action.type==='toggle-state'?!current:
        (typeof current==='number'?current:0)+action.amount;
      if(!Object.is(current,next)){state[action.stateId]=next;scope.setAttribute('data-loora-state-values',JSON.stringify(state));runState(scope,action.stateId,depth+1)}
      return
    }
    if(action.type==='set-theme'){applyTheme(scope,action.themeId);return}
    if(action.type==='open-url'){window.open(action.url,action.target||'_self',action.target==='_blank'?'noopener,noreferrer':undefined);return}
    if(action.type==='navigate'){var page=findNode(document,action.pageId);if(page)page.scrollIntoView({behavior:'smooth'});return}
    if(action.type==='visibility'){var node=findNode(scope,action.nodeId);if(node){var hidden=node.hidden||node.style.display==='none';var show=action.value==='show'||(action.value==='toggle'&&hidden);node.hidden=!show;node.style.display=show?'':'none'}return}
    if(action.type==='open-overlay'){var overlay=findNode(document,action.pageId);if(overlay)overlay.dataset.looraOverlay='open';return}
    if(action.type==='close-overlay'){var open=document.querySelector('[data-loora-overlay="open"]');if(open)delete open.dataset.looraOverlay;return}
    if(action.type==='set-variant'){var instance=findNode(scope,action.instanceId);if(instance)setVariant(instance,action.variant)}
  })
}
function dispatch(trigger,event){
  var target=event.target&&event.target.closest&&event.target.closest('[data-loora-interactions]');if(!target)return;
  if((trigger==='hover'||trigger==='hover-end')&&event.relatedTarget&&target.contains(event.relatedTarget))return;
  if(trigger==='submit')event.preventDefault();
  var scope=scopeFor(target);applyActions(actionsFor(target,trigger,scope),scope,0)
}
document.addEventListener('click',function(event){dispatch('click',event)});
document.addEventListener('dblclick',function(event){dispatch('double-click',event)});
document.addEventListener('pointerover',function(event){dispatch('hover',event)});
document.addEventListener('pointerout',function(event){dispatch('hover-end',event)});
document.addEventListener('submit',function(event){dispatch('submit',event)});
document.addEventListener('change',function(event){dispatch('change',event)});
document.addEventListener('input',function(event){dispatch('input',event)});
document.addEventListener('focusin',function(event){dispatch('focus',event)});
document.addEventListener('focusout',function(event){dispatch('blur',event)});
document.querySelectorAll('[data-loora-states]').forEach(function(scope){stateFor(scope);runState(scope,undefined,0)});
})()`
  return { html, css, runtime }
}

export function compileStandaloneHtml(
  document: CanvasDocument,
  options: CanvasExportOptions = {},
) {
  const compiled = compileCanvas(document, options)
  const title = escapeHtml(options.title ?? document.name)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${title}</title>
<style>html,body{margin:0;min-height:100%}${compiled.css}</style>
</head>
<body>${compiled.html}<script>${compiled.runtime}<\/script></body>
</html>`
}

export function compileReactComponent(
  document: CanvasDocument,
  options: CanvasExportOptions = {},
) {
  const compiled = compileCanvas(document, options)
  const html = JSON.stringify(compiled.html)
  const css = JSON.stringify(compiled.css)
  return `import { useEffect, useRef, useState } from 'react'

const html = ${html}
const css = ${css}

function readJson(target, name, fallback) {
  try {
    return JSON.parse(target.getAttribute(name) || fallback)
  } catch {
    return JSON.parse(fallback)
  }
}

function targetNode(root, scope, nodeId) {
  if (scope.matches?.('[data-loora-node="' + CSS.escape(nodeId) + '"]')) {
    return scope
  }
  return scope.querySelector(
    '[data-loora-node="' + CSS.escape(nodeId) + '"]',
  ) || root.querySelector('[data-loora-node="' + CSS.escape(nodeId) + '"]')
}

function setVariant(instance, variant) {
  instance.dataset.looraVariant = variant
  const variants = readJson(instance, 'data-loora-variant-content', '{}')
  const values = variants[variant] || {}
  for (const [nodeId, value] of Object.entries(values)) {
    const node = instance.querySelector(
      '[data-loora-node="' + CSS.escape(nodeId) + '"]',
    )
    if (!node) continue
    if (typeof value.html === 'string') node.innerHTML = value.html
    if (typeof value.src === 'string' && node.tagName === 'IMG') {
      node.setAttribute('src', value.src)
    }
    if (typeof value.alt === 'string' && node.tagName === 'IMG') {
      node.setAttribute('alt', value.alt)
    }
    if (
      typeof value.variant === 'string' &&
      node.hasAttribute('data-loora-component')
    ) {
      setVariant(node, value.variant)
    }
  }
}

export default function LooraDesign() {
  const rootRef = useRef(null)
  const [, renderState] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const style = document.createElement('style')
    style.dataset.looraExport = 'true'
    style.textContent = css
    document.head.appendChild(style)

    const stateByScope = new WeakMap()
    const scopeFor = (target) =>
      target.closest('[data-loora-states]') || root
    const applyTheme = (scope, themeId) => {
      scope.dataset.looraTheme = themeId
      const source =
        scope.closest?.('[data-loora-theme-values]') ||
        scope.querySelector('[data-loora-theme-values]') ||
        root.querySelector('[data-loora-theme-values]')
      const values = source
        ? readJson(source, 'data-loora-theme-values', '{}')[themeId] || {}
        : {}
      for (const [property, value] of Object.entries(values)) {
        if (/^--loora-token-[a-zA-Z0-9_-]+$/.test(property)) {
          scope.style.setProperty(property, String(value))
        }
      }
    }
    const stateFor = (scope) => {
      const existing = stateByScope.get(scope)
      if (existing) return existing
      const definitions = readJson(scope, 'data-loora-states', '{}')
      const state = Object.fromEntries(
        Object.entries(definitions).map(([id, definition]) => [
          id,
          definition.initial,
        ]),
      )
      stateByScope.set(scope, state)
      scope.dataset.looraStateValues = JSON.stringify(state)
      return state
    }
    const matches = (interaction, state) =>
      (interaction.when || []).every((condition) => {
        const equal = Object.is(state[condition.stateId], condition.value)
        return condition.operator === 'equals' ? equal : !equal
      })
    const actionsFor = (target, trigger, scope, changedStateId) => {
      const state = stateFor(scope)
      return readJson(target, 'data-loora-interactions', '[]')
        .filter(
          (interaction) =>
            interaction.trigger === trigger &&
            (trigger !== 'state-change' ||
              changedStateId === undefined ||
              interaction.stateId === changedStateId) &&
            matches(interaction, state),
        )
        .flatMap((interaction) => interaction.actions || [])
    }
    const interactionTargets = (scope) => {
      const targets = [
        ...scope.querySelectorAll('[data-loora-interactions]'),
      ]
      if (scope.matches?.('[data-loora-interactions]')) targets.unshift(scope)
      return targets.filter((target) => scopeFor(target) === scope)
    }
    const runState = (scope, stateId, depth) => {
      if (depth > 20) return
      for (const target of interactionTargets(scope)) {
        applyActions(
          actionsFor(target, 'state-change', scope, stateId),
          scope,
          depth + 1,
        )
      }
    }
    const applyActions = (actions, scope, depth) => {
      for (const action of actions) {
        if (
          action.type === 'set-state' ||
          action.type === 'toggle-state' ||
          action.type === 'increment-state'
        ) {
          const state = stateFor(scope)
          const current = state[action.stateId]
          const next =
            action.type === 'set-state'
              ? action.value
              : action.type === 'toggle-state'
                ? !current
                : (typeof current === 'number' ? current : 0) + action.amount
          if (!Object.is(current, next)) {
            state[action.stateId] = next
            scope.dataset.looraStateValues = JSON.stringify(state)
            renderState((version) => version + 1)
            runState(scope, action.stateId, depth + 1)
          }
          continue
        }
        if (action.type === 'set-theme') {
          applyTheme(scope, action.themeId)
          continue
        }
        if (action.type === 'open-url') {
          window.open(
            action.url,
            action.target || '_self',
            action.target === '_blank' ? 'noopener,noreferrer' : undefined,
          )
          continue
        }
        if (action.type === 'navigate') {
          targetNode(root, root, action.pageId)?.scrollIntoView({
            behavior: 'smooth',
          })
          continue
        }
        if (action.type === 'visibility') {
          const node = targetNode(root, scope, action.nodeId)
          if (node) {
            const hidden = node.hidden || node.style.display === 'none'
            const show =
              action.value === 'show' ||
              (action.value === 'toggle' && hidden)
            node.hidden = !show
            node.style.display = show ? '' : 'none'
          }
          continue
        }
        if (action.type === 'open-overlay') {
          const overlay = targetNode(root, root, action.pageId)
          if (overlay) overlay.dataset.looraOverlay = 'open'
          continue
        }
        if (action.type === 'close-overlay') {
          const overlay = root.querySelector('[data-loora-overlay="open"]')
          if (overlay) delete overlay.dataset.looraOverlay
          continue
        }
        if (action.type === 'set-variant') {
          const instance = targetNode(root, scope, action.instanceId)
          if (instance) setVariant(instance, action.variant)
        }
      }
    }
    const handle = (trigger) => (event) => {
      const target = event.target?.closest?.('[data-loora-interactions]')
      if (!target || !root.contains(target)) return
      if (
        (trigger === 'hover' || trigger === 'hover-end') &&
        event.relatedTarget &&
        target.contains(event.relatedTarget)
      ) {
        return
      }
      if (trigger === 'submit') event.preventDefault()
      const scope = scopeFor(target)
      applyActions(actionsFor(target, trigger, scope), scope, 0)
    }
    const click = handle('click')
    const doubleClick = handle('double-click')
    const hover = handle('hover')
    const hoverEnd = handle('hover-end')
    const submit = handle('submit')
    const change = handle('change')
    const input = handle('input')
    const focus = handle('focus')
    const blur = handle('blur')
    root.addEventListener('click', click)
    root.addEventListener('dblclick', doubleClick)
    root.addEventListener('pointerover', hover)
    root.addEventListener('pointerout', hoverEnd)
    root.addEventListener('submit', submit)
    root.addEventListener('change', change)
    root.addEventListener('input', input)
    root.addEventListener('focusin', focus)
    root.addEventListener('focusout', blur)
    for (const scope of root.querySelectorAll('[data-loora-states]')) {
      stateFor(scope)
      runState(scope, undefined, 0)
    }
    return () => {
      style.remove()
      root.removeEventListener('click', click)
      root.removeEventListener('dblclick', doubleClick)
      root.removeEventListener('pointerover', hover)
      root.removeEventListener('pointerout', hoverEnd)
      root.removeEventListener('submit', submit)
      root.removeEventListener('change', change)
      root.removeEventListener('input', input)
      root.removeEventListener('focusin', focus)
      root.removeEventListener('focusout', blur)
    }
  }, [])
  return <div ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
}
`
}

type PortableCodeFormat = 'jsx' | 'tailwind'

function portableRoots(
  document: CanvasDocument,
  options: CanvasExportOptions,
) {
  assertDocument(document)
  const requestedNode = options.nodeId
    ? document.nodes[options.nodeId]
    : null
  if (
    options.nodeId &&
    (!requestedNode || requestedNode.type === 'component')
  ) {
    throw new Error(`Canvas export target "${options.nodeId}" does not exist`)
  }
  const roots = requestedNode
    ? [requestedNode]
    : Object.values(document.nodes)
        .filter(
          (node) =>
            node.type === 'page' &&
            (!options.pageId || node.id === options.pageId),
        )
        .sort(
          (left, right) =>
            left.order - right.order || left.id.localeCompare(right.id),
        )
  if (options.pageId && roots.length === 0) {
    throw new Error(`Canvas export Page "${options.pageId}" does not exist`)
  }
  return roots
}

function cssPropertyName(value: string) {
  return value.replace(/-([a-z])/g, (_, character: string) =>
    character.toUpperCase(),
  )
}

function portableDeclarations(
  document: CanvasDocument,
  node: CanvasNode,
  width: number,
  exportedRoot: boolean,
  instance?: InstanceNode,
) {
  const responsive = resolveNodeAtWidth(document, node, width)
  const patched = applyInstancePatches(document, responsive, instance)
  const styled =
    instance && patched.type === 'component'
      ? asInstanceComponentRoot(patched)
      : patched
  const declarations = new Map<string, string>()
  for (const item of styleDeclarations(document, styled).split(';')) {
    const separator = item.indexOf(':')
    if (separator <= 0) continue
    declarations.set(
      item.slice(0, separator),
      item.slice(separator + 1),
    )
  }
  if (styled.type === 'image') declarations.set('object-fit', styled.fit)
  if (styled.hidden) declarations.set('display', 'none')
  if (exportedRoot) {
    declarations.set('position', 'relative')
    declarations.set('left', '0')
    declarations.set('top', '0')
    if (styled.type === 'page') {
      declarations.set('width', '100%')
      declarations.set('height', 'auto')
      declarations.set('min-height', `${styled.viewport.minHeight}px`)
    }
  }
  return declarations
}

function jsxStyle(declarations: Map<string, string>) {
  const entries = [...declarations].map(
    ([property, value]) =>
      `${JSON.stringify(cssPropertyName(property))}: ${JSON.stringify(value)}`,
  )
  return `{{ ${entries.join(', ')} }}`
}

function tailwindValue(value: string) {
  return value
    .replaceAll('"', "'")
    .replace(/\s+/g, '_')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

function tailwindClasses(declarations: Map<string, string>) {
  return [...declarations]
    .map(
      ([property, value]) =>
        `[${property}:${tailwindValue(value)}]`,
    )
    .join(' ')
}

function portableAttributes(
  document: CanvasDocument,
  node: CanvasNode,
  format: PortableCodeFormat,
  options: CanvasExportOptions,
  exportedRoot: boolean,
  instance?: InstanceNode,
) {
  const width = options.width ?? 1440
  const responsive = resolveNodeAtWidth(document, node, width)
  const patched = applyInstancePatches(document, responsive, instance)
  const declarations = portableDeclarations(
    document,
    node,
    width,
    exportedRoot,
    instance,
  )
  const attributes = [
    `data-loora-node=${JSON.stringify(patched.id)}`,
    format === 'tailwind'
      ? `className=${JSON.stringify(tailwindClasses(declarations))}`
      : `style=${jsxStyle(declarations)}`,
  ]
  if (exportedRoot) {
    attributes.push(
      `data-loora-theme=${JSON.stringify(document.activeThemeId)}`,
      `data-loora-theme-values={${JSON.stringify(JSON.stringify(runtimeThemeValues(document)))}}`,
    )
  }
  if (patched.interactions.length > 0) {
    attributes.push(
      `data-loora-interactions={${JSON.stringify(JSON.stringify(patched.interactions))}}`,
    )
  }
  const states = renderedStateDefinitions(document, node, exportedRoot)
  if (Object.keys(states).length > 0) {
    attributes.push(
      `data-loora-states={${JSON.stringify(JSON.stringify(states))}}`,
    )
  }
  if (patched.type === 'instance') {
    const component = document.nodes[patched.componentId]
    if (component?.type === 'component') {
      const variant = patched.variant ?? component.defaultVariant ?? ''
      attributes.push(
        `data-loora-component=${JSON.stringify(component.id)}`,
        `data-loora-variant=${JSON.stringify(variant)}`,
        `data-loora-variant-content={${JSON.stringify(JSON.stringify(
          instanceVariantContent(document, component.id, patched, options),
        ))}}`,
      )
    }
  }
  const openUrl = patched.interactions
    .flatMap((interaction) =>
      interaction.trigger === 'click' ? interaction.actions : [],
    )
    .find((action) => action.type === 'open-url')
  if (patched.type === 'frame' && patched.semanticTag === 'a' && openUrl?.type === 'open-url') {
    attributes.push(`href=${JSON.stringify(openUrl.url)}`)
    if (openUrl.target) attributes.push(`target=${JSON.stringify(openUrl.target)}`)
    if (openUrl.target === '_blank') attributes.push('rel="noreferrer"')
  }
  return attributes.join(' ')
}

function indent(value: string, spaces: number) {
  const padding = ' '.repeat(spaces)
  return value
    .split('\n')
    .map((line) => `${padding}${line}`)
    .join('\n')
}

function portableText(node: Extract<CanvasNode, { type: 'text' }>) {
  return `{${JSON.stringify(node.text)}}`
}

function renderPortableNode(
  document: CanvasDocument,
  rawNode: CanvasNode,
  options: CanvasExportOptions,
  format: PortableCodeFormat,
  instance?: InstanceNode,
  exportedRoot = false,
): string {
  const width = options.width ?? 1440
  const responsive = resolveNodeAtWidth(document, rawNode, width)
  const node = applyInstancePatches(document, responsive, instance)
  const attributes = portableAttributes(
    document,
    rawNode,
    format,
    options,
    exportedRoot,
    instance,
  )
  if (node.type === 'text') {
    return `<div ${attributes}>${portableText(node)}</div>`
  }
  if (node.type === 'image') {
    const src = options.assetUrl?.(node.src) ?? node.src
    return `<img ${attributes} src=${JSON.stringify(src)} alt=${JSON.stringify(node.alt)} />`
  }
  if (node.type === 'shape') return `<div ${attributes} />`
  if (node.type === 'vector') {
    const paths = node.paths.map((path) => {
      const pathAttributes = [
        `d=${JSON.stringify(path.d)}`,
        path.fill
          ? `fill=${JSON.stringify(colorValue(document, path.fill))}`
          : 'fill="none"',
        path.stroke
          ? `stroke=${JSON.stringify(colorValue(document, path.stroke))}`
          : '',
        path.strokeWidth !== undefined
          ? `strokeWidth={${path.strokeWidth}}`
          : '',
      ].filter(Boolean)
      return `<path ${pathAttributes.join(' ')} />`
    })
    return `<svg ${attributes} viewBox=${JSON.stringify(node.viewBox)} aria-hidden="true">
${indent(paths.join('\n'), 2)}
</svg>`
  }
  if (node.type === 'instance') {
    const component = document.nodes[node.componentId]
    if (!component || component.type !== 'component') return ''
    const children = orderedChildren(document, component.id)
      .map((child) =>
        renderPortableNode(document, child, options, format, node),
      )
      .filter(Boolean)
    return `<div ${attributes}>
${indent(children.join('\n'), 2)}
</div>`
  }
  if (node.type === 'component') {
    if (!instance) return ''
    const children = orderedChildren(document, node.id)
      .map((child) =>
        renderPortableNode(document, child, options, format, instance),
      )
      .filter(Boolean)
    return `<div ${attributes}>
${indent(children.join('\n'), 2)}
</div>`
  }
  const tag =
    node.type === 'frame'
      ? node.semanticTag
      : node.type === 'page'
        ? 'main'
        : 'div'
  const children = orderedChildren(document, node.id)
    .map((child) =>
      renderPortableNode(document, child, options, format, instance),
    )
    .filter(Boolean)
  if (children.length === 0) return `<${tag} ${attributes} />`
  return `<${tag} ${attributes}>
${indent(children.join('\n'), 2)}
</${tag}>`
}

function tokenDeclarations(document: CanvasDocument) {
  return new Map(
    Object.values(document.tokens).map((token) => [
      `--loora-token-${token.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      String(token.modes?.[document.activeThemeId] ?? token.value),
    ]),
  )
}

function portableRuntimeSource() {
  return `function useLooraRuntime(rootRef) {
  const [, renderState] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const stores = new WeakMap()
    const read = (target, name, fallback) => {
      try {
        return JSON.parse(target.getAttribute(name) || fallback)
      } catch {
        return JSON.parse(fallback)
      }
    }
    const scopeFor = (target) =>
      target.closest('[data-loora-states]') || root
    const applyTheme = (scope, themeId) => {
      scope.dataset.looraTheme = themeId
      const source =
        scope.closest?.('[data-loora-theme-values]') ||
        scope.querySelector('[data-loora-theme-values]') ||
        root.querySelector('[data-loora-theme-values]')
      const values = source
        ? read(source, 'data-loora-theme-values', '{}')[themeId] || {}
        : {}
      for (const [property, value] of Object.entries(values)) {
        if (/^--loora-token-[a-zA-Z0-9_-]+$/.test(property)) {
          scope.style.setProperty(property, String(value))
        }
      }
    }
    const stateFor = (scope) => {
      const existing = stores.get(scope)
      if (existing) return existing
      const definitions = read(scope, 'data-loora-states', '{}')
      const state = Object.fromEntries(
        Object.entries(definitions).map(([id, definition]) => [
          id,
          definition.initial,
        ]),
      )
      stores.set(scope, state)
      scope.dataset.looraStateValues = JSON.stringify(state)
      return state
    }
    const findNode = (scope, id) => {
      const selector = '[data-loora-node="' + CSS.escape(id) + '"]'
      return (scope.matches?.(selector) ? scope : null) ||
        scope.querySelector(selector) ||
        root.querySelector(selector)
    }
    const setVariant = (instance, variant) => {
      instance.dataset.looraVariant = variant
      const variants = read(instance, 'data-loora-variant-content', '{}')
      for (const [nodeId, value] of Object.entries(variants[variant] || {})) {
        const node = instance.querySelector(
          '[data-loora-node="' + CSS.escape(nodeId) + '"]',
        )
        if (!node) continue
        if (typeof value.html === 'string') node.innerHTML = value.html
        if (typeof value.src === 'string' && node.tagName === 'IMG') {
          node.setAttribute('src', value.src)
        }
        if (typeof value.alt === 'string' && node.tagName === 'IMG') {
          node.setAttribute('alt', value.alt)
        }
        if (
          typeof value.variant === 'string' &&
          node.hasAttribute('data-loora-component')
        ) {
          setVariant(node, value.variant)
        }
      }
    }
    const matches = (interaction, state) =>
      (interaction.when || []).every((condition) => {
        const equal = Object.is(state[condition.stateId], condition.value)
        return condition.operator === 'equals' ? equal : !equal
      })
    const actionsFor = (target, trigger, scope, changedStateId) =>
      read(target, 'data-loora-interactions', '[]')
        .filter(
          (interaction) =>
            interaction.trigger === trigger &&
            (trigger !== 'state-change' ||
              changedStateId === undefined ||
              interaction.stateId === changedStateId) &&
            matches(interaction, stateFor(scope)),
        )
        .flatMap((interaction) => interaction.actions || [])
    const interactionTargets = (scope) => {
      const targets = [
        ...scope.querySelectorAll('[data-loora-interactions]'),
      ]
      if (scope.matches?.('[data-loora-interactions]')) targets.unshift(scope)
      return targets.filter((target) => scopeFor(target) === scope)
    }
    const runState = (scope, stateId, depth) => {
      if (depth > 20) return
      for (const target of interactionTargets(scope)) {
        applyActions(
          actionsFor(target, 'state-change', scope, stateId),
          scope,
          depth + 1,
        )
      }
    }
    const applyActions = (actions, scope, depth) => {
      for (const action of actions) {
        if (
          action.type === 'set-state' ||
          action.type === 'toggle-state' ||
          action.type === 'increment-state'
        ) {
          const state = stateFor(scope)
          const current = state[action.stateId]
          const next =
            action.type === 'set-state'
              ? action.value
              : action.type === 'toggle-state'
                ? !current
                : (typeof current === 'number' ? current : 0) + action.amount
          if (!Object.is(current, next)) {
            state[action.stateId] = next
            scope.dataset.looraStateValues = JSON.stringify(state)
            renderState((version) => version + 1)
            runState(scope, action.stateId, depth + 1)
          }
          continue
        }
        if (action.type === 'set-theme') {
          applyTheme(scope, action.themeId)
          continue
        }
        if (action.type === 'open-url') {
          window.open(
            action.url,
            action.target || '_self',
            action.target === '_blank' ? 'noopener,noreferrer' : undefined,
          )
          continue
        }
        if (action.type === 'navigate') {
          findNode(root, action.pageId)?.scrollIntoView({ behavior: 'smooth' })
          continue
        }
        if (action.type === 'visibility') {
          const node = findNode(scope, action.nodeId)
          if (node) {
            const hidden = node.hidden || node.style.display === 'none'
            const show =
              action.value === 'show' ||
              (action.value === 'toggle' && hidden)
            node.hidden = !show
            node.style.display = show ? '' : 'none'
          }
          continue
        }
        if (action.type === 'open-overlay') {
          const overlay = findNode(root, action.pageId)
          if (overlay) overlay.dataset.looraOverlay = 'open'
          continue
        }
        if (action.type === 'close-overlay') {
          const overlay = root.querySelector('[data-loora-overlay="open"]')
          if (overlay) delete overlay.dataset.looraOverlay
          continue
        }
        if (action.type === 'set-variant') {
          const instance = findNode(scope, action.instanceId)
          if (instance) setVariant(instance, action.variant)
        }
      }
    }
    const handle = (trigger) => (event) => {
      const target = event.target?.closest?.('[data-loora-interactions]')
      if (!target || !root.contains(target)) return
      if (
        (trigger === 'hover' || trigger === 'hover-end') &&
        event.relatedTarget &&
        target.contains(event.relatedTarget)
      ) {
        return
      }
      if (trigger === 'submit') event.preventDefault()
      const scope = scopeFor(target)
      applyActions(actionsFor(target, trigger, scope), scope, 0)
    }
    const listeners = [
      ['click', handle('click')],
      ['dblclick', handle('double-click')],
      ['pointerover', handle('hover')],
      ['pointerout', handle('hover-end')],
      ['submit', handle('submit')],
      ['change', handle('change')],
      ['input', handle('input')],
      ['focusin', handle('focus')],
      ['focusout', handle('blur')],
    ]
    for (const [event, listener] of listeners) {
      root.addEventListener(event, listener)
    }
    for (const scope of root.querySelectorAll('[data-loora-states]')) {
      stateFor(scope)
      runState(scope, undefined, 0)
    }
    return () => {
      for (const [event, listener] of listeners) {
        root.removeEventListener(event, listener)
      }
    }
  }, [rootRef])
}
`
}

function compilePortableComponent(
  document: CanvasDocument,
  options: CanvasExportOptions,
  format: PortableCodeFormat,
) {
  const roots = portableRoots(document, options)
    .map((root) =>
      renderPortableNode(
        document,
        root,
        options,
        format,
        undefined,
        true,
      ),
    )
    .filter(Boolean)
  const content =
    roots.length === 1
      ? roots[0]!
      : `<>
${indent(roots.join('\n'), 2)}
</>`
  const variables = tokenDeclarations(document)
  const variableAttributes =
    variables.size === 0
      ? ''
      : format === 'tailwind'
        ? ` className=${JSON.stringify(tailwindClasses(variables))}`
        : ` style=${jsxStyle(variables)}`
  const wrapped = variableAttributes
    ? `<div${variableAttributes}>
${indent(content, 2)}
</div>`
    : content
  const interactive = Object.values(document.nodes).some(
    (node) =>
      node.interactions.length > 0 ||
      ((node.type === 'page' || node.type === 'component') &&
        Object.keys(node.states ?? {}).length > 0),
  )
  if (!interactive) {
    return `export default function LooraDesign() {
  return (
${indent(wrapped, 4)}
  )
}
`
  }
  return `import { useEffect, useRef, useState } from 'react'

${portableRuntimeSource()}
export default function LooraDesign() {
  const rootRef = useRef(null)
  useLooraRuntime(rootRef)
  return (
    <div ref={rootRef} className="contents">
${indent(wrapped, 6)}
    </div>
  )
}
`
}

/** Pure JSX with structured Canvas styles expressed as React inline styles. */
export function compileJsxComponent(
  document: CanvasDocument,
  options: CanvasExportOptions = {},
) {
  return compilePortableComponent(document, options, 'jsx')
}

/**
 * JSX whose visual rules are literal Tailwind arbitrary-property utilities.
 * It needs no generated stylesheet and remains selection/page scoped.
 */
export function compileTailwindComponent(
  document: CanvasDocument,
  options: CanvasExportOptions = {},
) {
  return compilePortableComponent(document, options, 'tailwind')
}

export function serializeCanvasDocument(document: CanvasDocument) {
  assertDocument(document)
  return JSON.stringify(
    { schema: 'loora.canvas', version: 2, document },
    null,
    2,
  )
}

function loadBrowserImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('Canvas export image could not be decoded'))
    image.src = src
  })
}

/** 1×1 transparent GIF; stands in for an image that could not be embedded. */
const BLANK_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // String.fromCharCode is applied in chunks; a whole image at once overflows
  // the argument stack.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

/**
 * Rewrites every image in the clone to a data URL. A capture is rasterized by
 * drawing the serialized markup as an SVG image, and a reference the browser
 * loads from another origin taints the canvas — `toDataURL` then throws and
 * the whole export dies. So an image that cannot be read is blanked rather
 * than carried along, and reported to the caller.
 */
export async function inlineBrowserImages(root: Element) {
  const images = [
    ...root.querySelectorAll('img'),
    ...(root.tagName === 'IMG' ? [root as HTMLImageElement] : []),
  ]
  const skipped: string[] = []
  await Promise.all(
    images.map(async (image) => {
      // A srcset would reintroduce a remote candidate behind the src.
      image.removeAttribute('srcset')
      const source = image.getAttribute('src') ?? ''
      if (!source || source.startsWith('data:')) return
      try {
        const response = await fetch(image.src, {
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`Image responded ${response.status}`)
        image.setAttribute('src', await blobToDataUrl(await response.blob()))
      } catch {
        // Hosted elsewhere without permission to read it back. It cannot be
        // part of a PNG either way; leaving the URL in place would only turn
        // a missing image into a failed export.
        skipped.push(source)
        image.setAttribute('src', BLANK_IMAGE)
      }
    }),
  )
  return skipped
}

export async function renderElementToPng(
  element: HTMLElement | SVGElement,
  options: CanvasPngRenderOptions = {},
) {
  if (typeof document === 'undefined' || typeof XMLSerializer === 'undefined') {
    throw new Error('PNG rendering is available in a browser environment')
  }
  const bounds = element.getBoundingClientRect()
  const width = Math.max(1, Math.ceil(options.width ?? bounds.width))
  const height = Math.max(1, Math.ceil(options.height ?? bounds.height))
  const clone = element.cloneNode(true) as HTMLElement | SVGElement
  for (const skipped of await inlineBrowserImages(clone)) {
    options.onSkippedImage?.(skipped)
  }
  clone.style.position = 'relative'
  clone.style.left = '0'
  clone.style.top = '0'
  clone.style.transform = 'none'
  clone.style.margin = '0'
  const root =
    clone.namespaceURI === 'http://www.w3.org/2000/svg'
      ? document.createElement('div')
      : clone
  if (root !== clone) root.appendChild(clone)
  root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  const markup = new XMLSerializer().serializeToString(root)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml' }),
  )
  try {
    const image = await loadBrowserImage(url)
    const canvas = document.createElement('canvas')
    const pixelRatio = Math.max(
      0.1,
      Math.min(options.pixelRatio ?? window.devicePixelRatio ?? 1, 4),
    )
    canvas.width = Math.max(1, Math.round(width * pixelRatio))
    canvas.height = Math.max(1, Math.round(height * pixelRatio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas export context is unavailable')
    context.scale(pixelRatio, pixelRatio)
    context.drawImage(image, 0, 0, width, height)
    try {
      return canvas.toDataURL('image/png')
    } catch {
      // Every image is embedded before this point, so a tainted canvas here
      // means something else in the design is loaded from another origin.
      throw new Error(
        'The browser refused to read the capture back because part of this design is loaded from another site.',
      )
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
