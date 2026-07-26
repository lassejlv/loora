export type KeyChord = {
  /** Lowercase key or special name (`escape`, `delete`, `backspace`, `arrowleft`, …). */
  key: string
  /** Prefer for layout-independent digits (`Digit1`). */
  code?: string
  /** Cmd on macOS / Ctrl elsewhere — matched as metaKey || ctrlKey. */
  meta?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export type BuiltInShortcutId =
  | 'undo'
  | 'redo'
  | 'group'
  | 'ungroup'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'zoomToFit'
  | 'zoomToSelection'
  | 'selectAll'
  | 'duplicate'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'bringForward'
  | 'bringToFront'
  | 'sendBackward'
  | 'sendToBack'
  | 'tool.select'
  | 'tool.interact'
  | 'tool.comment'
  | 'tool.text'
  | 'tool.box'
  | 'tool.image'
  | 'tool.hand'
  | 'delete'
  | 'escape'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'nudgeUp'
  | 'nudgeDown'
  | 'toggleAgent'
  | 'toggleLayers'
  | 'toggleAssets'
  | 'toggleHistory'
  | 'openCommandMenu'
  | 'openSettings'

export type CustomShortcut = {
  id: string
  name: string
  chord: KeyChord
  action: { type: 'agentPrompt'; prompt: string }
}

export type ShortcutConfig = {
  /** `null` = explicitly unbound. */
  overrides: Partial<Record<BuiltInShortcutId, KeyChord | KeyChord[] | null>>
  custom: CustomShortcut[]
}

export const EMPTY_SHORTCUT_CONFIG: ShortcutConfig = {
  overrides: {},
  custom: [],
}
