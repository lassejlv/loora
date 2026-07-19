import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '#/components/ai-elements/prompt-input'
import type { CanvasElement, ElementActions } from '#/lib/canvas'
import { awaitRenderResult } from '#/components/element-frame'
import { snapshotCanvas } from '#/lib/snapshot'
import { commitIfChanged } from '#/lib/history'
import { Sidebar } from '#/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import { interruptIn, interruptTransition } from '#/lib/motion'
import { orpc } from '#/lib/orpc-client'
import { DEFAULT_MODEL, MODELS, PROVIDERS } from '#/lib/models'
import { modelSupportsImageInput } from '#/lib/ai-image-inputs'
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

function hasCanvasMutation(message: UIMessage) {
  return message.parts.some((part) =>
    [
      'tool-createElement',
      'tool-createElements',
      'tool-updateElement',
      'tool-deleteElement',
    ].includes(part.type),
  )
}

function promisesCanvasWork(message: UIMessage) {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')

  return (
    /\b(?:let me|i(?:['’]ll| will)|i(?:['’]m| am) going to)\s+(?:now\s+)?(?:build|create|design|make|add|update|edit|change|remove|delete|fix|rework|revise|implement|start|get started)\b/i.test(text) ||
    /\b(?:starting|building|creating|designing|updating)\s+(?:it|that|this|now)\b/i.test(text)
  )
}

function AgentThinking({ label = 'Thinking' }: { label?: string }) {
  const text = `${label}…`
  return (
    <p className="w-fit text-sm" role="status" aria-label={text}>
      <span className="cx-agent-thinking" aria-hidden="true">
        {text}
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
  sendRef,
}: {
  actions: ElementActions
  shapesRef: React.RefObject<CanvasElement[]>
  selectedIdsRef?: React.RefObject<string[]>
  docId: string
  ready?: boolean
  // Exposes a send-message entry point for canvas comment pins.
  sendRef?: React.RefObject<((text: string) => boolean) | null>
}) {
  const [input, setInput] = useState('')
  const [model, setModel] = useState(() => {
    // localStorage is absent in the node test environment
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem('loora:model')
    return stored && MODELS.some((m) => m.id === stored) ? stored : DEFAULT_MODEL
  })
  const modelRef = useRef(model)
  modelRef.current = model
  const imageInputsEnabled = modelSupportsImageInput(model)
  const changeModel = (next: string) => {
    setModel(next)
    if (typeof localStorage !== 'undefined') localStorage.setItem('loora:model', next)
  }
  const [chatReady, setChatReady] = useState(false)
  // Elements created from a still-streaming createElement call: toolCallId →
  // element id, so later chunks (and the final tool call) update instead of
  // duplicating.
  const streamedCreates = useRef(new Map<string, string>())
  const streamedAppliedAt = useRef(new Map<string, number>())
  const [stallError, setStallError] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const recoveryRetries = useRef(0)
  const retryResponse = useRef<() => void>(() => {})
  const forceCanvasAction = useRef(false)
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
          forceCanvasAction: forceCanvasAction.current,
        }),
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onFinish({ message, isAbort, isError }) {
        const stoppedBeforeAction =
          !hasCanvasMutation(message) &&
          (forceCanvasAction.current || promisesCanvasWork(message))
        if (isAbort || isError || (hasAssistantOutput(message) && !stoppedBeforeAction)) {
          recoveryRetries.current = 0
          forceCanvasAction.current = false
          return
        }

        // Regenerate drops the incomplete assistant turn; sendMessage() would resubmit it.
        if (recoveryRetries.current === 0) {
          recoveryRetries.current = 1
          forceCanvasAction.current = stoppedBeforeAction
          setStallError(
            stoppedBeforeAction
              ? 'The agent stopped before changing the canvas. Retrying…'
              : 'The agent returned an empty response. Retrying…',
          )
          queueMicrotask(() => retryResponse.current())
          return
        }

        setStallError(
          'The agent stopped twice without completing the request. Try again.',
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
        // Tool outputs echo geometry but never code (the model just wrote it —
        // echoing would double the tokens) plus the live render outcome so
        // broken code comes back as actionable feedback instead of a silent
        // stale frame.
        const ackWithRender = async (el: CanvasElement) => {
          const render = await awaitRenderResult(el.id)
          return {
            id: el.id,
            name: el.name,
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            render: render ? (render.ok ? 'ok' : `error: ${render.error}`) : 'unknown',
          }
        }

        try {
          switch (toolCall.toolName) {
            case 'createElement': {
              // If a live preview already created this element, finalize it in place.
              const streamedId = streamedCreates.current.get(toolCall.toolCallId)
              let element: CanvasElement
              if (streamedId) {
                streamedCreates.current.delete(toolCall.toolCallId)
                element =
                  actions.updateElement(streamedId, input as never) ??
                  actions.createElement(input as never)
              } else {
                element = actions.createElement(input as never)
              }
              void ackWithRender(element).then(respond)
              break
            }
            case 'createElements': {
              const batch = (input as { elements: Omit<CanvasElement, 'id'>[] }).elements
              const results: CanvasElement[] = new Array(batch.length)
              const fresh: { element: Omit<CanvasElement, 'id'>; index: number }[] = []
              batch.forEach((element, index) => {
                const key = `${toolCall.toolCallId}#${index}`
                const streamedId = streamedCreates.current.get(key)
                if (streamedId) {
                  streamedCreates.current.delete(key)
                  const updated = actions.updateElement(streamedId, element as never)
                  if (updated) {
                    results[index] = updated
                    return
                  }
                }
                fresh.push({ element, index })
              })
              if (fresh.length > 0) {
                const created = actions.createElements(fresh.map((f) => f.element))
                fresh.forEach((f, j) => {
                  results[f.index] = created[j]
                })
              }
              void Promise.all(results.filter(Boolean).map(ackWithRender)).then(respond)
              break
            }
            case 'updateElement': {
              const { id, ...patch } = input as { id: string } & Partial<CanvasElement>
              const updated = actions.updateElement(id, patch)
              if (!updated) {
                respond({ error: `No element with id ${id}` })
              } else if (typeof patch.code === 'string') {
                void ackWithRender(updated).then(respond)
              } else {
                respond(updated && { id: updated.id, name: updated.name, x: updated.x, y: updated.y, w: updated.w, h: updated.h })
              }
              break
            }
            case 'readElement': {
              const id = (input as { id?: string }).id
              const el = shapesRef.current.find((s) => s.id === id)
              respond(
                el
                  ? { id: el.id, name: el.name, x: el.x, y: el.y, w: el.w, h: el.h, code: el.code }
                  : { error: `No element with id ${String(id)}` },
              )
              break
            }
            case 'viewCanvas':
              if (!modelSupportsImageInput(modelRef.current)) {
                respond({ unavailable: true })
                break
              }
              void snapshotCanvas(shapesRef.current)
                .then((image) => respond(image ? { image } : { empty: true }))
                .catch(() => fail('Could not capture the canvas.'))
              break
            case 'deleteElement':
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

  retryResponse.current = () => {
    setStallError(null)
    void regenerate()
  }

  // Canvas comment pins send through here. Returns false while the chat is
  // busy or still loading so the caller can keep the comment draft open.
  if (sendRef) {
    sendRef.current = (text: string): boolean => {
      if (!chatReady || status === 'streaming' || status === 'submitted') return false
      setStallError(null)
      recoveryRetries.current = 0
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
      void (async () => {
        const snapshot = imageInputsEnabled ? await snapshotCanvas(shapesRef.current) : null
        void sendMessage({
          text,
          files: snapshot
            ? [{ type: 'file' as const, mediaType: 'image/png', url: snapshot }]
            : [],
        })
      })()
      return true
    }
  }

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Live preview: while a createElement/updateElement call is still streaming
  // its input, push the partial code into the canvas so the design appears as
  // it is generated instead of only after the full tool call parses. The
  // element runtime keeps the last successfully compiled payload, so partial
  // JSX/HTML chunks are safe to apply.
  useEffect(() => {
    if (status !== 'streaming') return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    for (const part of last.parts) {
      const p = part as unknown as ToolPart
      if (typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue
      if (p.state !== 'input-streaming' || !p.input) continue
      const input = p.input as Partial<CanvasElement> & {
        id?: string
        elements?: Partial<CanvasElement>[]
      }
      const now = performance.now()
      if (now - (streamedAppliedAt.current.get(p.toolCallId) ?? 0) < 250) continue
      const name = p.type.slice(5)
      if (name === 'updateElement') {
        if (typeof input.id !== 'string' || typeof input.code !== 'string' || input.code.length === 0) continue
        streamedAppliedAt.current.set(p.toolCallId, now)
        actions.updateElement(input.id, { code: input.code })
      } else if (name === 'createElement') {
        if (typeof input.code !== 'string' || input.code.length === 0) continue
        // Wait until the bounds have fully streamed (code comes last in the JSON).
        if ([input.x, input.y, input.w, input.h].some((n) => typeof n !== 'number')) continue
        streamedAppliedAt.current.set(p.toolCallId, now)
        const existing = streamedCreates.current.get(p.toolCallId)
        if (existing) {
          actions.updateElement(existing, { code: input.code })
        } else {
          const created = actions.createElement({
            name: input.name ?? 'Element',
            x: input.x!,
            y: input.y!,
            w: input.w!,
            h: input.h!,
            code: input.code,
          })
          streamedCreates.current.set(p.toolCallId, created.id)
        }
      } else if (name === 'createElements' && Array.isArray(input.elements)) {
        // Batch creates stream too: each entry appears as soon as its geometry
        // and first code chunk have parsed.
        let applied = false
        input.elements.forEach((entry, index) => {
          if (!entry || typeof entry !== 'object') return
          if (typeof entry.code !== 'string' || entry.code.length === 0) return
          if ([entry.x, entry.y, entry.w, entry.h].some((n) => typeof n !== 'number')) return
          const key = `${p.toolCallId}#${index}`
          const existing = streamedCreates.current.get(key)
          if (existing) {
            actions.updateElement(existing, { code: entry.code })
          } else {
            const created = actions.createElement({
              name: entry.name ?? 'Element',
              x: entry.x!,
              y: entry.y!,
              w: entry.w!,
              h: entry.h!,
              code: entry.code,
            })
            streamedCreates.current.set(key, created.id)
          }
          applied = true
        })
        if (applied) streamedAppliedAt.current.set(p.toolCallId, now)
      }
    }
  }, [messages, status, actions])

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
      const ok = actions.deleteElement(id)
      output = ok ? { deleted: true, id, name: target?.name } : { error: 'No such element' }
    }
    addToolOutput({
      tool: 'deleteElement',
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
              {stallError || readableError(error?.message) || 'Request failed.'}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-3">
        <PromptInput
          accept={imageInputsEnabled ? 'image/*' : 'application/x-loora-disabled'}
          onSubmit={async ({ text, files }) => {
            const trimmed = text.trim()
            if (!trimmed || !chatReady || status === 'streaming' || status === 'submitted') return
            setInput('')
            setStallError(null)
            recoveryRetries.current = 0
            forceCanvasAction.current = false
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
            const snapshot = imageInputsEnabled ? await snapshotCanvas(shapesRef.current) : null
            sendMessage({
              text: trimmed,
              files: imageInputsEnabled
                ? [
                    ...files,
                    ...(snapshot
                      ? [{ type: 'file' as const, mediaType: 'image/png', url: snapshot }]
                      : []),
                  ]
                : [],
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


// Non-OK API responses reach useChat as their raw JSON body, e.g. '{"error":"…"}'.
function readableError(message?: string) {
  if (!message) return null
  try {
    const parsed = JSON.parse(message)
    if (typeof parsed?.error === 'string') return parsed.error
  } catch {
    // not JSON — show as-is
  }
  return message
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
        {MODELS.map(({ id, label, provider }) => (
          <DropdownMenuItem key={id} onSelect={() => onModelChange(id)}>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-xs text-muted-foreground">{PROVIDERS[provider].label}</span>
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
  createElement: { icon: PlusIcon, label: 'Create' },
  createElements: { icon: PlusIcon, label: 'Create' },
  updateElement: { icon: PenLineIcon, label: 'Update' },
  deleteElement: { icon: Trash2Icon, label: 'Delete' },
  readElement: { icon: BookOpenIcon, label: 'Read' },
  loadSkill: { icon: BookOpenIcon, label: 'Skill' },
  viewCanvas: { icon: EyeIcon, label: 'Verify' },
} as const

function describeElement(s: Partial<CanvasElement> | undefined) {
  if (!s) return ''
  const size = s.w != null && s.h != null ? ` · ${s.w}×${s.h}` : ''
  return `${s.name ?? 'element'}${size}`
}

function codeSize(input: Record<string, unknown>) {
  return typeof input.code === 'string'
    ? ` · ${Math.max(1, Math.round((input.code as string).length / 1024))}KB`
    : ''
}

function toolSummary(name: string, part: ToolPart, elements: CanvasElement[]) {
  const input = part.input ?? {}
  if (name === 'createElement') {
    return `${describeElement(input as Partial<CanvasElement>)}${codeSize(input)}`
  }
  if (name === 'createElements') {
    const batch = (input.elements as Partial<CanvasElement>[] | undefined) ?? []
    return `${batch.length} elements`
  }
  const target = elements.find((s) => s.id === input.id)
  if (name === 'readElement') {
    return describeElement(target) || String(input.id ?? '')
  }
  if (name === 'updateElement') {
    const changed = Object.keys(input)
      .filter((k) => k !== 'id')
      .join(', ')
    return `${describeElement(target) || String(input.id ?? '')} · ${changed}`
  }
  if (name === 'deleteElement') {
    // after deletion the element is gone from state; fall back to the tool output
    return describeElement(target ?? (part.output as Partial<CanvasElement>)) || String(input.id ?? '')
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
  createElement: 'Created',
  createElements: 'Created',
  updateElement: 'Updated',
  deleteElement: 'Deleted',
  readElement: 'Read',
  loadSkill: 'Loaded skill',
  viewCanvas: 'Verified',
} as const

function ToolGroup({
  parts,
  shapesRef,
  onResolveDelete,
}: {
  parts: ToolPart[]
  shapesRef: React.RefObject<CanvasElement[]>
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
      name === 'createElements' ? ((p.input?.elements as unknown[] | undefined)?.length ?? 1) : 1
    if (verb) counts.set(verb, (counts.get(verb) ?? 0) + weight)
  }
  const summary = [...counts.entries()].map(([verb, n]) => `${verb} ${n}`).join(' · ')
  const busy = parts.some(
    (p) => p.state === 'input-streaming' || (p.state === 'input-available' && p.type !== 'tool-deleteElement'),
  )
  const failed = parts.some((p) => p.state === 'output-error' || (p.output as { error?: string })?.error)
  const pendingDeletes = parts.filter(
    (p) => p.type === 'tool-deleteElement' && p.state === 'input-available',
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
  shapesRef: React.RefObject<CanvasElement[]>
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const targets = parts.map((p) => ({
    part: p,
    label:
      describeElement(shapesRef.current.find((s) => s.id === p.input?.id)) ||
      String(p.input?.id ?? ''),
  }))
  const visible = showAll ? targets : targets.slice(0, 3)
  const resolveAll = (allow: boolean) => {
    for (const p of parts) onResolveDelete(p.toolCallId, allow, String(p.input?.id ?? ''))
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2.5">
      <p className="text-xs font-medium">Delete {parts.length} elements?</p>
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
  shapesRef: React.RefObject<CanvasElement[]>
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
}) {
  const target = shapesRef.current.find((s) => s.id === part.input?.id)
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        Delete {describeElement(target) || 'this element'}?
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
  shapesRef: React.RefObject<CanvasElement[]>
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
  hideConfirm?: boolean
}) {
  const name = part.type.slice(5)
  const meta = TOOL_META[name as keyof typeof TOOL_META]
  if (!meta) return null

  const denied = (part.output as { deleted?: boolean; reason?: string } | undefined)?.reason
  const failed = part.state === 'output-error' || Boolean((part.output as { error?: string })?.error)
  const awaitingConfirm = name === 'deleteElement' && part.state === 'input-available'
  const done = part.state === 'output-available'
  const reduceMotion = useReducedMotion()
  const enter = interruptIn(reduceMotion)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs">
        <meta.icon
          className={cn(
            'size-3.5 shrink-0',
            name === 'deleteElement' ? 'text-destructive-foreground/70' : 'text-muted-foreground',
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
