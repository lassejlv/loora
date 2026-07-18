import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { nanoid } from 'nanoid'
import {
  BookOpenIcon,
  CheckIcon,
  CodeIcon,
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
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '#/components/ai-elements/prompt-input'
import type { CanvasActions } from '#/lib/canvas'
import type { Shape } from '#/lib/canvas'
import { snapshotCanvas } from '#/lib/snapshot'
import { commitIfChanged } from '#/lib/history'
import { Sidebar } from '#/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import { interruptIn, interruptTransition } from '#/lib/motion'
import { orpc } from '#/lib/orpc-client'
import { DEFAULT_MODEL, MODELS } from '#/lib/models'
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
  return messages.flatMap((message) => {
    const parts = message.parts.flatMap((part) => {
      if (part.type === 'file' || part.type === 'tool-loadSkill') return []
      if (part.type === 'tool-viewCanvas' && part.state === 'output-available') {
        return [{ ...part, output: { viewed: true } }]
      }
      return [part]
    })
    return parts.length > 0 ? [{ ...message, parts }] : []
  })
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

function hasAssistantOutput(message: UIMessage) {
  return message.parts.some((part) => {
    if (part.type === 'step-start') return false
    if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length > 0
    return true
  })
}

function AgentThinking({ label = 'Thinking' }: { label?: string }) {
  return (
    <p className="cx-agent-thinking w-fit text-sm" role="status" aria-label={`${label}…`}>
      <span aria-hidden="true">
        {[...label].map((character, index) => (
          <span
            key={`${character}-${index}`}
            data-char
            style={{ '--cx-char-index': index } as React.CSSProperties}
          >
            {character}
          </span>
        ))}
        <span className="cx-agent-thinking-dots">…</span>
      </span>
    </p>
  )
}

export function AgentPanel({
  actions,
  shapesRef,
  selectedIdsRef,
  docId,
  ready = true,
}: {
  actions: CanvasActions
  shapesRef: React.RefObject<Shape[]>
  selectedIdsRef?: React.RefObject<string[]>
  docId: string
  ready?: boolean
}) {
  const [input, setInput] = useState('')
  const [model, setModel] = useState(() => {
    // localStorage is absent in the node test environment
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem('loora:model')
    return stored && MODELS.some((m) => m.id === stored) ? stored : DEFAULT_MODEL
  })
  const modelRef = useRef(model)
  modelRef.current = model
  const changeModel = (next: string) => {
    setModel(next)
    if (typeof localStorage !== 'undefined') localStorage.setItem('loora:model', next)
  }
  const [chatReady, setChatReady] = useState(false)
  const [stallError, setStallError] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const emptyResponseRetries = useRef(0)
  const retryEmptyResponse = useRef<() => void>(() => {})
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const activeChat = chats.find((chat) => chat.id === activeChatId)

  const { messages, setMessages, sendMessage, regenerate, addToolOutput, status, stop, error } =
    useChat({
      transport: new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          shapes: shapesRef.current,
          selectedIds: selectedIdsRef?.current ?? [],
          model: modelRef.current,
        }),
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onFinish({ message, isAbort, isError }) {
        if (isAbort || isError || hasAssistantOutput(message)) {
          emptyResponseRetries.current = 0
          return
        }

        // Server-side aborts arrive as a successful empty stream (isAbort stays false).
        // Regenerate drops the empty assistant turn; sendMessage() would resubmit it.
        if (emptyResponseRetries.current === 0) {
          emptyResponseRetries.current = 1
          setStallError('The agent returned an empty response. Retrying…')
          queueMicrotask(() => retryEmptyResponse.current())
          return
        }

        setStallError(
          'The agent timed out or returned empty twice. Try a smaller request, or try again.',
        )
      },
      onToolCall({ toolCall }) {
        if (toolCall.dynamic) return
        const input = toolCall.input as Record<string, unknown>
        const respond = (output: unknown) =>
          addToolOutput({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            output,
          } as Parameters<typeof addToolOutput>[0])
        const fail = (message: string) =>
          addToolOutput({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            state: 'output-error',
            errorText: message,
          } as Parameters<typeof addToolOutput>[0])

        try {
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
            case 'createComponent': {
              const { name, code, x, y, w, h } = input as {
                name: string
                code: string
                x: number
                y: number
                w: number
                h: number
              }
              const created = actions.createShape({
                type: 'component',
                x,
                y,
                w,
                h,
                fill: '#ffffff',
                text: name,
                code,
              })
              respond({ id: created.id, name })
              break
            }
            case 'updateComponent': {
              const { id, name, code, ...bounds } = input as {
                id: string
                name?: string
                code?: string
              } & Partial<Shape>
              const updated = actions.updateShape(id, {
                ...bounds,
                ...(name != null ? { text: name } : {}),
                ...(code != null ? { code } : {}),
              })
              respond(updated ? { id, updated: true } : { error: `No component with id ${id}` })
              break
            }
            case 'viewCanvas':
              void snapshotCanvas(shapesRef.current)
                .then((image) => respond(image ? { image } : { empty: true }))
                .catch(() => fail('Could not capture the canvas.'))
              break
            case 'deleteShape':
            case 'askQuestion':
              // These tools wait for the user in their inline controls.
              break
            default:
              fail(`Unsupported tool: ${toolCall.toolName}`)
          }
        } catch (error) {
          fail(error instanceof Error ? error.message : 'The canvas tool failed.')
        }
      },
    })

  retryEmptyResponse.current = () => {
    setStallError(null)
    void regenerate()
  }

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (chatReady) composerRef.current?.focus()
  }, [chatReady])

  useEffect(() => {
    if (status !== 'submitted' && status !== 'streaming') return
    // Gemini may think for a long stretch before the first stream token; keep this
    // above typical design-task time-to-first-tool so we don't abort healthy work.
    const timeout = window.setTimeout(() => {
      void stop()
      setStallError('The agent stopped after 2 minutes without progress. Try again.')
    }, 120_000)
    return () => window.clearTimeout(timeout)
  }, [messages, status, stop])

  useEffect(() => {
    let cancelled = false
    setChatReady(false)
    setChats([])
    setActiveChatId(null)
    setMessages([])
    if (!ready) return

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
  }, [docId, ready, setMessages])

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
                      <AgentThinking key={i} label="Reasoning" />
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
            <AgentThinking />
          )}
          {(stallError || error) && (
            <p className="text-xs text-destructive-foreground">
              {stallError || error?.message || 'Request failed.'}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-3">
        <PromptInput
          accept="image/*"
          onSubmit={async ({ text, files }) => {
            const trimmed = text.trim()
            if (!trimmed || !chatReady || status === 'streaming' || status === 'submitted') return
            setInput('')
            setStallError(null)
            emptyResponseRetries.current = 0
            if (activeChat?.title === 'New chat') {
              const title = titleFromPrompt(trimmed)
              setChats((current) =>
                current.map((chat) => (chat.id === activeChatId ? { ...chat, title } : chat)),
              )
            }
            // safety checkpoint: restorable from History if the agent goes wrong
            commitIfChanged(docId, `Before: ${trimmed.slice(0, 60)}`, shapesRef.current)
            void orpc.history
              .commit({
                id: `c${nanoid()}`,
                designId: docId,
                message: `Before: ${trimmed.slice(0, 60)}`,
                shapes: shapesRef.current,
                skipIfUnchanged: true,
              })
              .catch((error) => console.error('[history] Failed to save checkpoint:', error))
            const snapshot = await snapshotCanvas(shapesRef.current)
            sendMessage({
              text: trimmed,
              files: [
                ...files,
                ...(snapshot
                  ? [{ type: 'file' as const, mediaType: 'image/png', url: snapshot }]
                  : []),
              ],
            })
          }}
        >
          <PromptInputTextarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={chatReady ? 'Describe a change…' : 'Loading chat…'}
            disabled={!chatReady}
            className="w-full"
          />
          <PromptInputFooter>
            <ModelPicker model={model} onModelChange={changeModel} />
            <PromptInputSubmit
              status={status}
              onStop={() => stop()}
              disabled={
                status !== 'streaming' &&
                status !== 'submitted' &&
                (!chatReady || !input.trim())
              }
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </Sidebar>
  )
}


function modelLabel(model: string) {
  return MODELS.find((m) => m.id === model)?.label ?? model
}

function ModelPicker({
  model,
  onModelChange,
}: {
  model: string
  onModelChange: (model: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {modelLabel(model)}
          <ChevronDownIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Model</DropdownMenuLabel>
        {MODELS.map(({ id, label }) => (
          <DropdownMenuItem key={id} onSelect={() => onModelChange(id)}>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {model === id && <CheckIcon className="text-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  createComponent: { icon: CodeIcon, label: 'Component' },
  updateComponent: { icon: CodeIcon, label: 'Component' },
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
  if (name === 'createComponent' || name === 'updateComponent') {
    const label = String(input.name ?? (target?.text || input.id) ?? '')
    const kb = typeof input.code === 'string' ? ` · ${Math.max(1, Math.round(input.code.length / 1024))}KB jsx` : ''
    return `${label}${kb}`
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

  const reduceMotion = useReducedMotion()
  const enter = interruptIn(reduceMotion)

  return (
    <motion.div
      className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2.5"
      initial={enter.initial}
      animate={enter.animate}
      transition={interruptTransition(reduceMotion)}
    >
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
    </motion.div>
  )
}

const PAST_TENSE = {
  createShape: 'Created',
  createShapes: 'Created',
  updateShape: 'Updated',
  deleteShape: 'Deleted',
  loadSkill: 'Loaded skill',
  viewCanvas: 'Verified',
  createComponent: 'Built component',
  updateComponent: 'Updated component',
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
  const reduceMotion = useReducedMotion()
  const enter = interruptIn(reduceMotion)
  const transition = interruptTransition(reduceMotion)

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
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-left text-xs">
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
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-1 border-l pl-3 pt-1.5">
            {parts.map((p) => (
              <ToolRow key={p.toolCallId} part={p} shapesRef={shapesRef} onResolveDelete={onResolveDelete} hideConfirm />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* confirmations stay visible even when the group is collapsed */}
      <AnimatePresence>
        {pendingDeletes.length === 1 && (
          <motion.div
            key={pendingDeletes[0].toolCallId}
            initial={enter.initial}
            animate={enter.animate}
            exit={enter.exit}
            transition={transition}
          >
            <DeleteConfirm part={pendingDeletes[0]} shapesRef={shapesRef} onResolveDelete={onResolveDelete} />
          </motion.div>
        )}
        {pendingDeletes.length > 1 && (
          <motion.div
            key="batch-delete"
            initial={enter.initial}
            animate={enter.animate}
            exit={enter.exit}
            transition={transition}
          >
            <BatchDeleteConfirm parts={pendingDeletes} shapesRef={shapesRef} onResolveDelete={onResolveDelete} />
          </motion.div>
        )}
      </AnimatePresence>
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
  const reduceMotion = useReducedMotion()
  const enter = interruptIn(reduceMotion)

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

      <AnimatePresence>
        {awaitingConfirm && !hideConfirm && (
          <motion.div
            key={part.toolCallId}
            initial={enter.initial}
            animate={enter.animate}
            exit={enter.exit}
            transition={interruptTransition(reduceMotion)}
          >
            <DeleteConfirm part={part} shapesRef={shapesRef} onResolveDelete={onResolveDelete} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
