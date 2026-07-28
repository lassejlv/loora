import { useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  BUILTIN_META,
  DEFAULT_SHORTCUTS,
  SHORTCUT_GROUPS,
  chordsOf,
  detectConflicts,
  eventToChord,
  formatChord,
  resolveBuiltIn,
  type BuiltInShortcutId,
  type ShortcutConfig,
} from '#/lib/shortcuts'
import { cn } from '#/lib/utils'

export function ShortcutsSettings({
  config,
  onChange,
}: {
  config: ShortcutConfig
  onChange: (next: ShortcutConfig) => void
}) {
  const [draft, setDraft] = useState(config)
  const [recording, setRecording] = useState<
    { kind: 'builtIn'; id: BuiltInShortcutId } | null
  >(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(config)
  }, [config])

  const scheduleSave = (next: ShortcutConfig) => {
    // Don't persist conflicting maps — runtime would be ambiguous and RPC rejects them.
    if (detectConflicts(next).length > 0) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onChange(next), 300)
  }

  const commit = (next: ShortcutConfig) => {
    setDraft(next)
    scheduleSave(next)
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!recording) return
    const target = recording
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const chord = eventToChord(e)
      if (!chord) return

      setDraft((current) => {
        const next = {
          ...current,
          overrides: { ...current.overrides, [target.id]: chord },
        }
        if (detectConflicts(next).length === 0) {
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => onChange(next), 300)
        }
        return next
      })
      setRecording(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, onChange])

  const conflicts = detectConflicts(draft)

  const resetBuiltIn = (id: BuiltInShortcutId) => {
    const overrides = { ...draft.overrides }
    delete overrides[id]
    commit({ ...draft, overrides })
  }

  const unbindBuiltIn = (id: BuiltInShortcutId) => {
    commit({
      ...draft,
      overrides: { ...draft.overrides, [id]: null },
    })
  }

  const resetAll = () => {
    commit({ overrides: {}, custom: [] })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Remap editor actions. Space-hold hand tool stays fixed.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={resetAll}>
          Reset built-ins
        </Button>
      </div>

      {conflicts.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground"
        >
          {conflicts.map((conflict) => (
            <p key={conflict.serialized}>
              {conflict.label} is used by {conflict.owners.join(' and ')}.
            </p>
          ))}
        </div>
      )}

      {SHORTCUT_GROUPS.map((group) => {
        const ids = (
          Object.keys(BUILTIN_META) as BuiltInShortcutId[]
        ).filter((id) => BUILTIN_META[id].group === group.id)
        return (
          <section key={group.id} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h3>
            <ul className="divide-y rounded-lg border">
              {ids.map((id) => {
                const chords = resolveBuiltIn(id, draft)
                const isDefault =
                  !Object.prototype.hasOwnProperty.call(draft.overrides, id)
                const isRecording =
                  recording?.kind === 'builtIn' && recording.id === id
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {BUILTIN_META[id].label}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        'rounded-md border px-2 py-1 font-mono text-xs tabular-nums',
                        isRecording
                          ? 'border-cx-accent bg-cx-accent/10 text-cx-accent'
                          : 'bg-secondary/60 hover:bg-secondary',
                      )}
                      onClick={() => setRecording({ kind: 'builtIn', id })}
                    >
                      {isRecording ? 'Press keys…' : formatChord(chords)}
                    </button>
                    {!isDefault && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => resetBuiltIn(id)}
                      >
                        Default
                      </Button>
                    )}
                    {chords !== null && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => unbindBuiltIn(id)}
                      >
                        Clear
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <p className="text-[11px] text-muted-foreground">
        Defaults include {Object.keys(DEFAULT_SHORTCUTS).length} actions
        {chordsOf(DEFAULT_SHORTCUTS['tool.select']).length
          ? ` (e.g. Select is ${formatChord(DEFAULT_SHORTCUTS['tool.select'])})`
          : ''}
        .
      </p>
    </div>
  )
}
