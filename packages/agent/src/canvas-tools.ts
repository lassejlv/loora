import { z } from 'zod'
import type { CanvasOperation, CanvasTransaction } from '@loora/canvas/engine'
import {
  DEFAULT_ORDER_STEP,
  buildChildIndex,
  canvasId,
  createComponentNode,
  createFrameNode,
  createInstanceNode,
  createPageNode,
  createTextNode,
  createVectorNode,
  defaultLayout,
  defaultStyle,
  orderedChildren,
  resolveNodeRef,
  type CanvasDocument,
  type CanvasInteraction,
  type CanvasLayout,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasStyle,
  type CanvasTheme,
  type DesignToken,
  type NodeId,
  type NodeMutationPatch,
  type NodePatch,
  type NodeRef,
  type ResponsiveOverrides,
  type SemanticTag,
  type TextRun,
  type CanvasVisualState,
} from '@loora/canvas/model'
import {
  motionPreset,
  MOTION_PRESET_NAMES,
  type CanvasAnimation,
} from '@loora/canvas/motion'
import {
  hoverPreset,
  HOVER_PRESET_NAMES,
  type HoverPresetName,
} from '@loora/canvas/motion-presets'

const lengthSchema = z.union([
  z.object({ unit: z.literal('px'), value: z.number().finite() }),
  z.object({ unit: z.literal('percent'), value: z.number().finite() }),
  z.object({ unit: z.literal('fill') }),
  z.object({ unit: z.literal('hug') }),
]).describe(
  'Dimension object: {"unit":"px","value":number}, {"unit":"percent","value":number}, {"unit":"fill"} (take remaining space in a flex container), or {"unit":"hug"} (fit content). Always an object, never a bare number.',
)

/**
 * Some MCP clients serialize structured arguments as JSON text rather than
 * nested objects/arrays. Accept both forms: a string that holds a JSON object
 * or array is decoded and validated exactly like its native form; anything
 * else falls through to the schema's own error.
 */
function jsonText<T extends z.ZodType>(schema: T): T {
  return z.union([
    schema,
    z
      .string()
      .refine(
        (text) => {
          const trimmed = text.trim()
          if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
          try {
            JSON.parse(trimmed)
            return true
          } catch {
            return false
          }
        },
        { message: 'Expected a JSON object or array' },
      )
      .transform((text): unknown => JSON.parse(text))
      .pipe(schema as unknown as z.ZodType<unknown>),
  ]) as unknown as T
}

const safeCssColor = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch)\([0-9a-z.%+,\s/-]+\))$/i

const colorSchema = z.union([
  z.string().min(1).max(200).regex(safeCssColor, 'Use a safe CSS color value'),
  z.object({ token: z.string().min(1).max(128) }),
])

const paintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color: colorSchema }),
  z.object({
    type: z.literal('linear-gradient'),
    angle: z.number().finite(),
    stops: z
      .array(z.object({ offset: z.number().min(0).max(1), color: colorSchema }))
      .min(2)
      .max(20),
  }),
])

const typographySchema = z.object({
  family: z.string().min(1).max(200),
  size: z.number().positive().max(1_000),
  weight: z.number().min(1).max(1_000),
  lineHeight: z.number().positive().max(20),
  letterSpacing: z.number().finite().min(-100).max(1_000).default(0),
  align: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  wrap: z.boolean().optional(),
  decoration: z.enum(['none', 'underline', 'line-through']).optional(),
  transform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
}).describe(
  'Complete typography for a text node. Required when set: family, size (px), weight (100-900), lineHeight (multiplier). letterSpacing (px, default 0) and align (default left) are optional.',
)

export const canvasLayoutPatchSchema = z.object({
  position: z.enum(['flow', 'absolute']).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: lengthSchema.optional(),
  height: lengthSchema.optional(),
  minWidth: z.number().finite().nonnegative().optional(),
  maxWidth: z.number().finite().positive().optional(),
  minHeight: z.number().finite().nonnegative().optional(),
  maxHeight: z.number().finite().positive().optional(),
  aspectRatio: z.number().finite().positive().optional(),
  mode: z.enum(['absolute', 'flex', 'grid']).optional(),
  direction: z.enum(['row', 'column']).optional(),
  wrap: z.boolean().optional(),
  gap: z.number().finite().nonnegative().optional(),
  padding: z
    .object({
      top: z.number().finite(),
      right: z.number().finite(),
      bottom: z.number().finite(),
      left: z.number().finite(),
    })
    .optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  justify: z
    .enum(['start', 'center', 'end', 'space-between', 'space-around'])
    .optional(),
  columns: z.number().int().min(1).max(100).optional(),
  alignSelf: z
    .enum(['start', 'center', 'end', 'stretch'])
    .optional()
    .describe(
      'Cross-axis alignment for this child alone, overriding the parent\'s align.',
    ),
  grow: z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .describe(
      'Share of free main-axis space this child takes against its siblings. Defaults to 1 for a fill width/height, 0 otherwise.',
    ),
  shrink: z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .describe(
      'How much this child gives back main-axis space when the line overflows. Defaults to 1 for a fill width/height, 0 otherwise.',
    ),
})

export const canvasStylePatchSchema = z.object({
  fills: z.array(paintSchema).max(20).optional(),
  stroke: z
    .object({
      color: colorSchema,
      width: z.number().finite().nonnegative(),
      style: z.enum(['solid', 'dashed', 'dotted']).optional(),
    })
    .optional(),
  radius: z
    .union([
      z.number().finite().nonnegative(),
      z.tuple([
        z.number().finite().nonnegative(),
        z.number().finite().nonnegative(),
        z.number().finite().nonnegative(),
        z.number().finite().nonnegative(),
      ]),
    ])
    .optional(),
  shadows: z
    .array(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        blur: z.number().finite().nonnegative(),
        spread: z.number().finite(),
        color: colorSchema,
        inset: z.boolean().optional(),
      }),
    )
    .max(20)
    .optional(),
  opacity: z.number().min(0).max(1).optional(),
  overflow: z.enum(['visible', 'hidden', 'auto']).optional(),
  blendMode: z
    .enum([
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ])
    .optional(),
  typography: typographySchema.optional(),
})

const stateIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,128}$/)

const stateValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
])

const stateDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    id: stateIdSchema,
    name: z.string().trim().min(1).max(200),
    type: z.literal('string'),
    initial: z.string().max(10_000),
  }),
  z.object({
    id: stateIdSchema,
    name: z.string().trim().min(1).max(200),
    type: z.literal('number'),
    initial: z.number().finite(),
  }),
  z.object({
    id: stateIdSchema,
    name: z.string().trim().min(1).max(200),
    type: z.literal('boolean'),
    initial: z.boolean(),
  }),
])

const stateDefinitionsSchema = z
  .record(stateIdSchema, stateDefinitionSchema)
  .superRefine((states, context) => {
    for (const [id, state] of Object.entries(states)) {
      if (state.id !== id) {
        context.addIssue({
          code: 'custom',
          path: [id, 'id'],
          message: 'State ids must match their record keys',
        })
      }
    }
  })

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), pageId: z.string().min(1).max(128) }),
  z.object({
    type: z.literal('open-url'),
    url: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => {
        try {
          const url = new URL(value)
          return (
            url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              (url.hostname === 'localhost' ||
                url.hostname === '127.0.0.1'))
          )
        } catch {
          return false
        }
      }, 'Use a safe HTTPS URL'),
    target: z.enum(['_self', '_blank']).optional(),
  }),
  z.object({
    type: z.literal('visibility'),
    nodeId: z.string().min(1).max(128),
    value: z.enum(['show', 'hide', 'toggle']),
  }),
  z.object({ type: z.literal('open-overlay'), pageId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('close-overlay') }),
  z.object({
    type: z.literal('set-variant'),
    instanceId: z.string().min(1).max(128),
    variant: z.string().min(1).max(128),
  }),
  z.object({
    type: z.literal('set-state'),
    stateId: stateIdSchema,
    value: stateValueSchema,
  }),
  z.object({
    type: z.literal('toggle-state'),
    stateId: stateIdSchema,
  }),
  z.object({
    type: z.literal('increment-state'),
    stateId: stateIdSchema,
    amount: z.number().finite(),
  }),
  z.object({
    type: z.literal('set-theme'),
    themeId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  }),
])

const interactionSchema = z
  .object({
    trigger: z.enum([
      'click',
      'double-click',
      'hover',
      'hover-end',
      'submit',
      'change',
      'input',
      'focus',
      'blur',
      'state-change',
    ]),
    stateId: stateIdSchema.optional(),
    when: z
      .array(
        z.object({
          stateId: stateIdSchema,
          operator: z.enum(['equals', 'not-equals']),
          value: stateValueSchema,
        }),
      )
      .max(20)
      .optional(),
    actions: z.array(actionSchema).min(1).max(20),
  })
  .superRefine((interaction, context) => {
    if (interaction.trigger === 'state-change' && !interaction.stateId) {
      context.addIssue({
        code: 'custom',
        path: ['stateId'],
        message: 'state-change interactions require a stateId',
      })
    }
    if (interaction.trigger !== 'state-change' && interaction.stateId) {
      context.addIssue({
        code: 'custom',
        path: ['stateId'],
        message: 'stateId is only valid for state-change interactions',
      })
    }
  })

const imageUrlSchema = z
  .string()
  .max(4_096)
  .refine(
    (value) =>
      value.startsWith('/api/asset/') ||
      /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value) ||
      (() => {
        try {
          const url = new URL(value)
          return (
            url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              (url.hostname === 'localhost' ||
                url.hostname === '127.0.0.1'))
          )
        } catch {
          return false
        }
      })(),
    'Use a safe image URL',
  )

const nodePatchFields = {
  name: z.string().trim().min(1).max(200).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  rotation: z.number().finite().optional(),
  layout: canvasLayoutPatchSchema.optional(),
  style: canvasStylePatchSchema.optional(),
  semanticTag: z
    .enum([
      'div',
      'section',
      'header',
      'nav',
      'main',
      'footer',
      'article',
      'aside',
      'button',
      'a',
      'form',
    ])
    .optional(),
  text: z.string().max(200_000).optional(),
  runs: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        typography: typographySchema.partial().optional(),
        color: colorSchema.optional(),
      }),
    )
    .max(10_000)
    .optional(),
  src: imageUrlSchema.optional(),
  alt: z.string().max(1_000).optional(),
  interactions: z.array(interactionSchema).max(50).optional(),
  variant: z.string().max(128).optional(),
}

/**
 * One shared instance for every "record of node patches" spot. Reusing the
 * instance (instead of calling z.object(nodePatchFields) at each site) lets
 * the JSON Schema conversion hoist it into a single definition.
 */
const nodePatchObjectSchema = z.object(nodePatchFields)

/* -------------------------------------------------------------------------- */
/* Motion                                                                     */
/* -------------------------------------------------------------------------- */

export const easingSchema = z.union([
  z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']),
  z.object({
    cubicBezier: z.tuple([
      z.number().min(0).max(1),
      z.number().min(-10).max(10),
      z.number().min(0).max(1),
      z.number().min(-10).max(10),
    ]),
  }),
])

export const transitionSchema = z.object({
  duration: z.number().finite().min(0).max(60_000),
  delay: z.number().finite().min(0).max(60_000).optional(),
  easing: easingSchema.default('ease-out'),
  properties: z
    .array(z.enum(['all', 'opacity', 'transform', 'colors', 'size', 'shadow', 'border']))
    .min(1)
    .max(7)
    .optional(),
})

export const motionTransformSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000).optional(),
    y: z.number().finite().min(-100_000).max(100_000).optional(),
    scale: z.number().finite().min(0).max(100).optional(),
    scaleX: z.number().finite().min(0).max(100).optional(),
    scaleY: z.number().finite().min(0).max(100).optional(),
    rotate: z.number().finite().min(-3_600).max(3_600).optional(),
    skewX: z.number().finite().min(-3_600).max(3_600).optional(),
    skewY: z.number().finite().min(-3_600).max(3_600).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'A transform has to move something',
  })

export const keyframeSchema = z
  .object({
    offset: z.number().min(0).max(1),
    opacity: z.number().min(0).max(1).optional(),
    transform: motionTransformSchema.optional(),
  })
  .refine((frame) => frame.opacity !== undefined || frame.transform !== undefined, {
    message: 'A keyframe has to set an opacity or a transform',
  })

export const animationSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  name: z.string().trim().min(1).max(200),
  keyframes: z.array(keyframeSchema).min(2).max(40),
  duration: z.number().finite().min(1).max(60_000),
  delay: z.number().finite().min(0).max(60_000).optional(),
  easing: easingSchema.default('ease-out'),
  iterations: z.union([z.number().int().min(1).max(1_000), z.literal('infinite')]).default(1),
  direction: z
    .enum(['normal', 'reverse', 'alternate', 'alternate-reverse'])
    .default('normal'),
  fill: z.enum(['none', 'forwards', 'backwards', 'both']).default('both'),
})

export const visualStateSchema = z
  .object({
    style: canvasStylePatchSchema.optional(),
    transform: motionTransformSchema.optional(),
  })
  .refine((state) => state.style !== undefined || state.transform !== undefined, {
    message: 'A visual state has to change a style or a transform',
  })

export const nodeAnimationSchema = z.object({
  animationId: z.string().min(1).max(128),
  trigger: z.enum(['load', 'in-view', 'always', 'hover', 'press']).default('load'),
  delay: z.number().finite().min(0).max(60_000).optional(),
  once: z.boolean().optional(),
})

export const canvasNodePatchSchema = z.object({
  ...nodePatchFields,
  order: z.number().finite().optional(),
  states: stateDefinitionsSchema.optional(),
  viewport: z
    .object({
      width: z.number().finite().positive().optional(),
      minHeight: z.number().finite().positive().optional(),
    })
    .optional(),
  variants: z.array(z.string().min(1).max(128)).max(100).optional(),
  defaultVariant: z.string().max(128).optional(),
  variantOverrides: z
    .record(
      z.string().min(1).max(128),
      z.record(z.string().min(1).max(128), nodePatchObjectSchema),
    )
    .optional(),
  shape: z.enum(['rectangle', 'ellipse', 'line']).optional(),
  viewBox: z.string().max(1_000).optional(),
  paths: z
    .array(
      z.object({
        d: z.string().max(100_000),
        fill: colorSchema.optional(),
        stroke: colorSchema.optional(),
        strokeWidth: z.number().finite().nonnegative().optional(),
      }),
    )
    .max(1_000)
    .optional(),
  fit: z.enum(['cover', 'contain', 'fill']).optional(),
  componentId: z.string().min(1).max(128).optional(),
  visualStates: z
    .object({
      hover: visualStateSchema.optional(),
      press: visualStateSchema.optional(),
      focus: visualStateSchema.optional(),
    })
    .optional(),
  transition: transitionSchema.optional(),
  animations: z.array(nodeAnimationSchema).max(8).optional(),
  responsive: z.record(z.string(), nodePatchObjectSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const nodeRefSchema = jsonText(z.object({
  nodeId: z.string().min(1).max(128),
  instancePath: z.array(z.string().min(1).max(128)).max(32).default([]),
}))

export interface CanvasNodeDescriptor {
  ref?: string
  type: Exclude<CanvasNodeType, 'page' | 'component'>
  name?: string
  layout?: Partial<CanvasLayout>
  style?: Partial<CanvasStyle>
  hidden?: boolean
  locked?: boolean
  rotation?: number
  responsive?: ResponsiveOverrides
  interactions?: CanvasInteraction[]
  semanticTag?: SemanticTag
  text?: string
  runs?: TextRun[]
  shape?: 'rectangle' | 'ellipse' | 'line'
  viewBox?: string
  paths?: Array<{
    d: string
    fill?: string | { token: string }
    stroke?: string | { token: string }
    strokeWidth?: number
  }>
  src?: string
  alt?: string
  fit?: 'cover' | 'contain' | 'fill'
  componentId?: string
  variant?: string
  children?: CanvasNodeDescriptor[]
}

export const canvasNodeDescriptorSchema: z.ZodType<CanvasNodeDescriptor> = z.lazy(() =>
  z.object({
    ref: z.string().min(1).max(128).optional(),
    type: z.enum(['frame', 'group', 'text', 'shape', 'vector', 'image', 'instance']),
    name: z.string().trim().min(1).max(200).optional(),
    layout: canvasLayoutPatchSchema.optional(),
    style: canvasStylePatchSchema.optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    rotation: z.number().finite().optional(),
    responsive: z.record(z.string(), nodePatchObjectSchema).optional(),
    interactions: z.array(interactionSchema).max(50).optional(),
    semanticTag: nodePatchFields.semanticTag,
    text: z.string().max(200_000).optional(),
    runs: nodePatchFields.runs,
    shape: z.enum(['rectangle', 'ellipse', 'line']).optional(),
    viewBox: z.string().max(1_000).optional(),
    paths: canvasNodePatchSchema.shape.paths,
    src: imageUrlSchema.optional(),
    alt: z.string().max(1_000).optional(),
    fit: z.enum(['cover', 'contain', 'fill']).optional(),
    componentId: z.string().min(1).max(128).optional(),
    variant: z.string().max(128).optional(),
    children: z.array(canvasNodeDescriptorSchema).max(1_000).optional(),
  }).superRefine((descriptor, context) => {
    if (descriptor.type === 'image' && !descriptor.src) {
      context.addIssue({
        code: 'custom',
        path: ['src'],
        message: 'Image nodes require a source URL',
      })
    }
    if (descriptor.type === 'instance' && !descriptor.componentId) {
      context.addIssue({
        code: 'custom',
        path: ['componentId'],
        message: 'Instance nodes require a component id or temporary ref',
      })
    }
    if (
      descriptor.children?.length &&
      descriptor.type !== 'frame' &&
      descriptor.type !== 'group'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['children'],
        message: `${descriptor.type} nodes cannot contain children`,
      })
    }
  }),
)

/**
 * Readable JSON Schema ids for the shared shapes. Tool schemas repeat these
 * heavily (styles inside visual states inside patches inside descriptors);
 * naming them lets the MCP tools/list conversion hoist each into a single
 * definition instead of inlining it dozens of times per tool — the raw
 * manifest was ~156KB of almost entirely duplicated style/layout shapes.
 * Registration only affects JSON Schema output, never parsing.
 */
for (const [id, schema] of Object.entries({
  CanvasLength: lengthSchema,
  CanvasColor: colorSchema,
  CanvasPaint: paintSchema,
  CanvasTypography: typographySchema,
  CanvasLayoutPatch: canvasLayoutPatchSchema,
  CanvasStylePatch: canvasStylePatchSchema,
  CanvasStateValue: stateValueSchema,
  CanvasStateDefinitions: stateDefinitionsSchema,
  CanvasAction: actionSchema,
  CanvasInteraction: interactionSchema,
  CanvasImageUrl: imageUrlSchema,
  CanvasNodePatchFields: nodePatchObjectSchema,
  CanvasEasing: easingSchema,
  CanvasTransition: transitionSchema,
  CanvasMotionTransform: motionTransformSchema,
  CanvasKeyframe: keyframeSchema,
  CanvasAnimation: animationSchema,
  CanvasVisualState: visualStateSchema,
  CanvasNodeAnimation: nodeAnimationSchema,
  CanvasNodePatch: canvasNodePatchSchema,
  CanvasNodeRef: nodeRefSchema,
  CanvasNodeDescriptor: canvasNodeDescriptorSchema,
})) {
  z.globalRegistry.add(schema, { id })
}

export const createPageInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
  width: z.number().finite().positive().max(100_000).default(1440),
  minHeight: z.number().finite().positive().max(100_000).default(900),
  layout: jsonText(canvasLayoutPatchSchema).optional(),
  style: jsonText(canvasStylePatchSchema).optional(),
  states: jsonText(stateDefinitionsSchema).default({}),
  children: jsonText(z.array(canvasNodeDescriptorSchema).max(5_000)).default([]),
})

export const insertNodesInputSchema = z.object({
  parent: nodeRefSchema,
  nodes: jsonText(z.array(canvasNodeDescriptorSchema).min(1).max(5_000)),
})

export const patchNodesInputSchema = z.object({
  changes: jsonText(
    z.array(z.object({ ref: nodeRefSchema, patch: canvasNodePatchSchema }))
      .min(1)
      .max(1_000),
  ),
})

export const moveNodesInputSchema = z.object({
  changes: jsonText(
    z.array(
      z.object({
        nodeId: z.string().min(1).max(128),
        parentId: z.string().min(1).max(128).nullable(),
        order: z.number().finite().optional(),
      }),
    )
      .min(1)
      .max(1_000),
  ),
})

export const deleteNodesInputSchema = z.object({
  nodeIds: jsonText(z.array(z.string().min(1).max(128)).min(1).max(1_000)),
})

export const createComponentInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  width: z.number().finite().positive().max(100_000).default(320),
  height: z.number().finite().positive().max(100_000).default(200),
  variants: jsonText(
    z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(100)
      .refine(
        (variants) => new Set(variants).size === variants.length,
        'Variant names must be unique',
      ),
  ).default(['default']),
  layout: jsonText(canvasLayoutPatchSchema).optional(),
  style: jsonText(canvasStylePatchSchema).optional(),
  states: jsonText(stateDefinitionsSchema).default({}),
  children: jsonText(z.array(canvasNodeDescriptorSchema).max(5_000)).default([]),
})

export const createInstanceInputSchema = z.object({
  parent: nodeRefSchema,
  componentId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(200).optional(),
  variant: z.string().max(128).optional(),
  layout: jsonText(canvasLayoutPatchSchema).optional(),
  style: jsonText(canvasStylePatchSchema).optional(),
})

const tokenFields = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  name: z.string().trim().min(1).max(200),
}

const tokenColorSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(safeCssColor, 'Use a safe CSS color value')
const tokenFontSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^{};<>\u0000-\u001f\u007f\\]+$/, 'Use a safe font family')

const tokenSchema = z.discriminatedUnion('type', [
  z.object({
    ...tokenFields,
    type: z.literal('color'),
    value: tokenColorSchema,
    modes: z.record(z.string(), tokenColorSchema).optional(),
  }),
  z.object({
    ...tokenFields,
    type: z.literal('number'),
    value: z.number().finite(),
    modes: z.record(z.string(), z.number().finite()).optional(),
  }),
  z.object({
    ...tokenFields,
    type: z.literal('font'),
    value: tokenFontSchema,
    modes: z.record(z.string(), tokenFontSchema).optional(),
  }),
])

export const setTokensInputSchema = z
  .object({
    themes: jsonText(
      z.array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
          name: z.string().trim().min(1).max(200),
        }),
      ).max(100),
    ).default([]),
    tokens: jsonText(z.array(tokenSchema).max(1_000)).default([]),
    // The persisted default theme the design renders with — on Main or on a
    // branch — so a themed variant (e.g. dark mode) does not need a runtime
    // event to look right on load. Merges field-level across branches.
    activeThemeId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional()
      .describe('Persisted default theme id the design renders with, e.g. "dark". The theme must exist (define it in themes first, the same call is fine). Read current themes and activeThemeId from getDesignContext.'),
  })
  .refine(
    (input) =>
      input.themes.length > 0 ||
      input.tokens.length > 0 ||
      input.activeThemeId !== undefined,
    { message: 'Nothing to do: pass themes, tokens, or activeThemeId' },
  )


export const setAnimationsInputSchema = z
  .object({
    presets: jsonText(z.array(z.enum(MOTION_PRESET_NAMES as [string, ...string[]])).max(20)).default([]),
    animations: jsonText(z.array(animationSchema).max(50)).default([]),
    remove: jsonText(z.array(z.string().min(1).max(128)).max(50)).default([]),
  })
  .refine(
    (input) =>
      input.presets.length > 0 || input.animations.length > 0 || input.remove.length > 0,
    { message: 'Nothing to do: pass presets, animations, or ids to remove' },
  )

export const animateNodesInputSchema = z
  .object({
    refs: jsonText(z.array(nodeRefSchema).min(1).max(200)),
    play: jsonText(z.array(nodeAnimationSchema).max(8)).optional(),
    hover: jsonText(
      z.union([
        z.enum(HOVER_PRESET_NAMES as [string, ...string[]]),
        visualStateSchema,
      ]),
    ).optional(),
    press: jsonText(visualStateSchema).optional(),
    focus: jsonText(visualStateSchema).optional(),
    transition: jsonText(transitionSchema).optional(),
    /** Per-node step in milliseconds, so a list can arrive one item at a time. */
    stagger: z.number().finite().min(0).max(5_000).optional(),
    clear: z.boolean().default(false),
  })
  .refine(
    (input) =>
      input.clear ||
      input.play !== undefined ||
      input.hover !== undefined ||
      input.press !== undefined ||
      input.focus !== undefined ||
      input.transition !== undefined,
    { message: 'Nothing to do: pass motion to apply, or clear: true' },
  )

export const readNodeInputSchema = z.object({ ref: nodeRefSchema })
export const readTreeInputSchema = z.object({
  root: nodeRefSchema.optional(),
  depth: z.number().int().min(1).max(20).default(6),
})
export const searchNodesInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  types: jsonText(
    z.array(z.enum(['page', 'component', 'frame', 'group', 'text', 'shape', 'vector', 'image', 'instance']))
      .max(9),
  ).optional(),
})
export const viewNodeInputSchema = z.object({
  ref: nodeRefSchema,
  focus: z.string().max(500).optional(),
})
export const viewPageInputSchema = z.object({
  pageId: z.string().min(1).max(128),
  width: z.number().finite().positive().max(10_000).optional(),
  focus: z.string().max(500).optional(),
})
export const viewCanvasInputSchema = z.object({
  focus: z.string().max(500).optional(),
})

export type InsertNodesInput = z.infer<typeof insertNodesInputSchema>
export type PatchNodesInput = z.infer<typeof patchNodesInputSchema>

interface Allocation {
  descriptor: CanvasNodeDescriptor
  id: NodeId
  parentId: NodeId
  order: number
  layout: CanvasLayout
}

/** Types with nothing to measure; hugging them would collapse the node to nothing. */
const SIZED_TYPES = new Set<CanvasNodeType>(['image', 'shape', 'vector'])

/**
 * Placement for a descriptor that did not ask for one. Nested content flows
 * inside its parent — the old absolute default stacked every child on the
 * parent's origin, so a whole generated page piled up in one corner. Absolute
 * is still the default for descriptors that carry coordinates or say so.
 */
function descriptorLayout(
  descriptor: CanvasNodeDescriptor,
  parent: CanvasLayout,
): CanvasLayout {
  const requested = descriptor.layout ?? {}
  const positioned =
    requested.position === 'absolute' ||
    (requested.position === undefined &&
      (requested.x !== undefined || requested.y !== undefined))
  if (positioned) return { ...defaultLayout(), ...requested, position: 'absolute' }

  // A row lays children out side by side, so they size to their content; a
  // column, grid, or block parent gives every child the full inline axis.
  const alongRow = parent.mode === 'flex' && (parent.direction ?? 'row') === 'row'
  const flow: Partial<CanvasLayout> = SIZED_TYPES.has(descriptor.type)
    ? {}
    : {
        width: alongRow || descriptor.type === 'text' ? { unit: 'hug' } : { unit: 'fill' },
        height: { unit: 'hug' },
      }
  return { ...defaultLayout(), position: 'flow', ...flow, ...requested }
}

function baseNode(
  descriptor: CanvasNodeDescriptor,
  id: NodeId,
  parentId: NodeId,
  order: number,
  layout: CanvasLayout,
) {
  return {
    id,
    parentId,
    order,
    name: descriptor.name ?? descriptor.type[0]!.toUpperCase() + descriptor.type.slice(1),
    hidden: descriptor.hidden ?? false,
    locked: descriptor.locked ?? false,
    rotation: descriptor.rotation ?? 0,
    layout,
    style: { ...defaultStyle(), ...descriptor.style },
    responsive: descriptor.responsive ?? {},
    interactions: descriptor.interactions ?? [],
  }
}

function descriptorNode(
  descriptor: CanvasNodeDescriptor,
  id: NodeId,
  parentId: NodeId,
  order: number,
  layout: CanvasLayout,
  refs: ReadonlyMap<string, NodeId>,
): CanvasNode {
  const base = baseNode(descriptor, id, parentId, order, layout)
  if (descriptor.type === 'text') {
    const text = descriptor.text ?? descriptor.name ?? 'Text'
    const textBase = createTextNode(text)
    return {
      ...createTextNode(text, {
        ...base,
        style: {
          ...textBase.style,
          ...descriptor.style,
          typography: descriptor.style?.typography
            ? {
                ...textBase.style.typography!,
                ...descriptor.style.typography,
              }
            : textBase.style.typography,
        },
      }),
      text,
      runs: descriptor.runs ?? [],
    }
  }
  if (descriptor.type === 'frame') {
    return {
      ...createFrameNode(descriptor.name ?? 'Frame', base),
      semanticTag: descriptor.semanticTag ?? 'div',
    }
  }
  if (descriptor.type === 'group') return { ...base, type: 'group' }
  if (descriptor.type === 'shape') {
    return {
      ...base,
      type: 'shape',
      shape: descriptor.shape ?? 'rectangle',
    }
  }
  if (descriptor.type === 'vector') {
    return {
      ...createVectorNode(descriptor.name ?? 'Vector', {
        ...base,
        viewBox: descriptor.viewBox ?? '0 0 100 100',
        paths: descriptor.paths ?? [],
      }),
    }
  }
  if (descriptor.type === 'image') {
    return {
      ...base,
      type: 'image',
      src: descriptor.src ?? '',
      alt: descriptor.alt ?? '',
      fit: descriptor.fit ?? 'cover',
    }
  }
  const componentId = descriptor.componentId
    ? refs.get(descriptor.componentId) ?? descriptor.componentId
    : ''
  return createInstanceNode(
    componentId,
    descriptor.name ?? 'Instance',
    {
      ...base,
      ...(descriptor.variant ? { variant: descriptor.variant } : {}),
      overrides: {},
    },
  )
}

export function materializeNodeDescriptors(
  document: CanvasDocument,
  parentId: NodeId,
  descriptors: CanvasNodeDescriptor[],
) {
  const parent = document.nodes[parentId]
  if (!parent || !['page', 'component', 'frame', 'group'].includes(parent.type)) {
    throw new Error(`Parent "${parentId}" is not an editable container`)
  }
  const refs = new Map<string, NodeId>()
  const allocations: Allocation[] = []
  const allocate = (
    items: CanvasNodeDescriptor[],
    targetParentId: NodeId,
    parentLayout: CanvasLayout,
  ) => {
    for (const descriptor of items) {
      const id = canvasId(descriptor.type)
      if (descriptor.ref) {
        if (refs.has(descriptor.ref)) throw new Error(`Duplicate temporary ref "${descriptor.ref}"`)
        refs.set(descriptor.ref, id)
      }
      const layout = descriptorLayout(descriptor, parentLayout)
      allocations.push({
        descriptor,
        id,
        parentId: targetParentId,
        order: 0,
        layout,
      })
      allocate(descriptor.children ?? [], id, layout)
    }
  }
  allocate(descriptors, parentId, parent.layout)

  const nextOrder = new Map<NodeId, number>()
  for (const allocation of allocations) {
    const current =
      nextOrder.get(allocation.parentId) ??
      ((orderedChildren(document, allocation.parentId).at(-1)?.order ?? 0) +
        DEFAULT_ORDER_STEP)
    nextOrder.set(allocation.parentId, current + DEFAULT_ORDER_STEP)
    allocation.order = current
  }
  const nodes = allocations.map((allocation) =>
    descriptorNode(
      allocation.descriptor,
      allocation.id,
      allocation.parentId,
      allocation.order,
      allocation.layout,
      refs,
    ),
  )
  return {
    nodes,
    refs: Object.fromEntries(refs),
  }
}

export function insertDescriptorOperations(
  document: CanvasDocument,
  parentId: NodeId,
  descriptors: CanvasNodeDescriptor[],
): {
  operations: CanvasOperation[]
  refs: Record<string, NodeId>
  nodeIds: NodeId[]
} {
  const materialized = materializeNodeDescriptors(document, parentId, descriptors)
  return {
    operations: materialized.nodes.map((node) => ({ type: 'node.insert', node })),
    refs: materialized.refs,
    nodeIds: materialized.nodes.map((node) => node.id),
  }
}

function isDescendantOrSelf(
  document: CanvasDocument,
  nodeId: NodeId,
  rootId: NodeId,
) {
  let current: NodeId | null = nodeId
  while (current) {
    if (current === rootId) return true
    current = document.nodes[current]?.parentId ?? null
  }
  return false
}

export function readCanvasNodeRef(
  document: CanvasDocument,
  ref: NodeRef,
  width = 1_440,
) {
  const source = document.nodes[ref.nodeId]
  if (!source) throw new Error(`Node "${ref.nodeId}" does not exist`)

  let previousComponentId: NodeId | null = null
  for (const instanceId of ref.instancePath) {
    const instance = document.nodes[instanceId]
    if (!instance || instance.type !== 'instance') {
      throw new Error(`Instance path "${instanceId}" is invalid`)
    }
    if (
      previousComponentId &&
      !isDescendantOrSelf(document, instance.id, previousComponentId)
    ) {
      throw new Error(`Instance path "${instanceId}" is not nested correctly`)
    }
    previousComponentId = instance.componentId
  }
  if (
    previousComponentId &&
    !isDescendantOrSelf(document, source.id, previousComponentId)
  ) {
    throw new Error(
      `Node "${source.id}" is not inside the addressed component instance`,
    )
  }

  const effective = resolveNodeRef(document, ref, width)
  if (!effective) throw new Error(`NodeRef for "${ref.nodeId}" is invalid`)
  const instanceId = ref.instancePath.at(-1)
  const instance = instanceId ? document.nodes[instanceId] : null
  return {
    ref,
    source,
    effective,
    instanceId: instance?.type === 'instance' ? instance.id : null,
    override:
      instance?.type === 'instance'
        ? instance.overrides[source.id] ?? null
        : null,
  }
}

export function sourceContainerForRef(
  document: CanvasDocument,
  ref: NodeRef,
) {
  if (ref.instancePath.length > 0) {
    throw new Error(
      'Structural insertion inside an instance is not supported. Edit the component definition or patch an existing instance descendant.',
    )
  }
  const { source } = readCanvasNodeRef(document, ref)
  if (!['page', 'component', 'frame', 'group'].includes(source.type)) {
    throw new Error(`Node "${source.id}" is not an editable container`)
  }
  if (source.locked) throw new Error(`Node "${source.name}" is locked`)
  return source
}

const instancePatchKeys = new Set<keyof NodePatch>([
  'name',
  'hidden',
  'locked',
  'rotation',
  'layout',
  'style',
  'semanticTag',
  'text',
  'runs',
  'src',
  'alt',
  'interactions',
  'variant',
])

export function patchOperationForRef(ref: NodeRef, patch: NodeMutationPatch): CanvasOperation {
  const instanceId = ref.instancePath.at(-1)
  return instanceId
    ? {
        type: 'instance.patchOverride',
        id: instanceId,
        targetId: ref.nodeId,
        patch: patch as NodePatch,
      }
    : {
        type: 'node.patch',
        id: ref.nodeId,
        patch,
      }
}

export function patchOperationsForChanges(
  document: CanvasDocument,
  changes: PatchNodesInput['changes'],
) {
  return changes.map((change) => {
    const addressed = readCanvasNodeRef(document, change.ref)
    if (addressed.effective.locked) {
      throw new Error(`Node "${addressed.effective.name}" is locked`)
    }
    if (
      change.ref.instancePath.length > 0 &&
      Object.keys(change.patch).some(
        (key) => !instancePatchKeys.has(key as keyof NodePatch),
      )
    ) {
      throw new Error(
        'Instance overrides can patch visual/content fields only. Move or edit the component source for structural fields.',
      )
    }
    return patchOperationForRef(change.ref, change.patch)
  })
}

export function normalizeDeletionNodeIds(
  document: CanvasDocument,
  nodeIds: NodeId[],
) {
  const requested = new Set(nodeIds)
  return [...requested].filter(
    (nodeId) => !hasRequestedAncestor(document, nodeId, requested),
  )
}

function hasRequestedAncestor(
  document: CanvasDocument,
  nodeId: NodeId,
  requested: ReadonlySet<NodeId>,
) {
  let parentId = document.nodes[nodeId]?.parentId ?? null
  while (parentId) {
    if (requested.has(parentId)) return true
    parentId = document.nodes[parentId]?.parentId ?? null
  }
  return false
}

export function createPageTransaction(
  document: CanvasDocument,
  input: z.infer<typeof createPageInputSchema>,
): { transaction: CanvasTransaction; pageId: NodeId; refs: Record<string, NodeId> } {
  const pages = orderedChildren(document, null).filter((node) => node.type === 'page')
  const page = createPageNode(input.name, {
    order: (pages.at(-1)?.order ?? 0) + DEFAULT_ORDER_STEP,
    layout: {
      ...defaultLayout(input.width, input.minHeight, {
        x: input.x,
        y: input.y,
      }),
      ...input.layout,
    },
    style: { ...defaultStyle({ fills: [{ type: 'solid', color: '#ffffff' }] }), ...input.style },
    states: input.states,
    viewport: { width: input.width, minHeight: input.minHeight },
  })
  const withPage: CanvasDocument = {
    ...document,
    nodes: { ...document.nodes, [page.id]: page },
  }
  const children = insertDescriptorOperations(withPage, page.id, input.children)
  return {
    pageId: page.id,
    refs: children.refs,
    transaction: {
      id: canvasId('tx'),
      label: `Create page ${page.name}`,
      operations: [{ type: 'node.insert', node: page }, ...children.operations],
    },
  }
}

export function createComponentTransaction(
  document: CanvasDocument,
  input: z.infer<typeof createComponentInputSchema>,
): {
  transaction: CanvasTransaction
  componentId: NodeId
  refs: Record<string, NodeId>
} {
  const roots = orderedChildren(document, null)
  const component: CanvasNode = createComponentNode(input.name, {
    order: (roots.at(-1)?.order ?? 0) + DEFAULT_ORDER_STEP,
    layout: { ...defaultLayout(input.width, input.height), ...input.layout },
    style: { ...defaultStyle(), ...input.style },
    states: input.states,
    variants: input.variants,
    defaultVariant: input.variants[0],
  })
  const withComponent: CanvasDocument = {
    ...document,
    nodes: { ...document.nodes, [component.id]: component },
  }
  const children = insertDescriptorOperations(
    withComponent,
    component.id,
    input.children,
  )
  return {
    componentId: component.id,
    refs: children.refs,
    transaction: {
      id: canvasId('tx'),
      label: `Create component ${component.name}`,
      operations: [{ type: 'node.insert', node: component }, ...children.operations],
    },
  }
}

export function semanticTree(
  document: CanvasDocument,
  root: NodeId | NodeRef | null = null,
  depth = 6,
) {
  const childIndex = buildChildIndex(document)
  const visitNode = (
    source: CanvasNode,
    ref: NodeRef,
    level: number,
  ): unknown => {
    const node = readCanvasNodeRef(document, ref).effective
    const childParentId =
      node.type === 'instance' ? node.componentId : source.id
    const childPath =
      node.type === 'instance'
        ? [...ref.instancePath, source.id]
        : ref.instancePath
    const children =
      level >= depth
        ? []
        : orderedChildren(document, childParentId, childIndex).map((child) =>
            visitNode(
              child,
              { nodeId: child.id, instancePath: childPath },
              level + 1,
            ),
          )
    return {
      id: source.id,
      ref,
      type: node.type,
      name: node.name,
      hidden: node.hidden || undefined,
      locked: node.locked || undefined,
      layout: {
        mode: node.layout.mode,
        position: node.layout.position,
        width: node.layout.width,
        height: node.layout.height,
      },
      ...(node.type === 'text' ? { text: node.text } : {}),
      ...(node.interactions.length > 0
        ? { interactions: node.interactions }
        : {}),
      ...(node.type === 'page' || node.type === 'component'
        ? { states: node.states ?? {} }
        : {}),
      ...(node.type === 'instance'
        ? { componentId: node.componentId, variant: node.variant }
        : {}),
      children,
    }
  }
  if (root) {
    const ref =
      typeof root === 'string'
        ? { nodeId: root, instancePath: [] }
        : root
    const source = document.nodes[ref.nodeId]
    if (!source) return null
    return visitNode(source, ref, 1)
  }
  return orderedChildren(document, null, childIndex).map((node) =>
    visitNode(node, { nodeId: node.id, instancePath: [] }, 1),
  )
}

export function searchCanvasNodes(
  document: CanvasDocument,
  query: string,
  types?: CanvasNodeType[],
) {
  const needle = query.toLocaleLowerCase()
  const allowed = types ? new Set(types) : null
  return Object.values(document.nodes)
    .filter((node) => {
      if (allowed && !allowed.has(node.type)) return false
      const text = node.type === 'text' ? node.text : ''
      return `${node.name}\n${text}`.toLocaleLowerCase().includes(needle)
    })
    .slice(0, 200)
    .map((node) => ({
      id: node.id,
      ref: { nodeId: node.id, instancePath: [] },
      type: node.type,
      name: node.name,
      text: node.type === 'text' ? node.text : undefined,
      parentId: node.parentId,
    }))
}

export function tokenOperations(
  tokens: DesignToken[],
  themes: CanvasTheme[] = [],
  activeThemeId?: string,
): CanvasOperation[] {
  return [
    ...themes.map((theme) => ({ type: 'theme.upsert' as const, theme })),
    ...tokens.map((token) => ({ type: 'token.upsert' as const, token })),
    // Activation comes last, so a theme defined in this same call exists by
    // the time it becomes the default.
    ...(activeThemeId
      ? [{ type: 'theme.activate' as const, id: activeThemeId }]
      : []),
  ]
}


/**
 * Document animations, from presets or explicit definitions. Presets keep the
 * common ask to one word; a full definition is there when the motion is the
 * point rather than the decoration.
 */
export function animationOperations(input: {
  presets?: string[]
  animations?: CanvasAnimation[]
  remove?: string[]
}): CanvasOperation[] {
  const defined = new Map<string, CanvasAnimation>()
  for (const preset of input.presets ?? []) {
    const animation = motionPreset(preset as Parameters<typeof motionPreset>[0])
    defined.set(animation.id, animation)
  }
  // An explicit definition wins over a preset of the same id, because it is the
  // more specific thing the caller asked for.
  for (const animation of input.animations ?? []) defined.set(animation.id, animation)
  return [
    ...(input.remove ?? []).map((id) => ({ type: 'animation.delete' as const, id })),
    ...[...defined.values()].map((animation) => ({
      type: 'animation.upsert' as const,
      animation,
    })),
  ]
}

export type AnimateNodesInput = z.infer<typeof animateNodesInputSchema>

/**
 * Motion onto nodes. A named hover brings its own transition, so "make these
 * cards lift" is one call; an explicit transition still wins if the caller
 * passed one. A stagger walks the refs in the order they were given, which is
 * what turns a list into an entrance rather than a flash.
 */
export function animateNodesOperations(input: AnimateNodesInput): CanvasOperation[] {
  const preset =
    typeof input.hover === 'string'
      ? hoverPreset(input.hover as HoverPresetName)
      : null
  const hover = preset ? preset.state : (input.hover as CanvasVisualState | undefined)
  const visualStates = {
    ...(hover ? { hover } : {}),
    ...(input.press ? { press: input.press as CanvasVisualState } : {}),
    ...(input.focus ? { focus: input.focus as CanvasVisualState } : {}),
  }
  const transition = input.transition ?? preset?.transition

  return input.refs.map((ref, index) => {
    if (input.clear) {
      return {
        type: 'node.patch' as const,
        id: ref.nodeId,
        patch: {},
        unset: ['visualStates', 'transition', 'animations'],
      }
    }
    const play = input.play?.map((use) => ({
      ...use,
      ...(input.stagger
        ? { delay: (use.delay ?? 0) + index * input.stagger }
        : {}),
    }))
    return {
      type: 'node.patch' as const,
      id: ref.nodeId,
      patch: {
        ...(Object.keys(visualStates).length > 0 ? { visualStates } : {}),
        ...(transition ? { transition } : {}),
        ...(play ? { animations: play } : {}),
      },
    }
  })
}

export function createCanvasAgentTools({
  imageInputsEnabled,
}: {
  imageInputsEnabled: boolean
}) {
  const imageToolOutput =
    (emptyMessage: string) =>
    ({ output }: { output: { image?: string; error?: string } }) => {
      if (!imageInputsEnabled || !output?.image) {
        return {
          type: 'text' as const,
          value: output?.error ?? emptyMessage,
        }
      }
      const data = output.image.split(',')[1]
      return {
        type: 'content' as const,
        value: [
          {
            type: 'file' as const,
            data: { type: 'data' as const, data },
            mediaType: 'image/png',
          },
        ],
      }
    }

  return {
    createPage: {
      description:
        'Create an editable responsive Page root with optional typed local states and nested structured nodes. Use interactions to handle events, state-change rules, and named visual theme switches; use flex/grid for normal UI flow and absolute positioning only when intentional.',
      inputSchema: createPageInputSchema,
    },
    insertNodes: {
      description:
        'Insert one or more nested structured nodes into a Page, frame, group, or component. Temporary refs are returned as permanent ids. Never send HTML, JSX, CSS, classes, or source code.',
      inputSchema: insertNodesInputSchema,
    },
    patchNodes: {
      description:
        'Patch structured layout, style, text, visibility, responsive properties, variants, typed Page/component states, or declarative event interactions. Events can switch any named visual theme. State values and selected runtime themes are ephemeral; definitions and rules stay transactional. NodeRefs can address descendants inside component instances.',
      inputSchema: patchNodesInputSchema,
    },
    moveNodes: {
      description:
        'Move or reorder source nodes atomically. parentId is a source container id; omit order to append.',
      inputSchema: moveNodesInputSchema,
    },
    deleteNodes: {
      description:
        'Delete source nodes and their descendants. This requires user confirmation in the Loora client.',
      inputSchema: deleteNodesInputSchema,
    },
    readNode: {
      description: 'Read one complete structured node or instance override.',
      inputSchema: readNodeInputSchema,
    },
    readTree: {
      description: 'Read a compact semantic subtree without generated code.',
      inputSchema: readTreeInputSchema,
    },
    searchNodes: {
      description: 'Search node names and text content.',
      inputSchema: searchNodesInputSchema,
    },
    createComponent: {
      description:
        'Create an off-canvas reusable component definition with variants, instance-local state, and scoped named-theme interactions.',
      inputSchema: createComponentInputSchema,
    },
    createInstance: {
      description: 'Insert an instance of an existing component into a container.',
      inputSchema: createInstanceInputSchema,
    },
    setTokens: {
      description:
        'Create or update named visual themes and document design tokens, and set the persisted default theme (activeThemeId). Token modes are keyed by theme id; event actions can switch themes at runtime.',
      inputSchema: setTokensInputSchema,
    },
    viewNode: {
      description: imageInputsEnabled
        ? 'Render a sharp image of one node and inspect the result.'
        : 'Node image viewing is unavailable.',
      inputSchema: viewNodeInputSchema,
      toModelOutput: imageToolOutput('The node produced no image.'),
    },
    viewPage: {
      description: imageInputsEnabled
        ? 'Render one responsive Page and inspect the complete result.'
        : 'Page image viewing is unavailable.',
      inputSchema: viewPageInputSchema,
      toModelOutput: imageToolOutput('The Page produced no image.'),
    },
    viewCanvas: {
      description: imageInputsEnabled
        ? 'Render the current structured canvas. Use this after meaningful design edits.'
        : 'Canvas image viewing is unavailable.',
      inputSchema: viewCanvasInputSchema,
      toModelOutput: imageToolOutput('The canvas produced no image.'),
    },
  }
}
