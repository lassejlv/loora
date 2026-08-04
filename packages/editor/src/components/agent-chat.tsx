import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  getToolOrDynamicToolName,
  isDynamicToolUIPart,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type DynamicToolUIPart,
  type UIMessage,
  type ToolUIPart,
} from 'ai'
import {
  assistantToolLabel,
  CHATGPT_LOGIN_COMMAND,
  CHATGPT_LOGOUT_COMMAND,
} from '@loora/assistant/protocol'
import { apiUrl } from '@loora/platform'
import { orpc } from '@loora/rpc/client'
import {
  BotIcon,
  LogOutIcon,
  PlusIcon,
  SendIcon,
  ShieldKeyIcon,
  SquareIcon,
  XIcon,
} from '@loora/ui/icons'
import { Kbd } from '@loora/ui/kbd'
import { cn } from '@loora/ui/utils'

/**
 * The agent chat.
 *
 * One input, floating over the canvas. There is no transcript on purpose: the
 * work shows up as it happens on the canvas itself — the agent-activity ring
 * and badge that already exist for MCP light up for this agent too, because it
 * goes down the same executor and publishes the same realtime events. What is
 * left here is the one line the agent needs to be able to say back, the tool it
 * is on right now, and a confirmation when it wants to delete something.
 */

const THREAD_COMMAND = '/new'

interface AgentChatStatus {
  /** Whether this account is inside the in-app-agent feature flag. */
  enabled: boolean
  configured: boolean
  connection: { email: string | null; planType: string | null } | null
  model: string
}

interface SlashCommand {
  name: string
  description: string
  icon: typeof BotIcon
  /** Hidden when it would do nothing — no point offering a disconnect twice. */
  when?: (status: AgentChatStatus | null) => boolean
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: CHATGPT_LOGIN_COMMAND,
    description: 'Connect your ChatGPT account',
    icon: ShieldKeyIcon,
  },
  {
    name: CHATGPT_LOGOUT_COMMAND,
    description: 'Disconnect it',
    icon: LogOutIcon,
    when: (status) => Boolean(status?.connection),
  },
  {
    name: THREAD_COMMAND,
    description: 'Start a new thread',
    icon: PlusIcon,
  },
]

/**
 * One status read per page, shared by every mount. The editor asks this before
 * it draws the agent button, so it must not cost a request each time a panel
 * rerenders.
 */
let availability: Promise<AgentChatStatus | null> | undefined

function readAvailability() {
  return (availability ??= orpc.assistant
    .status()
    .then((status) => status as AgentChatStatus)
    .catch(() => {
      availability = undefined
      return null
    }))
}

/** Cleared after connecting or disconnecting, so the box catches up at once. */
export function resetAgentAvailability() {
  availability = undefined
}

/**
 * Whether to offer the agent at all. False until the flag says otherwise, so an
 * account outside it never sees a button that would only refuse.
 */
export function useAgentAvailable() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    void readAvailability().then((status) => {
      if (!cancelled) setEnabled(Boolean(status?.enabled))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return enabled
}

type AnyToolPart = ToolUIPart | DynamicToolUIPart

function toolPart(part: UIMessage['parts'][number]): AnyToolPart | null {
  if (isToolUIPart(part)) return part
  if (isDynamicToolUIPart(part)) return part
  return null
}

/** The tool call in flight, if any — the thing worth naming above the input. */
function activeToolPart(messages: UIMessage[]): AnyToolPart | null {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return null
  for (let index = last.parts.length - 1; index >= 0; index -= 1) {
    const part = toolPart(last.parts[index])
    if (!part) continue
    if (part.state === 'input-streaming' || part.state === 'input-available') {
      return part
    }
    // A settled call means whatever came before it settled too.
    if (part.state === 'output-available' || part.state === 'output-error') {
      return null
    }
  }
  return null
}

function pendingApproval(messages: UIMessage[]) {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return null
  for (const raw of last.parts) {
    const part = toolPart(raw)
    if (part?.state === 'approval-requested') {
      return { part, approvalId: part.approval.id }
    }
  }
  return null
}

/** The last thing the agent said in words, which is all this box shows of it. */
function lastAssistantText(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') return null
    if (message.role !== 'assistant') continue
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text: string }).text)
      .join('')
      .trim()
    if (text) return text
  }
  return null
}

/**
 * The endpoint answers a refused run with `{ error, code }`; the AI SDK hands
 * that body over as the error message. Reading it back beats showing somebody
 * a JSON blob.
 */
function readableError(error: Error | undefined) {
  if (!error) return null
  try {
    const parsed = JSON.parse(error.message) as { error?: string }
    if (parsed?.error) return parsed.error
  } catch {
    // Not one of ours — the message is already the best we have.
  }
  return error.message || 'The agent could not finish this run.'
}

function needsConnection(error: Error | undefined) {
  if (!error) return false
  try {
    const parsed = JSON.parse(error.message) as { code?: string }
    return (
      parsed?.code === 'CHATGPT_NOT_CONNECTED' ||
      parsed?.code === 'CHATGPT_RECONNECT_REQUIRED'
    )
  } catch {
    return false
  }
}

export function AgentChat({
  designId,
  draftId,
  open,
  onOpenChange,
  selection,
}: {
  designId: string
  draftId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Node ids selected right now, so "make this bigger" resolves. */
  selection?: string[]
}) {
  const [status, setStatus] = useState<AgentChatStatus | null>(null)
  const [thread, setThread] = useState<{
    id: string
    messages: UIMessage[]
  } | null>(null)
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const selectionRef = useRef<string[] | undefined>(selection)
  selectionRef.current = selection

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const [found, conversation] = await Promise.all([
        readAvailability(),
        orpc.assistant
          .thread({ designId, draftId })
          .catch(() => null),
      ])
      if (cancelled) return
      if (found) setStatus(found)
      setThread(
        conversation
          ? {
              id: conversation.threadId,
              messages: conversation.messages as unknown as UIMessage[],
            }
          : { id: `${designId}:${draftId ?? 'main'}`, messages: [] },
      )
    })()
    return () => {
      cancelled = true
    }
  }, [designId, draftId, open])

  if (!open || !thread) {
    return open ? <AgentChatSkeleton /> : null
  }

  return (
    <AgentChatBox
      key={thread.id}
      threadId={thread.id}
      initialMessages={thread.messages}
      designId={designId}
      draftId={draftId}
      status={status}
      input={input}
      onInputChange={setInput}
      notice={notice}
      onNotice={setNotice}
      inputRef={inputRef}
      selectionRef={selectionRef}
      onClose={() => onOpenChange(false)}
      onNewThread={async () => {
        const next = await orpc.assistant
          .newThread({ designId, draftId })
          .catch(() => null)
        if (next) setThread({ id: next.threadId, messages: [] })
      }}
      onStatusChange={setStatus}
    />
  )
}

function AgentChatShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    // Clears the tool strip below it (`bottom-3`, ~2rem tall) rather than
    // landing on top of it.
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-4">
      <div
        className={cn(
          'cx-agent-box pointer-events-auto w-full max-w-xl overflow-hidden rounded-lg',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

function AgentChatSkeleton() {
  return (
    <AgentChatShell>
      <div className="flex h-11 items-center gap-2 px-3">
        <BotIcon size={14} className="shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Opening the agent…</span>
      </div>
    </AgentChatShell>
  )
}

function AgentChatBox({
  threadId,
  initialMessages,
  designId,
  draftId,
  status,
  input,
  onInputChange,
  notice,
  onNotice,
  inputRef,
  selectionRef,
  onClose,
  onNewThread,
  onStatusChange,
}: {
  threadId: string
  initialMessages: UIMessage[]
  designId: string
  draftId: string | null
  status: AgentChatStatus | null
  input: string
  onInputChange: (value: string) => void
  notice: string | null
  onNotice: (value: string | null) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  selectionRef: React.RefObject<string[] | undefined>
  onClose: () => void
  onNewThread: () => Promise<void>
  onStatusChange: (status: AgentChatStatus) => void
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: apiUrl('/api/assistant/chat'),
        credentials: 'include',
        body: () => ({
          designId,
          draftId,
          selection: selectionRef.current,
        }),
      }),
    [designId, draftId, selectionRef],
  )

  const chat = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    // A delete resumes on its own the moment the person approves it.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })

  const [highlighted, setHighlighted] = useState(0)
  // Escape closes the menu before it closes the box, so a mistyped slash costs
  // one key rather than the whole conversation.
  const [menuDismissed, setMenuDismissed] = useState(false)

  const running = chat.status === 'submitted' || chat.status === 'streaming'
  const tool = activeToolPart(chat.messages)
  const approval = pendingApproval(chat.messages)
  const answer = lastAssistantText(chat.messages)
  const error = readableError(chat.error)
  const connected = Boolean(status?.connection)

  const connect = useCallback(() => {
    window.history.pushState({}, '', '/app/integrations?integration=chatgpt')
    window.dispatchEvent(new Event('popstate'))
  }, [])

  useLayoutEffect(() => {
    inputRef.current?.focus()
  }, [inputRef])

  // Grows with what is typed, up to a point, then scrolls.
  useLayoutEffect(() => {
    const field = inputRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`
  }, [input, inputRef])

  const runCommand = useCallback(
    async (command: string) => {
      if (command === CHATGPT_LOGIN_COMMAND) {
        // The browser leaves and comes back with `?chatgpt=connected`; the
        // cached status would be stale by then.
        resetAgentAvailability()
        connect()
        return true
      }
      if (command === CHATGPT_LOGOUT_COMMAND) {
        await fetch(apiUrl('/api/chatgpt/logout'), {
          method: 'POST',
          credentials: 'include',
        }).catch(() => null)
        resetAgentAvailability()
        const next = await readAvailability()
        if (next) onStatusChange(next)
        onNotice('ChatGPT disconnected.')
        return true
      }
      if (command === THREAD_COMMAND) {
        await onNewThread()
        onNotice(null)
        return true
      }
      return false
    },
    [connect, onNewThread, onNotice, onStatusChange],
  )

  /** Run a command the menu picked, rather than whatever is half-typed. */
  const choose = useCallback(
    async (name: string) => {
      onInputChange('')
      setMenuDismissed(false)
      setHighlighted(0)
      await runCommand(name)
      inputRef.current?.focus()
    },
    [inputRef, onInputChange, runCommand],
  )

  const submit = useCallback(async () => {
    const text = input.trim()
    if (!text || running) return
    if (text.startsWith('/')) {
      const handled = await runCommand(text)
      if (handled) {
        onInputChange('')
        return
      }
      // A slash that matches nothing is a typo, not a design instruction.
      onNotice(`Unknown command ${text}. Type / to see what there is.`)
      return
    }
    if (!connected) {
      onNotice(
        `Connect ChatGPT first — type ${CHATGPT_LOGIN_COMMAND} and press Enter.`,
      )
      return
    }
    onNotice(null)
    onInputChange('')
    void chat.sendMessage({ text })
  }, [chat, connected, input, onInputChange, onNotice, runCommand, running])

  const query = input.trim()
  const matches =
    query.startsWith('/') && !menuDismissed
      ? SLASH_COMMANDS.filter(
          (command) =>
            (command.when?.(status) ?? true) && command.name.startsWith(query),
        )
      : []
  const active = matches[Math.min(highlighted, matches.length - 1)]

  const line = approval
    ? null
    : running
      ? (tool ? assistantToolLabel(getToolOrDynamicToolName(tool)) : 'Thinking') + '…'
      : (notice ?? error ?? answer)

  return (
    <AgentChatShell>
      {approval ? (
        <div className="flex items-start gap-2 border-b border-line/70 px-3 py-2">
          <BotIcon size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-foreground">
              Delete{' '}
              {approvalCount(approval.part)} on the canvas?
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                type="button"
                className="rounded-sm bg-foreground px-2 py-0.5 text-2xs font-medium text-background hover:opacity-90"
                onClick={() =>
                  void chat.addToolApprovalResponse({
                    id: approval.approvalId,
                    approved: true,
                  })
                }
              >
                Delete
              </button>
              <button
                type="button"
                className="rounded-sm px-2 py-0.5 text-2xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                onClick={() =>
                  void chat.addToolApprovalResponse({
                    id: approval.approvalId,
                    approved: false,
                    reason: 'The person declined the deletion.',
                  })
                }
              >
                Keep them
              </button>
            </div>
          </div>
        </div>
      ) : line ? (
        <div className="flex items-start gap-2 border-b border-line/70 px-3 py-2">
          <BotIcon
            size={13}
            className={cn(
              'mt-0.5 shrink-0',
              error ? 'text-destructive-foreground' : 'text-muted-foreground',
            )}
          />
          <p
            className={cn(
              'max-h-32 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap text-xs',
              running
                ? 'cx-shimmer'
                : error
                  ? 'text-destructive-foreground'
                  : 'text-foreground',
            )}
          >
            {line}
          </p>
        </div>
      ) : null}

      {matches.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Commands"
          className="max-h-56 overflow-y-auto border-b border-line/70 p-1"
        >
          {matches.map((command, index) => {
            const Icon = command.icon
            const selected = command.name === active?.name
            return (
              <li key={command.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  // The textarea keeps focus so typing never stops; the mouse
                  // only moves the highlight the keyboard is already driving.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => void choose(command.name)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start',
                    selected ? 'bg-foreground/8' : 'hover:bg-foreground/5',
                  )}
                >
                  <Icon
                    size={13}
                    className={cn(
                      'shrink-0',
                      selected ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  />
                  <span className="font-mono text-xs text-foreground">
                    {command.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                    {command.description}
                  </span>
                  {selected ? (
                    <Kbd className="h-4 min-w-4 bg-transparent text-2xs">↵</Kbd>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="flex items-end gap-1.5 px-2.5 py-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          spellCheck={false}
          aria-label="Ask the agent"
          placeholder={
            connected
              ? 'Ask the agent to design something…'
              : `Type ${CHATGPT_LOGIN_COMMAND} to connect ChatGPT`
          }
          className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            onInputChange(event.target.value)
            setMenuDismissed(false)
            setHighlighted(0)
          }}
          onKeyDown={(event) => {
            const open = matches.length > 0
            if (event.key === 'Escape') {
              event.preventDefault()
              // The menu first, the box second.
              if (open) setMenuDismissed(true)
              else onClose()
              return
            }
            if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : matches.length - 1
              setHighlighted((current) =>
                (Math.min(current, matches.length - 1) + step) % matches.length,
              )
              return
            }
            if (open && event.key === 'Tab' && active) {
              // Completes without running, for anybody who wants to look first.
              event.preventDefault()
              onInputChange(active.name)
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (open && active) void choose(active.name)
              else void submit()
            }
          }}
        />
        {running ? (
          <button
            type="button"
            aria-label="Stop the agent"
            className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            onClick={() => chat.stop()}
          >
            <SquareIcon size={12} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!input.trim()}
            className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
            onClick={() => void submit()}
          >
            <SendIcon size={13} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close the agent"
          className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onClose}
        >
          <XIcon size={13} />
        </button>
      </div>

      {needsConnection(chat.error) ? (
        <div className="border-t border-line/70 px-3 py-1.5">
          <button
            type="button"
            className="text-2xs text-foreground underline underline-offset-2"
            onClick={connect}
          >
            Connect ChatGPT
          </button>
        </div>
      ) : null}
    </AgentChatShell>
  )
}

/** "3 layers" reads better than the raw argument object. */
function approvalCount(part: AnyToolPart) {
  const input = part.input as { nodeIds?: unknown } | undefined
  const count = Array.isArray(input?.nodeIds) ? input.nodeIds.length : 0
  if (count === 0) return 'these layers'
  return `${count} layer${count === 1 ? '' : 's'}`
}
