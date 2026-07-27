import { useState, type ReactNode } from 'react'
import {
  canvasId,
  type CanvasLength,
  type NodeMutationPatch,
  type NodePatch,
  type NodeRef,
  resolveNodeRef,
} from '@loora/canvas/model'
import {
  useCanvasDocument,
  useCanvasReadOnly,
  useCanvasSelection,
  useCanvasTransaction,
} from '@loora/canvas/react'
import type { CanvasOperation } from '@loora/canvas/engine'
import { ChevronDownIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

function operationFor(
  ref: NodeRef,
  patch: NodeMutationPatch,
): CanvasOperation {
  const instanceId = ref.instancePath.at(-1)
  return instanceId
    ? {
        type: 'instance.patchOverride',
        id: instanceId,
        targetId: ref.nodeId,
        patch: patch as NodePatch,
      }
    : { type: 'node.patch', id: ref.nodeId, patch }
}

const control =
  'h-7 w-full min-w-0 rounded-md border bg-background text-[11px] outline-none focus-visible:border-ring'

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b px-2 py-1.5">
      <button
        type="button"
        className="flex h-6 w-full items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        {title}
      </button>
      {open ? <div className="mt-1 space-y-1">{children}</div> : null}
    </section>
  )
}

/** Compact pill with the label inside the control, not in a left column. */
function NumberCell({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onCommit: (value: number) => void
}) {
  return (
    <label className={cn(control, 'flex items-center gap-1 ps-2')}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <input
        key={value}
        type="number"
        aria-label={label}
        defaultValue={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        className="h-full w-full min-w-0 bg-transparent pe-2 text-right tabular-nums outline-none"
        onBlur={(event) => {
          const next = Number(event.currentTarget.value)
          if (Number.isFinite(next) && next !== value) onCommit(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
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
  value: string
  placeholder?: string
  onCommit: (value: string, input: HTMLInputElement) => void
}) {
  return (
    <label className={cn(control, 'flex items-center gap-1 ps-2')}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <input
        key={value}
        aria-label={label}
        defaultValue={value}
        placeholder={placeholder}
        className="h-full w-full min-w-0 bg-transparent pe-2 outline-none"
        onBlur={(event) =>
          onCommit(event.currentTarget.value, event.currentTarget)
        }
        onInput={(event) => event.currentTarget.setCustomValidity('')}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

function SelectCell({
  label,
  value,
  children,
  onChange,
}: {
  label: string
  value: string
  children: ReactNode
  onChange: (value: string) => void
}) {
  return (
    <label className={cn(control, 'flex items-center gap-1 ps-2')}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        className="h-full w-full min-w-0 bg-transparent pe-1 text-right outline-none"
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  )
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1">{children}</div>
}

function pixelValue(length: CanvasLength) {
  return length.unit === 'px' ? length.value : 0
}

export function CanvasV2PropertiesPanel({
  onClose,
}: {
  onClose?: () => void
}) {
  const document = useCanvasDocument()
  const selection = useCanvasSelection()
  const transact = useCanvasTransaction()
  const readOnly = useCanvasReadOnly()
  const [breakpoint, setBreakpoint] = useState<string>('base')
  const ref = selection[0] ?? null
  const node = ref ? resolveNodeRef(document, ref) : null

  const header = (
    <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2">
      <h2 className="ps-1 text-[11px] font-medium text-muted-foreground">
        Design
      </h2>
      {onClose ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close design panel"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      ) : null}
    </header>
  )

  if (!ref || !node) {
    return (
      <aside className="flex h-full min-h-0 w-full flex-col bg-background">
        {header}
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <p className="text-[11px] text-muted-foreground">
            Select a layer to edit layout, style and actions.
          </p>
        </div>
      </aside>
    )
  }

  const commit = (patch: NodeMutationPatch, label = `Update ${node.name}`) => {
    let effectivePatch = patch
    if (breakpoint !== 'base' && ref.instancePath.length === 0) {
      const existing = node.responsive[breakpoint] ?? {}
      effectivePatch = {
        responsive: {
          ...node.responsive,
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
      }
    }
    transact({
      id: canvasId('tx'),
      label,
      coalesceKey: `property:${ref.nodeId}:${Object.keys(patch).join(',')}`,
      operations: [operationFor(ref, effectivePatch)],
    })
  }

  const solidFill = node.style.fills.find((fill) => fill.type === 'solid')
  const fillColor =
    solidFill?.type === 'solid' && typeof solidFill.color === 'string'
      ? solidFill.color
      : '#ffffff'
  const clickUrl = node.interactions
    .flatMap((interaction) => interaction.actions)
    .find((action) => action.type === 'open-url')
  const component =
    node.type === 'instance' ? document.nodes[node.componentId] : undefined
  const componentVariants =
    component?.type === 'component' ? component.variants : []
  const typography = node.style.typography

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full flex-col bg-background',
        readOnly && 'pointer-events-none opacity-70',
      )}
      aria-label="Properties"
      aria-disabled={readOnly}
    >
      {header}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
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
          <span className="shrink-0 px-1 text-[10px] text-muted-foreground">
            {ref.instancePath.length > 0 ? 'override' : node.type}
          </span>
        </div>

        {node.type === 'text' ? (
          // The field above renames the layer; this one is the copy itself.
          <div className="border-b px-2 py-1.5">
            <textarea
              key={node.text}
              aria-label="Text content"
              defaultValue={node.text}
              rows={2}
              className={cn(
                control,
                'h-auto min-h-14 resize-y px-2 py-1 leading-snug',
              )}
              onBlur={(event) => {
                const text = event.currentTarget.value
                if (text !== node.text) commit({ text, runs: [] }, 'Edit text')
              }}
            />
          </div>
        ) : null}

        {document.breakpoints.length > 0 ? (
          <Section title="Responsive">
            <SelectCell
              label="Editing"
              value={breakpoint}
              onChange={setBreakpoint}
            >
              <option value="base">Base</option>
              {document.breakpoints.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectCell>
          </Section>
        ) : null}

        <Section title="Layout">
          <Pair>
            <NumberCell
              label="X"
              value={node.layout.x}
              onCommit={(x) => commit({ layout: { x } })}
            />
            <NumberCell
              label="Y"
              value={node.layout.y}
              onCommit={(y) => commit({ layout: { y } })}
            />
            <NumberCell
              label="W"
              min={1}
              value={pixelValue(node.layout.width)}
              onCommit={(value) =>
                commit({ layout: { width: { unit: 'px', value } } })
              }
            />
            <NumberCell
              label="H"
              min={1}
              value={pixelValue(node.layout.height)}
              onCommit={(value) =>
                commit({ layout: { height: { unit: 'px', value } } })
              }
            />
          </Pair>
          <Pair>
            <SelectCell
              label="Pos"
              value={node.layout.position}
              onChange={(value) =>
                commit({
                  layout: { position: value as 'absolute' | 'flow' },
                })
              }
            >
              <option value="absolute">Absolute</option>
              <option value="flow">Flow</option>
            </SelectCell>
            <NumberCell
              label="Rot"
              value={node.rotation}
              onCommit={(rotation) => commit({ rotation })}
            />
          </Pair>
          <Pair>
            <SelectCell
              label="Stack"
              value={node.layout.mode}
              onChange={(value) =>
                commit({
                  layout: { mode: value as 'absolute' | 'flex' | 'grid' },
                })
              }
            >
              <option value="absolute">Free</option>
              <option value="flex">Flex</option>
              <option value="grid">Grid</option>
            </SelectCell>
            {node.layout.mode === 'flex' ? (
              <SelectCell
                label="Dir"
                value={node.layout.direction ?? 'row'}
                onChange={(value) =>
                  commit({
                    layout: { direction: value as 'row' | 'column' },
                  })
                }
              >
                <option value="row">Row</option>
                <option value="column">Column</option>
              </SelectCell>
            ) : node.layout.mode === 'grid' ? (
              <NumberCell
                label="Cols"
                min={1}
                max={24}
                value={node.layout.columns ?? 1}
                onCommit={(columns) =>
                  commit({ layout: { columns: Math.round(columns) } })
                }
              />
            ) : (
              <span />
            )}
          </Pair>
          {node.layout.mode === 'flex' ? (
            <Pair>
              <NumberCell
                label="Gap"
                min={0}
                value={node.layout.gap ?? 0}
                onCommit={(gap) => commit({ layout: { gap } })}
              />
              <span />
            </Pair>
          ) : null}
        </Section>

        <Section title="Appearance">
          <label className={cn(control, 'flex items-center gap-1 ps-1.5')}>
            <input
              type="color"
              aria-label="Fill"
              value={fillColor}
              className="size-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
              onChange={(event) =>
                commit({
                  style: { fills: [{ type: 'solid', color: event.target.value }] },
                })
              }
            />
            <input
              key={fillColor}
              aria-label="Fill hex"
              defaultValue={fillColor}
              className="h-full w-full min-w-0 bg-transparent pe-2 font-mono outline-none"
              onBlur={(event) => {
                if (/^#[\da-f]{3,8}$/i.test(event.currentTarget.value)) {
                  commit({
                    style: {
                      fills: [
                        { type: 'solid', color: event.currentTarget.value },
                      ],
                    },
                  })
                }
              }}
            />
          </label>
          <Pair>
            <NumberCell
              label="Opacity"
              min={0}
              max={1}
              step={0.05}
              value={node.style.opacity}
              onCommit={(opacity) => commit({ style: { opacity } })}
            />
            <NumberCell
              label="Radius"
              min={0}
              value={
                Array.isArray(node.style.radius)
                  ? node.style.radius[0]
                  : node.style.radius
              }
              onCommit={(radius) => commit({ style: { radius } })}
            />
          </Pair>
        </Section>

        {node.type === 'text' && typography ? (
          <Section title="Type">
            <TextCell
              label="Font"
              value={typography.family}
              onCommit={(value) =>
                commit({
                  style: {
                    typography: { ...typography, family: value || 'Archivo' },
                  },
                })
              }
            />
            <Pair>
              <NumberCell
                label="Size"
                min={1}
                value={typography.size}
                onCommit={(size) =>
                  commit({ style: { typography: { ...typography, size } } })
                }
              />
              <NumberCell
                label="Weight"
                min={100}
                max={900}
                step={100}
                value={typography.weight}
                onCommit={(weight) =>
                  commit({ style: { typography: { ...typography, weight } } })
                }
              />
              <NumberCell
                label="Line"
                min={0}
                step={0.1}
                value={typography.lineHeight}
                onCommit={(lineHeight) =>
                  commit({
                    style: { typography: { ...typography, lineHeight } },
                  })
                }
              />
              <NumberCell
                label="Track"
                step={0.1}
                value={typography.letterSpacing}
                onCommit={(letterSpacing) =>
                  commit({
                    style: { typography: { ...typography, letterSpacing } },
                  })
                }
              />
            </Pair>
            <SelectCell
              label="Align"
              value={typography.align}
              onChange={(value) =>
                commit({
                  style: {
                    typography: {
                      ...typography,
                      align: value as typeof typography.align,
                    },
                  },
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </SelectCell>
          </Section>
        ) : null}

        {node.type === 'instance' ? (
          <Section title="Component">
            <SelectCell
              label="Variant"
              value={
                node.variant ??
                (component?.type === 'component'
                  ? component.defaultVariant ?? ''
                  : '')
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
      </div>
    </aside>
  )
}
