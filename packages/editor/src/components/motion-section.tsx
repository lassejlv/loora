import { canvasId, type CanvasNode, type NodeRef } from '@loora/canvas/model'
import type { CanvasOperation } from '@loora/canvas/engine'
import {
  motionPreset,
  MOTION_PRESET_NAMES,
  type CanvasEasing,
  type CanvasNodeAnimation,
  type MotionPresetName,
} from '@loora/canvas/motion'
import {
  hoverPreset,
  HOVER_PRESET_NAMES,
  type HoverPresetName,
} from '@loora/canvas/motion-presets'
import { useCanvasDocument, useCanvasTransaction } from '@loora/canvas/react'
import { Trash2Icon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { NumberCell, Pair, Section, SelectCell } from './properties-panel'

/**
 * Motion, for the person holding the mouse.
 *
 * The model can express any keyframe sequence, and an agent over MCP reaches
 * all of it. This panel is deliberately the short version: pick a hover, pick an
 * animation and what starts it, set how long it takes. It writes exactly what
 * `animateNodes` writes, so a design moved by hand and a design moved by an
 * agent are the same document.
 */

const EASINGS: { value: string; label: string }[] = [
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in out' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease', label: 'Ease' },
  { value: 'linear', label: 'Linear' },
]

const TRIGGERS: { value: CanvasNodeAnimation['trigger']; label: string }[] = [
  { value: 'load', label: 'On load' },
  { value: 'in-view', label: 'When scrolled into view' },
  { value: 'always', label: 'Always' },
  { value: 'hover', label: 'While hovered' },
  { value: 'press', label: 'While pressed' },
]

const HOVER_LABELS: Record<HoverPresetName, string> = {
  lift: 'Lift',
  grow: 'Grow',
  shrink: 'Shrink',
  fade: 'Fade',
  'nudge-right': 'Nudge right',
}

const PRESET_LABELS: Record<MotionPresetName, string> = {
  'fade-in': 'Fade in',
  'fade-in-up': 'Fade in up',
  'fade-in-down': 'Fade in down',
  'slide-in-left': 'Slide in left',
  'slide-in-right': 'Slide in right',
  'scale-in': 'Scale in',
  pulse: 'Pulse',
  float: 'Float',
  spin: 'Spin',
}

/** Which preset a node's hover came from, or `custom` once it has been edited. */
function hoverPresetOf(node: CanvasNode): HoverPresetName | 'custom' | 'none' {
  const hover = node.visualStates?.hover
  if (!hover) return 'none'
  const current = JSON.stringify(hover)
  const match = HOVER_PRESET_NAMES.find(
    (name) => JSON.stringify(hoverPreset(name).state) === current,
  )
  return match ?? 'custom'
}

export function MotionSection({
  nodes,
  refs,
  readOnly,
}: {
  nodes: CanvasNode[]
  refs: NodeRef[]
  readOnly: boolean
}) {
  const document = useCanvasDocument()
  const transact = useCanvasTransaction()
  const node = nodes[0]
  if (!node) return null

  const animations = Object.values(document.animations ?? {})
  const play = node.animations?.[0] ?? null
  const hoverChoice = hoverPresetOf(node)
  const transition = node.transition
  const label = nodes.length > 1 ? `Update ${nodes.length} layers` : `Update ${node.name}`

  /**
   * One transaction for the whole change: an animation a node starts playing may
   * not exist on the document yet, and defining it separately would leave a
   * moment where the reference dangles.
   */
  const commit = (
    build: (node: CanvasNode) => CanvasOperation['type'] extends never ? never : {
      patch?: Record<string, unknown>
      unset?: string[]
    },
    define?: CanvasOperation[],
  ) => {
    if (readOnly) return
    const operations: CanvasOperation[] = [...(define ?? [])]
    refs.forEach((ref, index) => {
      const current = nodes[index]
      if (!current) return
      const change = build(current)
      if (!change.patch && !change.unset) return
      operations.push({
        type: 'node.patch',
        id: ref.nodeId,
        patch: (change.patch ?? {}) as never,
        ...(change.unset ? { unset: change.unset as never } : {}),
      })
    })
    if (operations.length === 0) return
    transact({ id: canvasId('tx'), label, operations })
  }

  const setHover = (choice: string) => {
    if (choice === 'none') {
      commit(() => ({ patch: {}, unset: ['visualStates'] }))
      return
    }
    if (choice === 'custom') return
    const preset = hoverPreset(choice as HoverPresetName)
    commit((current) => ({
      patch: {
        visualStates: { ...current.visualStates, hover: preset.state },
        transition: current.transition ?? preset.transition,
      },
    }))
  }

  const setTransition = (patch: { duration?: number; easing?: CanvasEasing }) => {
    commit((current) => ({
      patch: {
        transition: {
          duration: patch.duration ?? current.transition?.duration ?? 180,
          easing: patch.easing ?? current.transition?.easing ?? 'ease-out',
          ...(current.transition?.delay ? { delay: current.transition.delay } : {}),
        },
      },
    }))
  }

  const setAnimation = (value: string) => {
    if (value === 'none') {
      commit(() => ({ patch: {}, unset: ['animations'] }))
      return
    }
    // Choosing a preset the document has never seen defines it in the same
    // transaction that starts it.
    const preset = value.startsWith('preset:')
      ? motionPreset(value.slice('preset:'.length) as MotionPresetName)
      : null
    const animationId = preset ? preset.id : value
    commit(
      (current) => ({
        patch: {
          animations: [
            {
              animationId,
              trigger: current.animations?.[0]?.trigger ?? 'load',
              ...(current.animations?.[0]?.delay
                ? { delay: current.animations[0].delay }
                : {}),
            },
          ],
        },
      }),
      preset && !document.animations?.[preset.id]
        ? [{ type: 'animation.upsert', animation: preset }]
        : [],
    )
  }

  const setPlay = (patch: Partial<CanvasNodeAnimation>) => {
    commit((current) => {
      const existing = current.animations?.[0]
      if (!existing) return {}
      const next = { ...existing, ...patch }
      return {
        patch: {
          animations: [
            next.delay ? next : { animationId: next.animationId, trigger: next.trigger },
          ],
        },
      }
    })
  }

  const undefinedPresets = MOTION_PRESET_NAMES.filter(
    (name) => !document.animations?.[name],
  )

  return (
    <Section
      title="Motion"
      defaultOpen={false}
      action={
        node.visualStates || node.animations || node.transition ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove motion"
            disabled={readOnly}
            onClick={() =>
              commit(() => ({
                patch: {},
                unset: ['visualStates', 'transition', 'animations'],
              }))
            }
          >
            <Trash2Icon />
          </Button>
        ) : null
      }
    >
      <SelectCell
        label="Hover"
        value={hoverChoice}
        disabled={readOnly}
        onChange={setHover}
      >
        <option value="none">None</option>
        {HOVER_PRESET_NAMES.map((name) => (
          <option key={name} value={name}>
            {HOVER_LABELS[name]}
          </option>
        ))}
        {hoverChoice === 'custom' ? <option value="custom">Custom</option> : null}
      </SelectCell>

      <Pair>
        <NumberCell
          label="Time"
          value={transition?.duration ?? null}
          min={0}
          max={60_000}
          step={10}
          suffix="ms"
          disabled={readOnly}
          onCommit={(duration) => setTransition({ duration })}
        />
        <SelectCell
          label="Ease"
          value={
            typeof transition?.easing === 'string' ? transition.easing : 'ease-out'
          }
          disabled={readOnly}
          onChange={(easing) => setTransition({ easing: easing as CanvasEasing })}
        >
          {EASINGS.map((easing) => (
            <option key={easing.value} value={easing.value}>
              {easing.label}
            </option>
          ))}
        </SelectCell>
      </Pair>

      <SelectCell
        label="Animation"
        value={play?.animationId ?? 'none'}
        disabled={readOnly}
        onChange={setAnimation}
      >
        <option value="none">None</option>
        {animations.map((animation) => (
          <option key={animation.id} value={animation.id}>
            {animation.name}
          </option>
        ))}
        {undefinedPresets.length > 0 ? (
          <optgroup label="Add to this design">
            {undefinedPresets.map((name) => (
              <option key={name} value={`preset:${name}`}>
                {PRESET_LABELS[name]}
              </option>
            ))}
          </optgroup>
        ) : null}
      </SelectCell>

      {play ? (
        <Pair>
          <SelectCell
            label="Start"
            value={play.trigger}
            disabled={readOnly}
            onChange={(trigger) =>
              setPlay({ trigger: trigger as CanvasNodeAnimation['trigger'] })
            }
          >
            {TRIGGERS.map((trigger) => (
              <option key={trigger.value} value={trigger.value}>
                {trigger.label}
              </option>
            ))}
          </SelectCell>
          <NumberCell
            label="Delay"
            value={play.delay ?? 0}
            min={0}
            max={60_000}
            step={10}
            suffix="ms"
            disabled={readOnly}
            onCommit={(delay) => setPlay({ delay })}
          />
        </Pair>
      ) : null}
    </Section>
  )
}
