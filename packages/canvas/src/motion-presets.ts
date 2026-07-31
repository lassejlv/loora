import type { CanvasTransition } from './motion'
import type { CanvasVisualState } from './model'

/**
 * Hover looks, ready made.
 *
 * The other half of "animate on hover": far more often than a keyframe
 * sequence, it is a transition between two styles. A preset is that pair — what
 * the node becomes, and how long it takes to get there — so asking for a card
 * that lifts is one call rather than a shadow table and a bezier.
 *
 * Kept apart from the keyframe presets because these need node style shapes and
 * those need none, which is the only thing deciding what may import what here.
 */

export interface HoverPreset {
  state: CanvasVisualState
  transition: CanvasTransition
}

const SOFT: CanvasTransition = { duration: 180, easing: 'ease-out' }

export const HOVER_PRESETS = {
  lift: {
    transition: SOFT,
    state: {
      transform: { y: -2, scale: 1.01 },
      style: {
        shadows: [
          {
            x: 0,
            y: 8,
            blur: 24,
            spread: -4,
            color: 'rgba(0,0,0,0.18)',
          },
        ],
      },
    },
  },
  grow: {
    transition: SOFT,
    state: { transform: { scale: 1.04 } },
  },
  shrink: {
    transition: { duration: 120, easing: 'ease-out' },
    state: { transform: { scale: 0.97 } },
  },
  fade: {
    transition: { duration: 160, easing: 'ease-out' },
    state: { style: { opacity: 0.75 } },
  },
  'nudge-right': {
    transition: SOFT,
    state: { transform: { x: 3 } },
  },
} as const satisfies Record<string, HoverPreset>

export type HoverPresetName = keyof typeof HOVER_PRESETS

export const HOVER_PRESET_NAMES = Object.keys(HOVER_PRESETS) as HoverPresetName[]

/** A fresh copy, because the caller is about to put it in a document. */
export function hoverPreset(name: HoverPresetName): HoverPreset {
  const preset: HoverPreset = HOVER_PRESETS[name]
  return {
    transition: { ...preset.transition },
    state: {
      ...(preset.state.transform ? { transform: { ...preset.state.transform } } : {}),
      ...(preset.state.style
        ? {
            style: {
              ...preset.state.style,
              ...(preset.state.style.shadows
                ? { shadows: preset.state.style.shadows.map((shadow) => ({ ...shadow })) }
                : {}),
            },
          }
        : {}),
    },
  }
}
