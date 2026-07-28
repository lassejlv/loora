import { z } from 'zod'
import type { BuiltInShortcutId, ShortcutConfig } from '@loora/db/shortcuts'
import { EMPTY_SHORTCUT_CONFIG } from '@loora/db/shortcuts'

const BUILTIN_IDS = [
  'undo',
  'redo',
  'group',
  'ungroup',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'zoomToFit',
  'zoomToSelection',
  'selectAll',
  'duplicate',
  'copy',
  'paste',
  'cut',
  'bringForward',
  'bringToFront',
  'sendBackward',
  'sendToBack',
  'tool.select',
  'tool.interact',
  'tool.comment',
  'tool.text',
  'tool.box',
  'tool.image',
  'tool.hand',
  'delete',
  'escape',
  'nudgeLeft',
  'nudgeRight',
  'nudgeUp',
  'nudgeDown',
  'toggleLayers',
  'toggleAssets',
  'toggleHistory',
  'openCommandMenu',
  'openSettings',
] as const satisfies readonly BuiltInShortcutId[]

const builtinIdSet = new Set<string>(BUILTIN_IDS)

const keyChordSchema = z.object({
  key: z.string().min(1).max(32),
  code: z.string().min(1).max(64).optional(),
  meta: z.boolean().optional(),
  ctrl: z.boolean().optional(),
  shift: z.boolean().optional(),
  alt: z.boolean().optional(),
})

const chordOrChordsSchema = z.union([keyChordSchema, z.array(keyChordSchema).min(1).max(8)])

export const shortcutConfigSchema = z
  .object({
    overrides: z.record(z.string(), z.union([chordOrChordsSchema, z.null()])).optional(),
  })
  .superRefine((value, ctx) => {
    const overrides = value.overrides ?? {}
    for (const id of Object.keys(overrides)) {
      if (!builtinIdSet.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown shortcut action "${id}".`,
          path: ['overrides', id],
        })
      }
    }

    const seen = new Map<string, string>()
    const serialize = (chord: z.infer<typeof keyChordSchema>) =>
      [
        chord.meta ? 'meta' : '',
        chord.ctrl ? 'ctrl' : '',
        chord.alt ? 'alt' : '',
        chord.shift ? 'shift' : '',
        chord.code ? `code:${chord.code}` : '',
        `key:${chord.key.toLowerCase()}`,
      ]
        .filter(Boolean)
        .join('+')

    const add = (chord: z.infer<typeof keyChordSchema>, owner: string) => {
      const key = serialize(chord)
      const prev = seen.get(key)
      if (prev && prev !== owner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Shortcut conflict between "${prev}" and "${owner}".`,
        })
        return
      }
      seen.set(key, owner)
    }

    for (const [id, binding] of Object.entries(overrides)) {
      if (binding == null) continue
      const chords = Array.isArray(binding) ? binding : [binding]
      for (const chord of chords) add(chord, id)
    }
  })
  .transform((value): ShortcutConfig => ({
    overrides: (value.overrides ?? {}) as ShortcutConfig['overrides'],
    custom: Array.isArray((value as { custom?: unknown }).custom)
      ? ((value as { custom: ShortcutConfig['custom'] }).custom)
      : [],
  }))

export function parseShortcutConfig(input: unknown): ShortcutConfig {
  const parsed = shortcutConfigSchema.safeParse(input)
  if (!parsed.success) return { ...EMPTY_SHORTCUT_CONFIG }
  return parsed.data
}
