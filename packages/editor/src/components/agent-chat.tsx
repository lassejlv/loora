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
import { apiUrl, appUrl, openExternal } from '@loora/platform'
import { orpc } from '@loora/rpc/client'
import { BotIcon, SendIcon, SquareIcon, XIcon } from '@loora/ui/icons'
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
  configured: boolean
  connection: { email: string | null; planType: string | null } | null
  model: string
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
        orpc.assistant.status().catch(() => null),
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

  const running = chat.status === 'submitted' || chat.status === 'streaming'
  const tool = activeToolPart(chat.messages)
  const approval = pendingApproval(chat.messages)
  const answer = lastAssistantText(chat.messages)
  const error = readableError(chat.error)
  const connected = Boolean(status?.connection)

  const connect = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}`
    openExternal(
      appUrl(`/api/chatgpt/connect?returnTo=${encodeURIComponent(returnTo)}`),
    )
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
        connect()
        return true
      }
      if (command === CHATGPT_LOGOUT_COMMAND) {
        await orpc.assistant.disconnect().catch(() => null)
        const next = await orpc.assistant.status().catch(() => null)
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

  const submit = useCallback(async () => {
    const text = input.trim()
    if (!text || running) return
    if (text.startsWith('/')) {
      const handled = await runCommand(text)
      if (handled) {
        onInputChange('')
        return
      }
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

  const commandHint = input.startsWith('/')
    ? [CHATGPT_LOGIN_COMMAND, CHATGPT_LOGOUT_COMMAND, THREAD_COMMAND].filter(
        (command) => command.startsWith(input.trim()),
      )
    : []

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

      {commandHint.length > 0 ? (
        <ul className="border-b border-line/70 px-3 py-1.5">
          {commandHint.map((command) => (
            <li key={command} className="text-2xs text-muted-foreground">
              <span className="font-mono text-foreground">{command}</span>
              {command === CHATGPT_LOGIN_COMMAND
                ? ' — connect your ChatGPT account'
                : command === CHATGPT_LOGOUT_COMMAND
                  ? ' — disconnect it'
                  : ' — start a new thread'}
            </li>
          ))}
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
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
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
