import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { nanoid } from 'nanoid'
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  PenLineIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
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
import { Sidebar } from '#/components/ui/sidebar'
import { orpc } from '#/lib/orpc-client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

type ChatState = ReturnType<typeof useChat>
type ChatSummary = { id: string; title: string; updatedAt: number }

function messagesForStorage(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part) => {
      if (part.type === 'file') return []
      if (part.type === 'tool-viewCanvas' && part.state === 'output-available') {
        return [{ ...part, output: { viewed: true } }]
      }
      return [part]
    }),
  }))
}

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

function titleFromPrompt(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, ' ')
  return title.length > 48 ? `${title.slice(0, 47)}…` : title
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
  const [input, setInput] = useState('')
  const [chatReady, setChatReady] = useState(false)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const activeChat = chats.find((chat) => chat.id === activeChatId)

  const { messages, setMessages, sendMessage, addToolOutput, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        shapes: shapesRef.current,
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

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    let cancelled = false
    setChatReady(false)
    setChats([])
    setActiveChatId(null)
    setMessages([])

    void (async () => {
      try {
        let stored = await orpc.chat.list({ designId: docId })
        if (stored.length === 0) {
          const created = await orpc.chat.create({
            id: `chat:${docId}`,
            designId: docId,
            title: 'New chat',
          })
          stored = [created]
        }
        if (!cancelled) {
          setChats(stored)
          setActiveChatId(stored[0].id)
        }
      } catch (error) {
        console.error('[chat] Failed to list chats:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [docId, setMessages])

  useEffect(() => {
    if (!activeChatId) return
    let cancelled = false
    setChatReady(false)
    setMessages([])

    orpc.chat
      .get({ id: activeChatId })
      .then(({ messages: stored }) => {
        if (!cancelled) {
          setMessages(stored as UIMessage[])
          setChatReady(true)
        }
      })
      .catch((error) => console.error('[chat] Failed to load chat:', error))

    return () => {
      cancelled = true
    }
  }, [activeChatId, setMessages])

  useEffect(() => {
    if (!chatReady || !activeChatId || !activeChat) return
    const timeout = window.setTimeout(() => {
      void orpc.chat
        .save({
          id: activeChatId,
          title: activeChat.title,
          messages: messagesForStorage(messages),
        })
        .catch((error) => console.error('[chat] Failed to save chat:', error))
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [activeChat, activeChatId, chatReady, messages])

  useEffect(() => {
    if (!chatReady || !activeChatId) return
    const chatId = activeChatId
    return () => {
      const title = chatsRef.current.find((chat) => chat.id === chatId)?.title ?? 'New chat'
      void orpc.chat
        .save({ id: chatId, title, messages: messagesForStorage(messagesRef.current) })
        .catch((error) => console.error('[chat] Failed to save chat:', error))
    }
  }, [activeChatId, chatReady])

  const createChat = async () => {
    const created = await orpc.chat.create({
      id: `chat_${nanoid()}`,
      designId: docId,
      title: 'New chat',
    })
    setChats((current) => [created, ...current])
    setActiveChatId(created.id)
  }

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
    <Sidebar
      variant="floating"
      className="[&_[data-slot=sidebar-inner]]:overflow-hidden [&_[data-slot=sidebar-inner]]:rounded-2xl [&_[data-slot=sidebar-inner]]:shadow-sm"
    >
      <header className="flex items-center border-b px-3 py-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={status === 'streaming' || status === 'submitted' || !activeChat}
              className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  status === 'streaming' || status === 'submitted'
                    ? 'animate-pulse bg-cx-accent'
                    : 'bg-muted-foreground/40',
                )}
              />
              <span className="truncate">{activeChat?.title ?? 'Loading…'}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Chats</DropdownMenuLabel>
            {chats.map((chat) => (
              <DropdownMenuItem key={chat.id} onSelect={() => setActiveChatId(chat.id)}>
                <MessageSquareIcon />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                {chat.id === activeChatId && <CheckIcon className="text-foreground" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void createChat()}>
              <PlusIcon />
              New chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Direct the canvas"
              description='Try "add a title that says Hello" or "make three blue squares in a row".'
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
              {error.message || 'Request failed.'}
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
            if (activeChat?.title === 'New chat') {
              const title = titleFromPrompt(text)
              setChats((current) =>
                current.map((chat) => (chat.id === activeChatId ? { ...chat, title } : chat)),
              )
            }
            // safety checkpoint: restorable from History if the agent goes wrong
            commitIfChanged(docId, `Before: ${text.slice(0, 60)}`, shapesRef.current)
            void orpc.history
              .commit({
                id: `c${nanoid()}`,
                designId: docId,
                message: `Before: ${text.slice(0, 60)}`,
                shapes: shapesRef.current,
                skipIfUnchanged: true,
              })
              .catch((error) => console.error('[history] Failed to save checkpoint:', error))
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
            placeholder="Describe a change…"
            disabled={!chatReady}
            className="resize-none"
          />
          <div className="flex justify-end">
            {status === 'streaming' || status === 'submitted' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => stop()}>
                Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!chatReady || !input.trim()}>
                Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </Sidebar>
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
