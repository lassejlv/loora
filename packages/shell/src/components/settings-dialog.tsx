import { useEffect, useState } from 'react'
import { Dialog, DialogPopup } from '@loora/ui/dialog'
import { SettingsPanel } from '#/components/settings-panel'
import { orpc } from '@loora/rpc/client'
import {
  cacheShortcuts,
  loadCachedShortcuts,
  normalizeConfig,
  type ShortcutConfig,
} from '@loora/editor/lib/shortcuts'

/**
 * Settings as a dialog, with the shortcut config it edits. Every app surface
 * that offers Settings mounts this one, so the screen cannot drift between the
 * file browser and the account pages.
 *
 * The editor keeps its own copy: it also renders shortcut chords in menus, so
 * the config lives in editor state rather than here.
 */
export function AppSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [config, setConfig] = useState<ShortcutConfig>(loadCachedShortcuts)

  useEffect(() => {
    let cancelled = false
    void orpc.preferences
      .get()
      .then((preferences) => {
        if (cancelled) return
        const next = normalizeConfig(preferences.shortcuts)
        setConfig(next)
        cacheShortcuts(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup showCloseButton={false} className="h-[min(70svh,36rem)] overflow-hidden p-0">
        <SettingsPanel
          onClose={() => onOpenChange(false)}
          shortcutConfig={config}
          onShortcutConfigChange={(next) => {
            const normalized = normalizeConfig(next)
            setConfig(normalized)
            cacheShortcuts(normalized)
            void orpc.preferences.save({ shortcuts: normalized }).catch(() => undefined)
          }}
        />
      </DialogPopup>
    </Dialog>
  )
}
