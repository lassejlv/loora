import { useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useLoginWithChatGPT } from '@opencoredev/loginwithchatgpt-react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import {
  BookOpenIcon,
  CheckIcon,
  EyeIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  PenLineIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '#/components/ai-elements/conversation'
import { Message, MessageContent } from '#/components/ai-elements/message'
import { Textarea } from '#/components/ui/textarea'
import type { CanvasActions } from '#/lib/canvas'
import type { Shape } from '#/lib/canvas'
import { snapshotCanvas } from '#/lib/snapshot'
import { commitIfChanged } from '#/lib/history'
import { CHATGPT_PREFERRED, GEMINI_MODELS } from '#/lib/models'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

const KEY_STORAGE = 'loora:gemini-key'
const LEGACY_KEY_STORAGE = 'canvasx:gemini-key'
const PROVIDER_STORAGE = 'loora:provider'
const MODEL_STORAGE = 'loora:model'

type ChatState = ReturnType<typeof useChat>

// Shimmer until the assistant starts producing visible text (covers tool rounds too).
function isThinking(status: ChatState['status'], messages: ChatState['messages']) {
  if (status === 'submitted') return true
  if (status !== 'streaming') return false
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return true
  const lastPart = last.parts[last.parts.length - 1]
  // reasoning has its own indicator; text means visible output has started
  if (lastPart?.type === 'reasoning') return false
  return !(lastPart?.type === 'text' && lastPart.text.length > 0)
}

function getKey() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(KEY_STORAGE) ?? localStorage.getItem(LEGACY_KEY_STORAGE) ?? ''
}

export function AgentPanel({
  actions,
  shapesRef,
  docId,
}: {
  actions: CanvasActions
  shapesRef: React.RefObject<Shape[]>
  docId: string
}) {
  const [hasKey, setHasKey] = useState(() => getKey().length > 0)
  const [input, setInput] = useState('')
  const lwc = useLoginWithChatGPT()
  const [provider, setProviderState] = useState<'gemini' | 'chatgpt'>(() =>
    typeof window !== 'undefined' && localStorage.getItem(PROVIDER_STORAGE) === 'chatgpt'
      ? 'chatgpt'
      : 'gemini',
  )
  const setProvider = (p: 'gemini' | 'chatgpt') => {
    setProviderState(p)
    localStorage.setItem(PROVIDER_STORAGE, p)
  }

  // Fall back to whichever provider is actually connected.
  const ready = { gemini: hasKey, chatgpt: lwc.isAuthenticated }
  const activeProvider = ready[provider] ? provider : ready.gemini ? 'gemini' : ready.chatgpt ? 'chatgpt' : provider
  const hasAuth = ready.gemini || ready.chatgpt
  const activeProviderRef = useRef(activeProvider)
  activeProviderRef.current = activeProvider

  // Model choice per provider, hardcoded lists for now.
  const [modelChoice, setModelChoice] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(MODEL_STORAGE) ?? '{}')
    } catch {
      return {}
    }
  })

  const modelOptions = activeProvider === 'chatgpt' ? CHATGPT_PREFERRED : GEMINI_MODELS
  const activeModel = modelOptions.includes(modelChoice[activeProvider])
    ? modelChoice[activeProvider]
    : modelOptions[0]
  const activeModelRef = useRef(activeModel)
  activeModelRef.current = activeModel

  const pickModel = (m: string) => {
    const next = { ...modelChoice, [activeProvider]: m }
    setModelChoice(next)
    localStorage.setItem(MODEL_STORAGE, JSON.stringify(next))
  }

  const { messages, sendMessage, addToolOutput, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      headers: () => ({ 'x-gemini-key': getKey() }),
      body: () => ({
        shapes: shapesRef.current,
        provider: activeProviderRef.current,
        model: activeModelRef.current,
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall({ toolCall }) {
      if (toolCall.dynamic) return
      const input = toolCall.input as Record<string, unknown>
      const respond = (output: unknown) =>
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output,
        } as Parameters<typeof addToolOutput>[0])
      switch (toolCall.toolName) {
        case 'createShape':
          respond(actions.createShape(input as never))
          break
        case 'createShapes':
          respond(actions.createShapes((input as { shapes: Omit<Shape, 'id'>[] }).shapes))
          break
        case 'updateShape': {
          const { id, ...patch } = input as { id: string } & Partial<Shape>
          const updated = actions.updateShape(id, patch)
          respond(updated ?? { error: `No shape with id ${id}` })
          break
        }
        case 'viewCanvas':
          snapshotCanvas(shapesRef.current).then((image) =>
            respond(image ? { image } : { empty: true }),
          )
          break
        // deleteShape is NOT handled here: it waits for user confirmation in the UI.
      }
    },
  })

  const answerQuestion = (toolCallId: string, answer: string) => {
    addToolOutput({
      tool: 'askQuestion',
      toolCallId,
      output: { answer },
    } as Parameters<typeof addToolOutput>[0])
  }

  const resolveDelete = (toolCallId: string, allow: boolean, id: string) => {
    let output: unknown
    const target = shapesRef.current.find((s) => s.id === id)
    if (!allow) {
      output = { deleted: false, reason: 'User declined the deletion' }
    } else {
      const ok = actions.deleteShape(id)
      output = ok ? { deleted: true, ...target } : { error: 'No such shape' }
    }
    addToolOutput({
      tool: 'deleteShape',
      toolCallId,
      output,
    } as Parameters<typeof addToolOutput>[0])
  }

  return (
    <aside className="flex w-85 shrink-0 flex-col border-l bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${
              status === 'streaming' || status === 'submitted'
                ? 'animate-pulse bg-cx-accent'
                : 'bg-muted-foreground/40'
            }`}
          />
          <h2 className="text-sm font-semibold">Agent</h2>
        </div>
        <ConnectPopover
          hasKey={hasKey}
          onSaved={() => setHasKey(getKey().length > 0)}
          lwc={lwc}
          provider={provider}
          setProvider={setProvider}
        />
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState
              title={hasAuth ? 'Direct the canvas' : 'Connect a model'}
              description={
                hasAuth
                  ? 'Try "add a title that says Hello" or "make three blue squares in a row".'
                  : 'Connect a Gemini API key or your ChatGPT account (top right) to start.'
              }
            />
          )}
          {messages.map((message, mi) => (
            <Message from={message.role} key={message.id}>
              <MessageContent>
                {toBlocks(message.parts).map((block, i, blocks) =>
                  block.kind === 'text' ? (
                    <span key={i}>{block.text}</span>
                  ) : block.kind === 'reasoning' ? (
                    mi === messages.length - 1 &&
                    i === blocks.length - 1 &&
                    (status === 'streaming' || status === 'submitted') ? (
                      <p key={i} className="cx-shimmer w-fit text-sm">
                        Reasoning…
                      </p>
                    ) : null
                  ) : block.kind === 'question' ? (
                    <QuestionCard key={i} part={block.part} onAnswer={answerQuestion} />
                  ) : (
                    <ToolGroup
                      key={i}
                      parts={block.parts}
                      shapesRef={shapesRef}
                      onResolveDelete={resolveDelete}
                    />
                  ),
                )}
              </MessageContent>
            </Message>
          ))}
          {isThinking(status, messages) && (
            <p className="cx-shimmer w-fit text-sm">Thinking…</p>
          )}
          {error && (
            <p className="text-xs text-destructive-foreground">
              {error.message || 'Request failed. Check your API key.'}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-3">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!input.trim()) return
            const text = input
            setInput('')
            // safety checkpoint: restorable from History if the agent goes wrong
            commitIfChanged(docId, `Before: ${text.slice(0, 60)}`, shapesRef.current)
            const snapshot = await snapshotCanvas(shapesRef.current)
            sendMessage({
              text,
              files: snapshot
                ? [{ type: 'file', mediaType: 'image/png', url: snapshot }]
                : undefined,
            })
          }}
          className="flex flex-col gap-2"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            rows={3}
            placeholder={hasAuth ? 'Describe a change…' : 'Connect a model first'}
            disabled={!hasAuth}
            className="resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <Select value={activeModel ?? ''} onValueChange={(v) => v && pickModel(v as string)}>
              <SelectTrigger
                size="sm"
                className="h-7 max-w-44 border-none bg-transparent px-1.5 font-mono text-[11px] text-muted-foreground shadow-none"
                disabled={modelOptions.length === 0}
              >
                <SelectValue>{activeModel ?? 'no models'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    <span className="font-mono text-xs">{m}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {status === 'streaming' || status === 'submitted' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => stop()}>
                Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!hasAuth || !input.trim()}>
                Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </aside>
  )
}

interface ToolPart {
  type: string
  state:
    | 'input-streaming'
    | 'input-available'
    | 'output-available'
    | 'output-error'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-denied'
  toolCallId: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  errorText?: string
}

const TOOL_META = {
  createShape: { icon: PlusIcon, label: 'Create' },
  createShapes: { icon: PlusIcon, label: 'Create' },
  updateShape: { icon: PenLineIcon, label: 'Update' },
  deleteShape: { icon: Trash2Icon, label: 'Delete' },
  loadSkill: { icon: BookOpenIcon, label: 'Skill' },
  viewCanvas: { icon: EyeIcon, label: 'Verify' },
} as const

function describeShape(s: Partial<Shape> | undefined) {
  if (!s) return ''
  if (s.type === 'text' && s.text) return `text "${s.text}"`
  const size = s.w != null && s.h != null ? ` ${s.w}×${s.h}` : ''
  return `${s.type ?? 'shape'}${size}`
}

function toolSummary(name: string, part: ToolPart, shapes: Shape[]) {
  const input = part.input ?? {}
  if (name === 'createShape') {
    return `${describeShape(input as Partial<Shape>)} at (${input.x}, ${input.y})`
  }
  if (name === 'createShapes') {
    const batch = (input.shapes as Partial<Shape>[] | undefined) ?? []
    return `${batch.length} shapes`
  }
  const target = shapes.find((s) => s.id === input.id)
  if (name === 'updateShape') {
    const changed = Object.keys(input)
      .filter((k) => k !== 'id')
      .join(', ')
    return `${describeShape(target) || String(input.id ?? '')} · ${changed}`
  }
  if (name === 'deleteShape') {
    // after deletion the shape is gone from state; fall back to the tool output
    return describeShape(target ?? (part.output as Partial<Shape>)) || String(input.id ?? '')
  }
  if (name === 'loadSkill') {
    return String(input.name ?? '')
  }
  if (name === 'viewCanvas') {
    return 'looking at the canvas'
  }
  return ''
}

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning' }
  | { kind: 'tools'; parts: ToolPart[] }
  | { kind: 'question'; part: ToolPart }

// Group consecutive tool calls so a burst of 20 creates reads as one line.
// Questions stay standalone - they need their own interactive card.
function toBlocks(parts: { type: string }[]): Block[] {
  const blocks: Block[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ kind: 'text', text: (part as unknown as { text: string }).text })
    } else if (part.type === 'reasoning') {
      blocks.push({ kind: 'reasoning' })
    } else if (part.type === 'tool-askQuestion') {
      blocks.push({ kind: 'question', part: part as ToolPart })
    } else if (part.type.startsWith('tool-')) {
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'tools') last.parts.push(part as ToolPart)
      else blocks.push({ kind: 'tools', parts: [part as ToolPart] })
    }
  }
  return blocks
}

function QuestionCard({
  part,
  onAnswer,
}: {
  part: ToolPart
  onAnswer: (toolCallId: string, answer: string) => void
}) {
  const question = String(part.input?.question ?? '')
  const options = (part.input?.options as string[] | undefined) ?? []
  const answered = part.state === 'output-available'
  const answer = (part.output as { answer?: string } | undefined)?.answer

  if (answered) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{question}</span>
        <span className="shrink-0 font-medium text-foreground">{answer}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2.5">
      <p className="text-xs">{question}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant="outline"
            onClick={() => onAnswer(part.toolCallId, option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  )
}

const PAST_TENSE = {
  createShape: 'Created',
  createShapes: 'Created',
  updateShape: 'Updated',
  deleteShape: 'Deleted',
  loadSkill: 'Loaded skill',
  viewCanvas: 'Verified',
} as const

function ToolGroup({
  parts,
  shapesRef,
  onResolveDelete,
}: {
  parts: ToolPart[]
  shapesRef: React.RefObject<Shape[]>
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
}) {
  const [open, setOpen] = useState(false)

  if (parts.length === 1) {
    return <ToolRow part={parts[0]} shapesRef={shapesRef} onResolveDelete={onResolveDelete} />
  }

  const counts = new Map<string, number>()
  for (const p of parts) {
    const name = p.type.slice(5)
    const verb = PAST_TENSE[name as keyof typeof PAST_TENSE]
    // a batch call counts as its number of shapes, not 1
    const weight =
      name === 'createShapes' ? ((p.input?.shapes as unknown[] | undefined)?.length ?? 1) : 1
    if (verb) counts.set(verb, (counts.get(verb) ?? 0) + weight)
  }
  const summary = [...counts.entries()].map(([verb, n]) => `${verb} ${n}`).join(' · ')
  const busy = parts.some(
    (p) => p.state === 'input-streaming' || (p.state === 'input-available' && p.type !== 'tool-deleteShape'),
  )
  const failed = parts.some((p) => p.state === 'output-error' || (p.output as { error?: string })?.error)
  const pendingDeletes = parts.filter(
    (p) => p.type === 'tool-deleteShape' && p.state === 'input-available',
  )

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left text-xs"
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="font-medium">{summary}</span>
        <span className="ml-auto shrink-0">
          {failed ? (
            <XIcon className="size-3.5 text-destructive-foreground" />
          ) : busy ? (
            <span className="size-1.5 animate-pulse rounded-full bg-cx-accent" />
          ) : pendingDeletes.length === 0 ? (
            <CheckIcon className="size-3.5 text-muted-foreground" />
          ) : null}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-1 border-l pl-3">
          {parts.map((p) => (
            <ToolRow key={p.toolCallId} part={p} shapesRef={shapesRef} onResolveDelete={onResolveDelete} hideConfirm />
          ))}
        </div>
      )}

      {/* confirmations stay visible even when the group is collapsed */}
      {pendingDeletes.length === 1 && (
        <DeleteConfirm part={pendingDeletes[0]} shapesRef={shapesRef} onResolveDelete={onResolveDelete} />
      )}
      {pendingDeletes.length > 1 && (
        <BatchDeleteConfirm parts={pendingDeletes} shapesRef={shapesRef} onResolveDelete={onResolveDelete} />
      )}
    </div>
  )
}

function BatchDeleteConfirm({
  parts,
  shapesRef,
  onResolveDelete,
}: {
  parts: ToolPart[]
  shapesRef: React.RefObject<Shape[]>
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const targets = parts.map((p) => ({
    part: p,
    label:
      describeShape(shapesRef.current.find((s) => s.id === p.input?.id)) ||
      String(p.input?.id ?? ''),
  }))
  const visible = showAll ? targets : targets.slice(0, 3)
  const resolveAll = (allow: boolean) => {
    for (const p of parts) onResolveDelete(p.toolCallId, allow, String(p.input?.id ?? ''))
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2.5">
      <p className="text-xs font-medium">Delete {parts.length} shapes?</p>
      <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
        {visible.map(({ part, label }) => (
          <li key={part.toolCallId} className="truncate">
            {label}
          </li>
        ))}
      </ul>
      {targets.length > 3 && (
        <button
          type="button"
          className="w-fit text-[11px] text-muted-foreground underline underline-offset-2"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show less' : `Show all ${targets.length}`}
        </button>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => resolveAll(false)}>
          Keep all
        </Button>
        <Button size="sm" variant="destructive" onClick={() => resolveAll(true)}>
          Delete all
        </Button>
      </div>
    </div>
  )
}

function DeleteConfirm({
  part,
  shapesRef,
  onResolveDelete,
}: {
  part: ToolPart
  shapesRef: React.RefObject<Shape[]>
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
}) {
  const target = shapesRef.current.find((s) => s.id === part.input?.id)
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        Delete {describeShape(target) || 'this shape'}?
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onResolveDelete(part.toolCallId, false, String(part.input?.id ?? ''))}
      >
        Keep
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => onResolveDelete(part.toolCallId, true, String(part.input?.id ?? ''))}
      >
        Delete
      </Button>
    </div>
  )
}

function ToolRow({
  part,
  shapesRef,
  onResolveDelete,
  hideConfirm = false,
}: {
  part: ToolPart
  shapesRef: React.RefObject<Shape[]>
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
  hideConfirm?: boolean
}) {
  const name = part.type.slice(5)
  const meta = TOOL_META[name as keyof typeof TOOL_META]
  if (!meta) return null

  const denied = (part.output as { deleted?: boolean; reason?: string } | undefined)?.reason
  const failed = part.state === 'output-error' || Boolean((part.output as { error?: string })?.error)
  const awaitingConfirm = name === 'deleteShape' && part.state === 'input-available'
  const done = part.state === 'output-available'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs">
        <meta.icon
          className={cn(
            'size-3.5 shrink-0',
            name === 'deleteShape' ? 'text-destructive-foreground/70' : 'text-muted-foreground',
          )}
        />
        <span className="font-medium">{meta.label}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {toolSummary(name, part, shapesRef.current)}
        </span>
        <span className="ml-auto shrink-0">
          {failed ? (
            <XIcon className="size-3.5 text-destructive-foreground" />
          ) : denied ? (
            <span className="text-[11px] text-muted-foreground">denied</span>
          ) : done ? (
            <CheckIcon className="size-3.5 text-muted-foreground" />
          ) : awaitingConfirm ? null : (
            <span className="size-1.5 animate-pulse rounded-full bg-cx-accent" />
          )}
        </span>
      </div>

      {awaitingConfirm && !hideConfirm && (
        <DeleteConfirm part={part} shapesRef={shapesRef} onResolveDelete={onResolveDelete} />
      )}
    </div>
  )
}

function ConnectPopover({
  hasKey,
  onSaved,
  lwc,
  provider,
  setProvider,
}: {
  hasKey: boolean
  onSaved: () => void
  lwc: ReturnType<typeof useLoginWithChatGPT>
  provider: 'gemini' | 'chatgpt'
  setProvider: (p: 'gemini' | 'chatgpt') => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const connected = hasKey || lwc.isAuthenticated

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant={connected ? 'ghost' : 'outline'} size="sm">
            <KeyRoundIcon data-slot="icon" />
            {connected ? null : 'Connect'}
          </Button>
        }
      />
      <PopoverContent align="end" className="flex w-80 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Model</span>
          <div className="flex gap-1 rounded-lg bg-secondary p-0.5">
            {(['gemini', 'chatgpt'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs',
                  provider === p ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground',
                )}
              >
                {p === 'gemini' ? 'Gemini' : 'ChatGPT'}
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    (p === 'gemini' ? hasKey : lwc.isAuthenticated)
                      ? 'bg-success'
                      : 'bg-muted-foreground/40',
                  )}
                />
              </button>
            ))}
          </div>
        </div>

        <ChatGPTSection lwc={lwc} />

        <div className="h-px bg-border" />
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              localStorage.setItem(KEY_STORAGE, value.trim())
              setValue('')
              onSaved()
              setOpen(false)
            }}
          >
            <label className="text-sm font-medium" htmlFor="gemini-key">
              Gemini API key
            </label>
            <Input
              id="gemini-key"
              type="password"
              placeholder={hasKey ? 'Replace saved key' : 'AIza…'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Stored only in this browser&apos;s local storage. Get one at aistudio.google.com.
            </p>
            <div className="flex justify-end gap-2">
              {hasKey && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    localStorage.removeItem(KEY_STORAGE)
                    onSaved()
                    setOpen(false)
                  }}
                >
                  Remove key
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!value.trim()}>
                Save
              </Button>
            </div>
          </form>
      </PopoverContent>
    </Popover>
  )
}

function ChatGPTSection({ lwc }: { lwc: ReturnType<typeof useLoginWithChatGPT> }) {
  if (lwc.isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">ChatGPT</p>
          <p className="truncate text-xs text-muted-foreground">{lwc.user?.email ?? 'Connected'}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => lwc.logout()}>
          Disconnect
        </Button>
      </div>
    )
  }

  if (lwc.status === 'pending' || lwc.status === 'connecting') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">ChatGPT</p>
        {lwc.userCode ? (
          <>
            <p className="text-xs text-muted-foreground">
              Enter this code on the OpenAI page that opened:
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded-md border bg-secondary px-2 py-1 font-mono text-sm tracking-widest">
                {lwc.userCode}
              </code>
              <Button variant="outline" size="sm" onClick={() => lwc.copyCode()}>
                Copy
              </Button>
              {lwc.verificationUrl && (
                <Button variant="ghost" size="sm" onClick={() => lwc.reopen()}>
                  Reopen
                </Button>
              )}
            </div>
          </>
        ) : null}
        <p className="cx-shimmer w-fit text-xs">Waiting for approval…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">ChatGPT</p>
      <p className="text-xs text-muted-foreground">
        Signs in with your ChatGPT account via OpenAI&apos;s device flow. loora sends your prompts
        and canvas snapshots through your ChatGPT plan; only a session cookie is stored here.
      </p>
      {(lwc.status === 'error' || lwc.status === 'expired') && (
        <p className="text-xs text-destructive-foreground">
          {lwc.status === 'expired' ? 'Login expired - try again.' : 'Login failed - try again.'}
        </p>
      )}
      <Button size="sm" variant="outline" className="w-fit" onClick={() => lwc.login()}>
        Continue with ChatGPT
      </Button>
    </div>
  )
}
