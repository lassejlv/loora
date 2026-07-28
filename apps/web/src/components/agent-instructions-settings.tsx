import { useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { MAX_AGENT_SYSTEM_PROMPT_LENGTH } from '@loora/agent/prompts'

export function AgentInstructionsSettings({
  savedPrompt,
  onSave,
}: {
  savedPrompt: string
  onSave: (prompt: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(savedPrompt)
  const [baseline, setBaseline] = useState(savedPrompt)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const submittedPrompt = useRef<string | null>(null)

  useEffect(() => {
    if (submittedPrompt.current === savedPrompt) {
      submittedPrompt.current = null
      return
    }
    setDraft(savedPrompt)
    setBaseline(savedPrompt)
    setStatus('idle')
  }, [savedPrompt])

  const dirty = draft !== baseline

  async function save() {
    const prompt = draft.trim()
    submittedPrompt.current = prompt
    setStatus('saving')
    try {
      await onSave(prompt)
      setDraft(prompt)
      setBaseline(prompt)
      setStatus('saved')
    } catch {
      submittedPrompt.current = null
      setStatus('error')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="built-in-agent-instructions">
        <h2 id="built-in-agent-instructions" className="text-sm font-semibold">
          Loora&apos;s built-in instructions
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          These protected instructions always run first and cannot be edited here.
        </p>
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
          Loora keeps its canvas tools and verification workflow, security and billing safeguards,
          and the live canvas, selection, asset, and repository context needed for each request.
          Parallel workers remain read-only.
        </div>
      </section>

      <section aria-labelledby="custom-agent-instructions">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="custom-agent-instructions" className="text-sm font-semibold">
              Custom instructions
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Add account-wide preferences for tone, workflow, and design decisions.
            </p>
          </div>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {draft.length.toLocaleString()}/{MAX_AGENT_SYSTEM_PROMPT_LENGTH.toLocaleString()}
          </span>
        </div>
        <label htmlFor="agent-system-prompt" className="sr-only">
          Custom agent instructions
        </label>
        <Textarea
          id="agent-system-prompt"
          value={draft}
          maxLength={MAX_AGENT_SYSTEM_PROMPT_LENGTH}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            setStatus('idle')
          }}
          placeholder="For example: Keep copy concise, use warm neutral colors, and explain important tradeoffs."
          className="mt-3"
          style={{ minHeight: 180 }}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Do not include passwords, API keys, private tokens, or other secret data.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || status === 'saving'}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={draft.length === 0 || status === 'saving'}
            onClick={() => {
              setDraft('')
              setStatus('idle')
            }}
          >
            Use default
          </Button>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {status === 'error'
              ? 'Could not save. Your changes are still here—try again.'
              : status === 'saved'
                ? 'Saved'
                : dirty
                  ? 'Unsaved changes'
                  : ''}
          </span>
        </div>
      </section>
    </div>
  )
}
