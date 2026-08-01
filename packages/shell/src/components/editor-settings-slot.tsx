import type { CanvasSettingsSlot } from '@loora/editor/editor'
import { SettingsPanel } from './settings-panel'

/**
 * The editor package owns the shortcut config but not the account, billing or
 * appearance surfaces the settings dialog is mostly made of, so the app hands
 * the body in and keeps those where the rest of the product settings live.
 */
export const renderEditorSettings: CanvasSettingsSlot = ({
  onClose,
  shortcutConfig,
  onShortcutConfigChange,
}) => (
  <SettingsPanel
    onClose={onClose}
    shortcutConfig={shortcutConfig}
    onShortcutConfigChange={onShortcutConfigChange}
  />
)
