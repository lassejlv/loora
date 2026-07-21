import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
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
  type CustomShortcut,
  type KeyChord,
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
    | { kind: 'builtIn'; id: BuiltInShortcutId }
    | { kind: 'custom'; id: string }
    | { kind: 'newCustom' }
    | null
  >(null)
  const [newCustom, setNewCustom] = useState<{
    name: string
    prompt: string
    chord: KeyChord | null
  }>({ name: '', prompt: '', chord: null })
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

      if (target.kind === 'builtIn') {
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
      } else if (target.kind === 'custom') {
        setDraft((current) => {
          const next = {
            ...current,
            custom: current.custom.map((item) =>
              item.id === target.id ? { ...item, chord } : item,
            ),
          }
          if (detectConflicts(next).length === 0) {
            if (saveTimer.current) clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => onChange(next), 300)
          }
          return next
        })
      } else {
        setNewCustom((current) => ({ ...current, chord }))
      }
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
    commit({ overrides: {}, custom: draft.custom })
  }

  const addCustom = () => {
    if (!newCustom.name.trim() || !newCustom.prompt.trim() || !newCustom.chord) return
    const entry: CustomShortcut = {
      id: `sc_${nanoid(8)}`,
      name: newCustom.name.trim(),
      chord: newCustom.chord,
      action: { type: 'agentPrompt', prompt: newCustom.prompt.trim() },
    }
    commit({ ...draft, custom: [...draft.custom, entry] })
    setNewCustom({ name: '', prompt: '', chord: null })
  }

  const removeCustom = (id: string) => {
    commit({ ...draft, custom: draft.custom.filter((item) => item.id !== id) })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Remap editor actions or add custom shortcuts that send a prompt to the agent.
            Space-hold hand tool and code-editor ⌘Enter stay fixed.
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

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Custom agent prompts
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bind a key chord to send a saved message to the agent.
          </p>
        </div>

        {draft.custom.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {draft.custom.map((item) => {
              const isRecording =
                recording?.kind === 'custom' && recording.id === item.id
              return (
                <li key={item.id} className="flex flex-col gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        'rounded-md border px-2 py-1 font-mono text-xs',
                        isRecording
                          ? 'border-cx-accent bg-cx-accent/10 text-cx-accent'
                          : 'bg-secondary/60 hover:bg-secondary',
                      )}
                      onClick={() => setRecording({ kind: 'custom', id: item.id })}
                    >
                      {isRecording ? 'Press keys…' : formatChord(item.chord)}
                    </button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => removeCustom(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {item.action.prompt}
                  </p>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <Input
            size="sm"
            placeholder="Name"
            value={newCustom.name}
            onChange={(e) => setNewCustom((c) => ({ ...c, name: e.target.value }))}
          />
          <textarea
            className="min-h-20 w-full resize-y rounded-md border bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Agent prompt to send…"
            value={newCustom.prompt}
            onChange={(e) => setNewCustom((c) => ({ ...c, prompt: e.target.value }))}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(
                'rounded-md border px-2 py-1 font-mono text-xs',
                recording?.kind === 'newCustom'
                  ? 'border-cx-accent bg-cx-accent/10 text-cx-accent'
                  : 'bg-secondary/60 hover:bg-secondary',
              )}
              onClick={() => setRecording({ kind: 'newCustom' })}
            >
              {recording?.kind === 'newCustom'
                ? 'Press keys…'
                : newCustom.chord
                  ? formatChord(newCustom.chord)
                  : 'Record shortcut'}
            </button>
            <Button
              type="button"
              size="sm"
              disabled={
                !newCustom.name.trim() ||
                !newCustom.prompt.trim() ||
                !newCustom.chord ||
                draft.custom.length >= 50
              }
              onClick={addCustom}
            >
              Add shortcut
            </Button>
          </div>
        </div>
      </section>

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
