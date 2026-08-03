import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from 'react'
import {
  canvasId,
  type CanvasInsets,
  type CanvasLayout,
  type CanvasLength,
  type CanvasNode,
  type CanvasPaint,
  type CanvasStyle,
  type CanvasTypography,
  type NodeMutationPatch,
  type NodePatch,
  type NodeRef,
  resolveNodeRef,
  type VectorNode,
} from '@loora/canvas/model'
import {
  useCanvasDocument,
  useCanvasReadOnly,
  useCanvasSelection,
  useCanvasTransaction,
} from '@loora/canvas/react'
import type { CanvasOperation } from '@loora/canvas/engine'
import {
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignEndHorizontalIcon,
  AlignEndVerticalIcon,
  AlignHorizontalSpaceAroundIcon,
  AlignHorizontalSpaceBetweenIcon,
  AlignJustifyIcon,
  AlignStartHorizontalIcon,
  AlignStartVerticalIcon,
  StretchHorizontalIcon,
  Trash2Icon,
  Unlink2Icon,
} from '@loora/ui/icons'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Link2Icon,
} from '@loora/ui/icons'
import { PanelEmpty, PanelShell } from '@loora/ui/panel-shell'
import { Button } from '@loora/ui/button'
import { cn } from '@loora/ui/utils'
import { MotionSection } from './motion-section'

function operationFor(
  ref: NodeRef,
  patch: NodeMutationPatch,
  replace?: (keyof NodeMutationPatch)[],
): CanvasOperation {
  const instanceId = ref.instancePath.at(-1)
  // Instance overrides always merge; a whole-object replace belongs to the
  // source node, which is where a removed stroke or constraint has to happen.
  return instanceId
    ? {
        type: 'instance.patchOverride',
        id: instanceId,
        targetId: ref.nodeId,
        patch: patch as NodePatch,
      }
    : { type: 'node.patch', id: ref.nodeId, patch, ...(replace ? { replace } : {}) }
}

const control =
  'h-7 w-full min-w-0 rounded-md border bg-background text-xs outline-none focus-within:border-ring'

const MIXED = 'Mixed'

/** The one value every selected node shares, or null when they disagree. */
function shared<T>(values: T[]): T | null {
  if (values.length === 0) return null
  const [first] = values
  const key = JSON.stringify(first ?? null)
  return values.every((value) => JSON.stringify(value ?? null) === key)
    ? (first as T)
    : null
}

/** Inspector numbers are display values: 537.549560854 helps nobody. */
function round(value: number, places = 2) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function inspectedLength(
  node: CanvasNode,
  axis: 'width' | 'height',
): CanvasLength {
  const length = node.layout[axis]
  if (
    node.type !== 'page' ||
    length.unit !== 'px' ||
    length.value > 1
  ) {
    return length
  }
  return {
    unit: 'px',
    value:
      axis === 'width'
        ? node.viewport.width
        : node.viewport.minHeight,
  }
}

export function Section({
  title,
  children,
  defaultOpen = true,
  action,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  action?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b px-2 py-1.5">
      <div className="flex h-6 items-center gap-1">
        <button
          type="button"
          className="flex h-6 flex-1 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
          {title}
        </button>
        {open ? action : null}
      </div>
      {open ? <div className="mt-1 space-y-1">{children}</div> : null}
    </section>
  )
}

export function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1">{children}</div>
}

/**
 * Compact pill with the label inside the control. Dragging the label scrubs the
 * value, which is how every canvas tool expects a number field to behave.
 */
export function NumberCell({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  onCommit,
}: {
  label: string
  /** null renders as "Mixed" across a multi-selection. */
  value: number | null
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const clamp = (next: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? -Number.POSITIVE_INFINITY, next))

  const scrub = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || value === null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const start = value
    let latest = start
    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * step * (moveEvent.shiftKey ? 10 : 1)
      latest = round(clamp(start + delta))
      if (inputRef.current) inputRef.current.value = String(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (latest !== start) onCommit(latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <label
      className={cn(
        control,
        'flex items-center gap-1 ps-2',
        disabled && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'shrink-0 select-none text-muted-foreground',
          !disabled && value !== null && 'cursor-ew-resize',
        )}
        onPointerDown={scrub}
      >
        {label}
      </span>
      <input
        ref={inputRef}
        key={value ?? MIXED}
        type="number"
        inputMode="decimal"
        aria-label={label}
        defaultValue={value === null ? '' : round(value)}
        placeholder={value === null ? MIXED : undefined}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="h-full w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
        onBlur={(event) => {
          const next = Number(event.currentTarget.value)
          if (event.currentTarget.value === '') return
          if (Number.isFinite(next) && next !== value) onCommit(clamp(next))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {suffix ? (
        <span className="shrink-0 pe-2 text-muted-foreground/70">{suffix}</span>
      ) : (
        <span className="pe-2" />
      )}
    </label>
  )
}

function TextCell({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string | null
  placeholder?: string
  onCommit: (value: string, input: HTMLInputElement) => void
}) {
  return (
    <label className={cn(control, 'flex items-center gap-1 ps-2')}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <input
        key={value ?? MIXED}
        aria-label={label}
        defaultValue={value ?? ''}
        placeholder={value === null ? MIXED : placeholder}
        className="h-full w-full min-w-0 bg-transparent pe-2 outline-none"
        onBlur={(event) => onCommit(event.currentTarget.value, event.currentTarget)}
        onInput={(event) => event.currentTarget.setCustomValidity('')}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

export function SelectCell({
  label,
  value,
  children,
  disabled = false,
  onChange,
}: {
  label: string
  value: string | null
  children: ReactNode
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label
      className={cn(control, 'flex items-center gap-1 ps-2', disabled && 'opacity-50')}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value ?? ''}
        disabled={disabled}
        className="h-full w-full min-w-0 bg-transparent pe-1 text-right outline-none"
        onChange={(event) => onChange(event.target.value)}
      >
        {value === null ? <option value="">{MIXED}</option> : null}
        {children}
      </select>
    </label>
  )
}

interface Choice<T extends string> {
  value: T
  label: string
  icon?: ElementType
}

/** Segmented control; the label sits inline so a row stays one line tall. */
function ChoiceCell<T extends string>({
  label,
  value,
  choices,
  disabled = false,
  onChange,
}: {
  label: string
  value: T | null
  choices: Choice<T>[]
  disabled?: boolean
  onChange: (value: T) => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="w-10 shrink-0 ps-1 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 rounded-md border bg-background p-0.5">
        {choices.map((choice) => {
          const Icon = choice.icon
          return (
            <button
              key={choice.value}
              type="button"
              aria-label={`${label}: ${choice.label}`}
              aria-pressed={value === choice.value}
              title={choice.label}
              className={cn(
                'grid h-5 flex-1 place-items-center rounded text-xs text-muted-foreground',
                value === choice.value
                  ? 'bg-secondary text-foreground'
                  : 'hover:text-foreground',
              )}
              onClick={() => onChange(choice.value)}
            >
              {Icon ? <Icon className="size-3" /> : choice.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ColorCell({
  label,
  value,
  onChange,
}: {
  label: string
  /** Hex string, or null for mixed / token-bound. */
  value: string | null
  onChange: (color: string) => void
}) {
  return (
    <label className={cn(control, 'flex items-center gap-1.5 ps-1.5')}>
      <input
        type="color"
        aria-label={label}
        value={value ?? '#000000'}
        className="size-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        key={value ?? MIXED}
        aria-label={`${label} hex`}
        defaultValue={value ?? ''}
        placeholder={value === null ? MIXED : undefined}
        className="h-full w-full min-w-0 bg-transparent pe-2 font-mono outline-none"
        onBlur={(event) => {
          const next = event.currentTarget.value.trim()
          if (/^#[\da-f]{3,8}$/i.test(next)) onChange(next)
          else event.currentTarget.value = value ?? ''
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

const LENGTH_UNITS = [
  { value: 'px', label: 'px' },
  { value: 'percent', label: '%' },
  { value: 'hug', label: 'Hug' },
  { value: 'fill', label: 'Fill' },
] as const

/** Width and height carry a unit; px-only fields quietly destroyed hug and fill. */
function LengthCell({
  label,
  value,
  onCommit,
}: {
  label: string
  value: CanvasLength | null
  onCommit: (length: CanvasLength) => void
}) {
  const numeric = value?.unit === 'px' || value?.unit === 'percent'
  return (
    <label className={cn(control, 'flex items-center gap-1 ps-2')}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {numeric ? (
        <input
          key={`${value.unit}:${value.value}`}
          type="number"
          inputMode="decimal"
          aria-label={label}
          defaultValue={round(value.value)}
          min={0}
          className="h-full w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
          onBlur={(event) => {
            const next = Number(event.currentTarget.value)
            if (Number.isFinite(next) && next !== value.value) {
              onCommit({ unit: value.unit, value: Math.max(0, next) })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      ) : (
        <span className="w-full text-right text-muted-foreground">
          {value === null ? MIXED : value.unit === 'hug' ? 'Hug' : 'Fill'}
        </span>
      )}
      <select
        aria-label={`${label} unit`}
        value={value?.unit ?? ''}
        className="h-full shrink-0 bg-transparent pe-1 text-right text-muted-foreground outline-none"
        onChange={(event) => {
          const unit = event.target.value as CanvasLength['unit']
          if (unit === 'hug' || unit === 'fill') onCommit({ unit })
          else {
            onCommit({
              unit,
              value: numeric ? value.value : unit === 'percent' ? 100 : 200,
            })
          }
        }}
      >
        {value === null ? <option value="">–</option> : null}
        {LENGTH_UNITS.map((unit) => (
          <option key={unit.value} value={unit.value}>
            {unit.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const EMPTY_INSETS: CanvasInsets = { top: 0, right: 0, bottom: 0, left: 0 }

function solidHex(paint: CanvasPaint | undefined) {
  return paint?.type === 'solid' && typeof paint.color === 'string'
    ? paint.color
    : null
}

type VectorPath = VectorNode['paths'][number]

/**
 * An imported icon paints through fill, through stroke, or through both, and
 * which one it uses is the icon set's choice, not the user's. The inspector
 * reads whichever channel the path actually paints so a solid set and an
 * outline set both answer one Color field.
 */
function vectorPaintColor(path: VectorPath) {
  const color = path.fill ?? path.stroke
  return typeof color === 'string' ? color : null
}

function recoloredPath(path: VectorPath, color: string): VectorPath {
  const next = { ...path }
  if (path.stroke !== undefined) next.stroke = color
  // A path that paints neither would be invisible; give it a fill rather than
  // silently ignoring the edit.
  if (path.fill !== undefined || path.stroke === undefined) next.fill = color
  return next
}

export function CanvasPropertiesPanel({ onClose }: { onClose?: () => void }) {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const transact = useCanvasTransaction()
  const readOnly = useCanvasReadOnly()
  const [breakpoint, setBreakpoint] = useState<string>('base')
  const [linkPadding, setLinkPadding] = useState(true)

  const refs = selection.filter((ref) => resolveNodeRef(document, ref))
  const nodes = refs
    .map((ref) => resolveNodeRef(document, ref))
    .filter((node): node is CanvasNode => !!node)
  const ref = refs[0] ?? null
  const node = nodes[0] ?? null
  const many = nodes.length > 1

  // A breakpoint that disappears (or a selection that cannot carry overrides)
  // must not leave edits writing into a target that no longer exists.
  useEffect(() => {
    if (breakpoint === 'base') return
    if (!document.breakpoints.some((item) => item.id === breakpoint)) {
      setBreakpoint('base')
    }
  }, [breakpoint, document.breakpoints])

  if (!ref || !node) {
    return (
      <PanelShell title="Design" className="bg-transparent" bodyScroll={false} onClose={onClose}>
        <PanelEmpty
          title="Nothing selected"
          description="Select a layer to edit its layout, style, and actions."
        />
      </PanelShell>
    )
  }

  /**
   * Applies a patch to every selected layer in one transaction. `build` runs per
   * node so a field can be derived from that node's own value, and `replace`
   * hands the engine a whole object — the only way to drop a key, since an
   * undefined in a patch is not serializable.
   */
  const commitEach = (
    build: (node: CanvasNode, ref: NodeRef) => NodeMutationPatch | null,
    label = many ? `Update ${nodes.length} layers` : `Update ${node.name}`,
    options: { replace?: (keyof NodeMutationPatch)[]; coalesceKey?: string } = {},
  ) => {
    const operations: CanvasOperation[] = []
    refs.forEach((target, index) => {
      const current = nodes[index]!
      const patch = build(current, target)
      if (!patch) return
      if (breakpoint !== 'base' && target.instancePath.length === 0) {
        const existing = current.responsive[breakpoint] ?? {}
        operations.push(
          operationFor(target, {
            responsive: {
              ...current.responsive,
              [breakpoint]: {
                ...existing,
                ...patch,
                layout: patch.layout
                  ? { ...existing.layout, ...patch.layout }
                  : existing.layout,
                style: patch.style
                  ? { ...existing.style, ...patch.style }
                  : existing.style,
              },
            },
          }),
        )
        return
      }
      operations.push(operationFor(target, patch, options.replace))
    })
    if (operations.length === 0) return
    transact({
      id: canvasId('tx'),
      label,
      // An explicit undefined key would not survive the transaction's
      // serializability check.
      ...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
      operations,
    })
  }

  const commit = (
    patch: NodeMutationPatch,
    label = many ? `Update ${nodes.length} layers` : `Update ${node.name}`,
  ) =>
    commitEach(() => patch, label, {
      coalesceKey: `property:${refs.map((item) => item.nodeId).join(',')}:${Object.keys(patch).join(',')}`,
    })

  const layout = <T,>(pick: (node: CanvasNode) => T) => shared(nodes.map(pick))

  /** Style edits rebuild the whole style, so removing a key actually removes it. */
  const patchStyle = (build: (style: CanvasStyle) => CanvasStyle) =>
    commitEach((current) => ({ style: build(current.style) }), undefined, {
      replace: ['style'],
    })

  /** Same for layout, where clearing a constraint means dropping the field. */
  const patchLayout = (build: (layout: CanvasLayout) => CanvasLayout) =>
    commitEach((current) => ({ layout: build(current.layout) }), undefined, {
      replace: ['layout'],
    })

  const mode = layout((item) => item.layout.mode)
  const direction = layout((item) => item.layout.direction ?? 'row')
  const padding = layout((item) => item.layout.padding ?? EMPTY_INSETS)
  const typography = layout((item) => item.style.typography ?? null)
  const fill = layout((item) => solidHex(item.style.fills[0]))
  const gradient =
    !many && node.style.fills[0]?.type === 'linear-gradient'
      ? node.style.fills[0]
      : null
  const stroke = layout((item) => item.style.stroke ?? null)
  const shadow = layout((item) => item.style.shadows[0] ?? null)
  const radius = layout((item) =>
    Array.isArray(item.style.radius) ? item.style.radius[0] : item.style.radius,
  )
  const perCorner = !many && Array.isArray(node.style.radius)
  const component =
    node.type === 'instance' ? document.nodes[node.componentId] : undefined
  const componentVariants =
    component?.type === 'component' ? component.variants : []
  const clickUrl = node.interactions
    .flatMap((interaction) => interaction.actions)
    .find((action) => action.type === 'open-url')
  const overriddenHere =
    breakpoint !== 'base' &&
    nodes.some((item) => item.responsive[breakpoint] !== undefined)

  const setTypography = (patch: Partial<CanvasTypography>) => {
    const operations = refs.map((target, index) => {
      const current = nodes[index]!.style.typography
      if (!current) return null
      return operationFor(target, {
        style: { typography: { ...current, ...patch } },
      })
    })
    const real = operations.filter((operation): operation is CanvasOperation => !!operation)
    if (real.length === 0) return
    transact({
      id: canvasId('tx'),
      label: 'Update type',
      coalesceKey: `type:${refs.map((item) => item.nodeId).join(',')}:${Object.keys(patch).join(',')}`,
      operations: real,
    })
  }

  /**
   * `paths` is not part of `NodePatch`, so it can travel neither in a
   * responsive override nor in an instance override. Vector edits therefore
   * target the source nodes directly and skip anything selected through an
   * instance.
   */
  const vectorTargets = refs
    .map((target, index) => ({ ref: target, node: nodes[index]! }))
    .filter(
      (entry): entry is { ref: NodeRef; node: VectorNode } =>
        entry.node.type === 'vector' && entry.ref.instancePath.length === 0,
    )
  const vectorPaths = vectorTargets.flatMap((entry) => entry.node.paths)
  const vectorColor = shared(vectorPaths.map(vectorPaintColor))
  const strokedPaths = vectorPaths.filter((path) => path.stroke !== undefined)
  const vectorStrokeWidth = shared(
    strokedPaths.map((path) => path.strokeWidth ?? 1),
  )

  const patchVectorPaths = (
    build: (path: VectorPath) => VectorPath,
    label: string,
    field: string,
  ) => {
    if (vectorTargets.length === 0) return
    transact({
      id: canvasId('tx'),
      label,
      coalesceKey: `vector:${field}:${vectorTargets
        .map((entry) => entry.ref.nodeId)
        .join(',')}`,
      operations: vectorTargets.map((entry) => ({
        type: 'node.patch',
        id: entry.ref.nodeId,
        patch: { paths: entry.node.paths.map(build) },
      })),
    })
  }

  const setPadding = (side: keyof CanvasInsets, value: number) => {
    const operations = refs.map((target, index) => {
      const current = nodes[index]!.layout.padding ?? EMPTY_INSETS
      const next = linkPadding
        ? { top: value, right: value, bottom: value, left: value }
        : { ...current, [side]: value }
      return operationFor(target, { layout: { padding: next } })
    })
    transact({
      id: canvasId('tx'),
      label: 'Update padding',
      coalesceKey: `padding:${refs.map((item) => item.nodeId).join(',')}`,
      operations,
    })
  }

  return (
    <PanelShell
      title="Design"
      className={cn('bg-transparent', readOnly && 'pointer-events-none opacity-70')}
      bodyScroll={false}
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          {many ? (
            <span className="flex-1 px-2 text-xs font-medium">
              {nodes.length} layers selected
            </span>
          ) : (
            <input
              key={node.name}
              aria-label="Layer name"
              defaultValue={node.name}
              className={cn(control, 'px-2 font-medium')}
              onBlur={(event) => {
                const name = event.currentTarget.value.trim()
                if (name && name !== node.name) commit({ name }, 'Rename node')
              }}
            />
          )}
          <span className="shrink-0 px-1 text-xs text-muted-foreground">
            {ref.instancePath.length > 0 ? 'override' : many ? 'multiple' : node.type}
          </span>
        </div>

        {!many && node.type === 'text' ? (
          // The field above renames the layer; this one is the copy itself.
          <div className="border-b px-2 py-1.5">
            <textarea
              key={node.text}
              aria-label="Text content"
              defaultValue={node.text}
              rows={2}
              className={cn(control, 'h-auto min-h-14 resize-y px-2 py-1 leading-snug')}
              onBlur={(event) => {
                const text = event.currentTarget.value
                if (text !== node.text) commit({ text, runs: [] }, 'Edit text')
              }}
            />
          </div>
        ) : null}

        {document.breakpoints.length > 0 ? (
          <Section
            title="Responsive"
            action={
              overriddenHere ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Clear breakpoint overrides"
                  title="Clear overrides at this breakpoint"
                  onClick={() => {
                    const operations = refs.map((target, index) => {
                      const rest = { ...nodes[index]!.responsive }
                      delete rest[breakpoint]
                      return operationFor(target, { responsive: rest })
                    })
                    transact({
                      id: canvasId('tx'),
                      label: 'Clear breakpoint overrides',
                      operations,
                    })
                  }}
                >
                  <Trash2Icon />
                </Button>
              ) : null
            }
          >
            <SelectCell label="Editing" value={breakpoint} onChange={setBreakpoint}>
              <option value="base">Base</option>
              {document.breakpoints.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectCell>
            {breakpoint !== 'base' ? (
              <p className="px-1 text-xs text-muted-foreground">
                Edits below apply only at {
                  document.breakpoints.find((item) => item.id === breakpoint)?.name ??
                    breakpoint
                }.
              </p>
            ) : null}
          </Section>
        ) : null}

        <Section title="Layout">
          <Pair>
            <NumberCell
              label="X"
              value={layout((item) => item.layout.x)}
              onCommit={(x) => commit({ layout: { x } })}
            />
            <NumberCell
              label="Y"
              value={layout((item) => item.layout.y)}
              onCommit={(y) => commit({ layout: { y } })}
            />
            <LengthCell
              label="W"
              value={layout((item) => inspectedLength(item, 'width'))}
              onCommit={(width) =>
                commitEach((current) => ({
                  layout: { width },
                  ...(breakpoint === 'base' &&
                  current.type === 'page' &&
                  width.unit === 'px'
                    ? { viewport: { width: width.value } }
                    : {}),
                }))
              }
            />
            <LengthCell
              label="H"
              value={layout((item) => inspectedLength(item, 'height'))}
              onCommit={(height) =>
                commitEach((current) => ({
                  layout: { height },
                  ...(breakpoint === 'base' &&
                  current.type === 'page' &&
                  height.unit === 'px'
                    ? { viewport: { minHeight: height.value } }
                    : {}),
                }))
              }
            />
          </Pair>
          <Pair>
            <SelectCell
              label="Pos"
              value={layout((item) => item.layout.position)}
              onChange={(value) =>
                commit({ layout: { position: value as 'absolute' | 'flow' } })
              }
            >
              <option value="absolute">Absolute</option>
              <option value="flow">Flow</option>
            </SelectCell>
            <NumberCell
              label="Rot"
              suffix="°"
              value={layout((item) => item.rotation)}
              onCommit={(rotation) => commit({ rotation })}
            />
          </Pair>
        </Section>

        <Section title="Stack">
          <ChoiceCell
            label="Mode"
            value={mode}
            choices={[
              { value: 'absolute', label: 'Free' },
              { value: 'flex', label: 'Flex' },
              { value: 'grid', label: 'Grid' },
            ]}
            onChange={(value) => {
              const next: NodeMutationPatch =
                value === 'flex'
                  ? {
                      layout: {
                        mode: 'flex',
                        direction: direction ?? 'row',
                        gap: layout((item) => item.layout.gap) ?? 0,
                      },
                    }
                  : value === 'grid'
                    ? {
                        layout: {
                          mode: 'grid',
                          columns: layout((item) => item.layout.columns) ?? 2,
                          gap: layout((item) => item.layout.gap) ?? 0,
                        },
                      }
                    : { layout: { mode: 'absolute' } }
              commit(next, 'Change stack')
            }}
          />

          {mode === 'flex' ? (
            <>
              <ChoiceCell
                label="Flow"
                value={direction}
                choices={[
                  { value: 'row', label: 'Row' },
                  { value: 'column', label: 'Column' },
                ]}
                onChange={(value) => commit({ layout: { direction: value } })}
              />
              <ChoiceCell
                label="Align"
                value={layout((item) => item.layout.align ?? 'stretch')}
                choices={
                  direction === 'column'
                    ? [
                        { value: 'start', label: 'Start', icon: AlignStartVerticalIcon },
                        { value: 'center', label: 'Center', icon: AlignCenterVerticalIcon },
                        { value: 'end', label: 'End', icon: AlignEndVerticalIcon },
                        { value: 'stretch', label: 'Stretch', icon: StretchHorizontalIcon },
                      ]
                    : [
                        { value: 'start', label: 'Start', icon: AlignStartHorizontalIcon },
                        { value: 'center', label: 'Center', icon: AlignCenterHorizontalIcon },
                        { value: 'end', label: 'End', icon: AlignEndHorizontalIcon },
                        { value: 'stretch', label: 'Stretch', icon: StretchHorizontalIcon },
                      ]
                }
                onChange={(value) => commit({ layout: { align: value } })}
              />
              <ChoiceCell
                label="Justify"
                value={layout((item) => item.layout.justify ?? 'start')}
                choices={[
                  { value: 'start', label: 'Start', icon: AlignStartVerticalIcon },
                  { value: 'center', label: 'Center', icon: AlignCenterVerticalIcon },
                  { value: 'end', label: 'End', icon: AlignEndVerticalIcon },
                  {
                    value: 'space-between',
                    label: 'Space between',
                    icon: AlignHorizontalSpaceBetweenIcon,
                  },
                  {
                    value: 'space-around',
                    label: 'Space around',
                    icon: AlignHorizontalSpaceAroundIcon,
                  },
                ]}
                onChange={(value) => commit({ layout: { justify: value } })}
              />
            </>
          ) : null}

          {mode === 'flex' || mode === 'grid' ? (
            <Pair>
              <NumberCell
                label="Gap"
                min={0}
                value={layout((item) => item.layout.gap ?? 0)}
                onCommit={(gap) => commit({ layout: { gap } })}
              />
              {mode === 'grid' ? (
                <NumberCell
                  label="Cols"
                  min={1}
                  max={24}
                  value={layout((item) => item.layout.columns ?? 1)}
                  onCommit={(columns) =>
                    commit({ layout: { columns: Math.round(columns) } })
                  }
                />
              ) : (
                <SelectCell
                  label="Wrap"
                  value={layout((item) => (item.layout.wrap ? 'wrap' : 'nowrap'))}
                  onChange={(value) =>
                    commit({ layout: { wrap: value === 'wrap' } })
                  }
                >
                  <option value="nowrap">No</option>
                  <option value="wrap">Yes</option>
                </SelectCell>
              )}
            </Pair>
          ) : null}

          <div className="flex items-center gap-1">
            <span className="w-10 shrink-0 ps-1 text-xs text-muted-foreground">
              Pad
            </span>
            <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <NumberCell
                  key={side}
                  label={side[0]!.toUpperCase()}
                  min={0}
                  value={padding ? padding[side] : null}
                  onCommit={(value) => setPadding(side, value)}
                />
              ))}
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={linkPadding ? 'Unlink padding sides' : 'Link padding sides'}
              title={linkPadding ? 'Padding sides linked' : 'Padding sides independent'}
              onClick={() => setLinkPadding((current) => !current)}
            >
              {linkPadding ? <Link2Icon /> : <Unlink2Icon />}
            </Button>
          </div>
        </Section>

        {vectorTargets.length > 0 ? (
          <Section title="Vector">
            <ColorCell
              label="Color"
              value={vectorColor}
              onChange={(color) =>
                patchVectorPaths(
                  (path) => recoloredPath(path, color),
                  vectorTargets.length > 1 ? 'Recolor vectors' : 'Recolor vector',
                  'color',
                )
              }
            />
            {strokedPaths.length > 0 ? (
              <NumberCell
                label="Weight"
                min={0}
                step={0.25}
                value={vectorStrokeWidth}
                onCommit={(strokeWidth) =>
                  patchVectorPaths(
                    (path) =>
                      path.stroke === undefined ? path : { ...path, strokeWidth },
                    'Vector weight',
                    'weight',
                  )
                }
              />
            ) : null}
          </Section>
        ) : null}

        <Section title="Appearance">
          {gradient ? (
            <>
              <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                Linear gradient
                <Button
                  size="xs"
                  variant="ghost"
                  className="ms-auto"
                  onClick={() =>
                    patchStyle((style) => ({
                      ...style,
                      fills: [
                        {
                          type: 'solid',
                          color:
                            typeof gradient.stops[0]?.color === 'string'
                              ? gradient.stops[0].color
                              : '#ffffff',
                        },
                      ],
                    }))
                  }
                >
                  Use solid
                </Button>
              </div>
              <NumberCell
                label="Angle"
                suffix="°"
                value={gradient.angle}
                onCommit={(angle) =>
                  patchStyle((style) => ({
                    ...style,
                    fills: style.fills.map((paint, index) =>
                      index === 0 && paint.type === 'linear-gradient'
                        ? { ...paint, angle }
                        : paint,
                    ),
                  }))
                }
              />
              {gradient.stops.slice(0, 4).map((stop, index) => (
                <ColorCell
                  key={index}
                  label={`Stop ${index + 1}`}
                  value={typeof stop.color === 'string' ? stop.color : null}
                  onChange={(color) =>
                    patchStyle((style) => ({
                      ...style,
                      fills: style.fills.map((paint, paintIndex) =>
                        paintIndex === 0 && paint.type === 'linear-gradient'
                          ? {
                              ...paint,
                              stops: paint.stops.map((current, stopIndex) =>
                                stopIndex === index ? { ...current, color } : current,
                              ),
                            }
                          : paint,
                      ),
                    }))
                  }
                />
              ))}
            </>
          ) : (
            <div className="flex items-center gap-1">
              <ColorCell
                label="Fill"
                value={fill}
                onChange={(color) =>
                  patchStyle((style) => ({
                    ...style,
                    fills: [{ type: 'solid', color }],
                  }))
                }
              />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={fill ? 'Remove fill' : 'Add fill'}
                title={fill ? 'Remove fill' : 'Add fill'}
                onClick={() =>
                  patchStyle((style) => ({
                    ...style,
                    fills: fill ? [] : [{ type: 'solid', color: '#ffffff' }],
                  }))
                }
              >
                {fill ? <Trash2Icon /> : <span className="text-xs">+</span>}
              </Button>
            </div>
          )}

          <Pair>
            <NumberCell
              label="Opacity"
              min={0}
              max={100}
              step={1}
              suffix="%"
              value={(() => {
                const value = layout((item) => item.style.opacity)
                return value === null ? null : Math.round(value * 100)
              })()}
              onCommit={(opacity) =>
                commit({ style: { opacity: Math.min(1, Math.max(0, opacity / 100)) } })
              }
            />
            <NumberCell
              label="Radius"
              min={0}
              value={perCorner ? null : radius}
              onCommit={(value) => commit({ style: { radius: value } })}
            />
          </Pair>
          {perCorner && Array.isArray(node.style.radius) ? (
            <div className="grid grid-cols-4 gap-1">
              {node.style.radius.map((corner, index) => (
                <NumberCell
                  key={index}
                  label={['TL', 'TR', 'BR', 'BL'][index]!}
                  min={0}
                  value={corner}
                  onCommit={(value) => {
                    const next = [...(node.style.radius as [number, number, number, number])]
                    next[index] = value
                    commit({
                      style: { radius: next as [number, number, number, number] },
                    })
                  }}
                />
              ))}
            </div>
          ) : null}

          <SelectCell
            label="Clip"
            value={layout((item) => item.style.overflow)}
            onChange={(value) =>
              commit({ style: { overflow: value as CanvasStyle['overflow'] } })
            }
          >
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
            <option value="auto">Scroll</option>
          </SelectCell>
        </Section>

        <Section title="Stroke" defaultOpen={false}>
          {stroke ? (
            <>
              <div className="flex items-center gap-1">
                <ColorCell
                  label="Stroke"
                  value={typeof stroke.color === 'string' ? stroke.color : null}
                  onChange={(color) =>
                    patchStyle((style) => ({
                      ...style,
                      stroke: { ...(style.stroke ?? { width: 1 }), color },
                    }))
                  }
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Remove stroke"
                  onClick={() =>
                    patchStyle(({ stroke: _removed, ...style }) => style)
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
              <Pair>
                <NumberCell
                  label="Width"
                  min={0}
                  value={stroke.width}
                  onCommit={(width) =>
                    patchStyle((style) => ({
                      ...style,
                      stroke: { ...(style.stroke ?? { color: '#000000' }), width },
                    }))
                  }
                />
                <SelectCell
                  label="Style"
                  value={stroke.style ?? 'solid'}
                  onChange={(value) =>
                    patchStyle((style) => ({
                      ...style,
                      stroke: {
                        ...(style.stroke ?? { color: '#000000', width: 1 }),
                        style: value as 'solid' | 'dashed' | 'dotted',
                      },
                    }))
                  }
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </SelectCell>
              </Pair>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              className="w-full"
              onClick={() =>
                patchStyle((style) => ({
                  ...style,
                  stroke: { color: '#000000', width: 1 },
                }))
              }
            >
              Add stroke
            </Button>
          )}
        </Section>

        <Section title="Shadow" defaultOpen={false}>
          {shadow ? (
            <>
              <div className="flex items-center gap-1">
                <ColorCell
                  label="Shadow"
                  value={typeof shadow.color === 'string' ? shadow.color : null}
                  onChange={(color) =>
                    patchStyle((style) => ({
                      ...style,
                      shadows: style.shadows.map((item, index) =>
                        index === 0 ? { ...item, color } : item,
                      ),
                    }))
                  }
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Remove shadow"
                  onClick={() =>
                    patchStyle((style) => ({
                      ...style,
                      shadows: style.shadows.slice(1),
                    }))
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
              <Pair>
                {(['x', 'y', 'blur', 'spread'] as const).map((field) => (
                  <NumberCell
                    key={field}
                    label={field === 'blur' ? 'Blur' : field === 'spread' ? 'Spread' : field.toUpperCase()}
                    value={shadow[field]}
                    onCommit={(value) =>
                      patchStyle((style) => ({
                        ...style,
                        shadows: style.shadows.map((item, index) =>
                          index === 0 ? { ...item, [field]: value } : item,
                        ),
                      }))
                    }
                  />
                ))}
              </Pair>
              <SelectCell
                label="Kind"
                value={shadow.inset ? 'inset' : 'drop'}
                onChange={(value) =>
                  patchStyle((style) => ({
                    ...style,
                    shadows: style.shadows.map((item, index) =>
                      index === 0 ? { ...item, inset: value === 'inset' } : item,
                    ),
                  }))
                }
              >
                <option value="drop">Drop</option>
                <option value="inset">Inset</option>
              </SelectCell>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              className="w-full"
              onClick={() =>
                patchStyle((style) => ({
                  ...style,
                  shadows: [
                    ...style.shadows,
                    { x: 0, y: 8, blur: 24, spread: -8, color: '#00000040' },
                  ],
                }))
              }
            >
              Add shadow
            </Button>
          )}
        </Section>

        {typography ? (
          <Section title="Type">
            <TextCell
              label="Font"
              value={typography.family}
              onCommit={(value) => setTypography({ family: value || 'Archivo' })}
            />
            <Pair>
              <NumberCell
                label="Size"
                min={1}
                value={typography.size}
                onCommit={(size) => setTypography({ size })}
              />
              <NumberCell
                label="Weight"
                min={100}
                max={900}
                step={100}
                value={typography.weight}
                onCommit={(weight) => setTypography({ weight })}
              />
              <NumberCell
                label="Line"
                min={0}
                step={0.1}
                value={typography.lineHeight}
                onCommit={(lineHeight) => setTypography({ lineHeight })}
              />
              <NumberCell
                label="Track"
                step={0.1}
                value={typography.letterSpacing}
                onCommit={(letterSpacing) => setTypography({ letterSpacing })}
              />
            </Pair>
            <ChoiceCell
              label="Align"
              value={typography.align}
              choices={[
                { value: 'left', label: 'Left', icon: AlignLeftIcon },
                { value: 'center', label: 'Center', icon: AlignCenterIcon },
                { value: 'right', label: 'Right', icon: AlignRightIcon },
                { value: 'justify', label: 'Justify', icon: AlignJustifyIcon },
              ]}
              onChange={(align) => setTypography({ align })}
            />
            <Pair>
              <SelectCell
                label="Case"
                value={typography.transform ?? 'none'}
                onChange={(value) =>
                  setTypography({ transform: value as CanvasTypography['transform'] })
                }
              >
                <option value="none">None</option>
                <option value="uppercase">Upper</option>
                <option value="lowercase">Lower</option>
                <option value="capitalize">Title</option>
              </SelectCell>
              <SelectCell
                label="Line"
                value={typography.decoration ?? 'none'}
                onChange={(value) =>
                  setTypography({ decoration: value as CanvasTypography['decoration'] })
                }
              >
                <option value="none">None</option>
                <option value="underline">Underline</option>
                <option value="line-through">Strike</option>
              </SelectCell>
            </Pair>
          </Section>
        ) : null}

        <MotionSection nodes={nodes} refs={refs} readOnly={readOnly} />

        <Section title="Constraints" defaultOpen={false}>
          <Pair>
            <NumberCell
              label="Min W"
              min={0}
              value={layout((item) => item.layout.minWidth ?? 0)}
              onCommit={(value) =>
                patchLayout(({ minWidth: _removed, ...rest }) =>
                  value ? { ...rest, minWidth: value } : rest,
                )
              }
            />
            <NumberCell
              label="Max W"
              min={0}
              value={layout((item) => item.layout.maxWidth ?? 0)}
              onCommit={(value) =>
                patchLayout(({ maxWidth: _removed, ...rest }) =>
                  value ? { ...rest, maxWidth: value } : rest,
                )
              }
            />
            <NumberCell
              label="Min H"
              min={0}
              value={layout((item) => item.layout.minHeight ?? 0)}
              onCommit={(value) =>
                patchLayout(({ minHeight: _removed, ...rest }) =>
                  value ? { ...rest, minHeight: value } : rest,
                )
              }
            />
            <NumberCell
              label="Max H"
              min={0}
              value={layout((item) => item.layout.maxHeight ?? 0)}
              onCommit={(value) =>
                patchLayout(({ maxHeight: _removed, ...rest }) =>
                  value ? { ...rest, maxHeight: value } : rest,
                )
              }
            />
          </Pair>
          <NumberCell
            label="Aspect"
            min={0}
            step={0.1}
            value={layout((item) => item.layout.aspectRatio ?? 0)}
            onCommit={(value) =>
              patchLayout(({ aspectRatio: _removed, ...rest }) =>
                value ? { ...rest, aspectRatio: value } : rest,
              )
            }
          />
        </Section>

        {!many && node.type === 'instance' ? (
          <Section
            title="Component"
            action={
              Object.keys(node.overrides).length > 0 ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Reset instance overrides"
                  title="Reset overrides"
                  onClick={() =>
                    transact({
                      id: canvasId('tx'),
                      label: 'Reset instance overrides',
                      operations: Object.keys(node.overrides).map((targetId) => ({
                        type: 'instance.patchOverride',
                        id: node.id,
                        targetId,
                        patch: null,
                      })),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              ) : null
            }
          >
            <SelectCell
              label="Variant"
              value={
                node.variant ??
                (component?.type === 'component' ? component.defaultVariant ?? '' : '')
              }
              onChange={(variant) => commit({ variant })}
            >
              {componentVariants.map((variant) => (
                <option key={variant} value={variant}>
                  {variant}
                </option>
              ))}
            </SelectCell>
          </Section>
        ) : null}

        {!many ? (
          <Section title="Actions" defaultOpen={false}>
            <TextCell
              label="Link"
              value={clickUrl?.type === 'open-url' ? clickUrl.url : ''}
              placeholder="https://…"
              onCommit={(value, input) => {
                const url = value.trim()
                if (!url) {
                  commit({ interactions: [] }, 'Remove action')
                  return
                }
                try {
                  new URL(url)
                  commit(
                    {
                      interactions: [
                        {
                          trigger: 'click',
                          actions: [{ type: 'open-url', url, target: '_blank' }],
                        },
                      ],
                    },
                    'Set click action',
                  )
                } catch {
                  input.setCustomValidity('Enter a valid URL')
                  input.reportValidity()
                }
              }}
            />
          </Section>
        ) : null}
      </div>
    </PanelShell>
  )
}
