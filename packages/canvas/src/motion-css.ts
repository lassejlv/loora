import {
  animationCss,
  keyframesCss,
  transformCss,
  transitionCss,
  VISUAL_STATES,
  type CanvasAnimation,
  type VisualStateName,
} from './motion'
import type { CanvasDocument, CanvasNode, CanvasVisualState } from './model'
import { stylePatchDeclarations } from './style-css'

/**
 * The CSS a document's motion turns into.
 *
 * The editor and the exporter both read from here, which is the point: a hover
 * that lifts a card in the canvas is the same rule in the file you download. If
 * these were written twice they would drift, and the canvas would be showing
 * you something the export could not reproduce.
 *
 * Selectors are written against a caller-supplied prefix so the editor can
 * scope them to a node id and the export can scope them to a class.
 */

export const REDUCED_MOTION_QUERY = '@media (prefers-reduced-motion: reduce)'

/** A pointer state as the pseudo-class that fires it. */
const PSEUDO: Record<VisualStateName, string> = {
  hover: ':hover',
  press: ':active',
  focus: ':focus-visible',
}

export function visualStateDeclarations(
  document: CanvasDocument,
  state: CanvasVisualState,
  node?: CanvasNode,
) {
  const declarations = state.style
    ? stylePatchDeclarations(document, state.style, { asText: node?.type === 'text' })
    : []
  if (state.transform) {
    declarations.push(`transform:${transformCss(state.transform)}`)
  }
  return declarations
}

/**
 * Everything that has to sit outside the node's own declarations: the pointer
 * states, and the animations a pointer starts.
 */
export function nodeMotionRules(
  document: CanvasDocument,
  node: CanvasNode,
  selector: string,
) {
  const rules: string[] = []
  for (const name of VISUAL_STATES) {
    const state = node.visualStates?.[name]
    if (!state) continue
    const declarations = visualStateDeclarations(document, state, node)
    if (declarations.length === 0) continue
    rules.push(`${selector}${PSEUDO[name]}{${declarations.join(';')}}`)
  }

  const animations = document.animations ?? {}
  for (const use of node.animations ?? []) {
    if (use.trigger !== 'hover' && use.trigger !== 'press') continue
    const animation = animations[use.animationId]
    if (!animation) continue
    rules.push(
      `${selector}${PSEUDO[use.trigger === 'hover' ? 'hover' : 'press']}` +
        `{animation:${animationCss(animation, use)}}`,
    )
  }
  return rules
}

/** The declarations that belong on the node itself. */
export function nodeMotionDeclarations(document: CanvasDocument, node: CanvasNode) {
  const declarations: string[] = []
  if (node.transition) {
    declarations.push(`transition:${transitionCss(node.transition)}`)
  }
  const animations = document.animations ?? {}
  // `in-view` is treated as `load` wherever there is no scroll to wait for —
  // the editor shows the whole canvas at once, and an entrance that never plays
  // is worse than one that plays early.
  const playing = (node.animations ?? []).filter(
    (use) => use.trigger === 'load' || use.trigger === 'always' || use.trigger === 'in-view',
  )
  const shorthand = playing
    .map((use) => {
      const animation = animations[use.animationId]
      return animation ? animationCss(animation, use) : null
    })
    .filter((value): value is string => value !== null)
  if (shorthand.length > 0) declarations.push(`animation:${shorthand.join(',')}`)
  return declarations
}

export function usedAnimations(document: CanvasDocument, nodes: CanvasNode[]) {
  const defined = document.animations ?? {}
  const used = new Map<string, CanvasAnimation>()
  for (const node of nodes) {
    for (const use of node.animations ?? []) {
      const animation = defined[use.animationId]
      if (animation) used.set(animation.id, animation)
    }
  }
  return [...used.values()]
}

/**
 * The whole motion stylesheet for a set of nodes: the keyframes they use, their
 * pointer states, and the block that takes it all away for somebody who asked
 * the operating system not to be moved.
 */
export function motionStyleSheet(
  document: CanvasDocument,
  nodes: CanvasNode[],
  selectorFor: (node: CanvasNode) => string,
) {
  const animations = usedAnimations(document, nodes)
  const rules = [
    ...animations.map(keyframesCss),
    ...nodes.flatMap((node) => nodeMotionRules(document, node, selectorFor(node))),
  ]
  if (rules.length === 0) return ''

  const moving = nodes
    .filter((node) => node.transition || (node.animations ?? []).length > 0)
    .map(selectorFor)
  const stilled =
    moving.length > 0
      ? `${REDUCED_MOTION_QUERY}{${moving.join(',')}{animation:none!important;transition:none!important}}`
      : ''
  return rules.join('') + stilled
}
