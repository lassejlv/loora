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
  CHATGPT_MODELS,
  CHATGPT_REASONING_EFFORTS,
  chatGptModel,
  chatGptReasoningEffort,
  CHATGPT_LOGIN_COMMAND,
  CHATGPT_LOGOUT_COMMAND,
  DEFAULT_CHATGPT_MODEL,
  DEFAULT_CHATGPT_REASONING_EFFORT,
  type ChatGptModel,
  type ChatGptReasoningEffort,
} from '@loora/assistant/protocol'
import { apiUrl } from '@loora/platform'
import { orpc } from '@loora/rpc/client'
import {
  BotIcon,
  CheckIcon,
  ComponentIcon,
  FrameIcon,
  LogOutIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  ShapesIcon,
  ShieldKeyIcon,
  SquareIcon,
  TypeIcon,
  XIcon,
} from '@loora/ui/icons'
import { Kbd } from '@loora/ui/kbd'
import { cn } from '@loora/ui/utils'

/**
 * The agent chat.
 *
 * One input, floating over the canvas. The resting box keeps only the latest
 * response visible; hovering or focusing it reveals the earlier conversation
 * without permanently covering the work being changed underneath.
 */

const THREAD_COMMAND = '/new'
const MODEL_COMMAND = '/model'
const EFFORT_COMMAND = '/effort'

interface AgentChatStatus {
  /** Whether this account may use the admin-only in-app agent. */
  enabled: boolean
  configured: boolean
  connection: { email: string | null; planType: string | null } | null
  model: string
}

interface AgentChatOffset {
  x: number
  y: number
}

/** A layer the input can name with @ — enough to list, pick, and resolve it. */
export interface AgentMentionNode {
  id: string
  name: string
  type: string
  /**
   * Ancestry above this node, e.g. `Home / Hero`. Built so two layers with the
   * same name stay distinguishable without dumping the whole tree.
   */
  path?: string
}

function mentionIcon(type: string) {
  if (type === 'text') return TypeIcon
  if (type === 'component' || type === 'instance') return ComponentIcon
  if (type === 'vector') return ShapesIcon
  return FrameIcon
}

/** The `@token` being typed at the end of the input, if any. */
const MENTION_TOKEN = /(^|\s)@([^\s@]*)$/

interface SlashCommand {
  name: string
  /** Human label — what the row leads with. */
  description: string
  icon: typeof BotIcon
  /** The choice in effect right now — a checkmark, not a word. */
  current?: boolean
  /** Hidden when it would do nothing — no point offering a disconnect twice. */
  when?: (status: AgentChatStatus | null) => boolean
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: CHATGPT_LOGIN_COMMAND,
    description: 'Connect ChatGPT',
    icon: ShieldKeyIcon,
  },
  {
    name: CHATGPT_LOGOUT_COMMAND,
    description: 'Disconnect ChatGPT',
    icon: LogOutIcon,
    when: (status) => Boolean(status?.connection),
  },
  {
    name: MODEL_COMMAND,
    description: 'Choose model',
    icon: BotIcon,
  },
  {
    name: EFFORT_COMMAND,
    description: 'Reasoning effort',
    icon: SettingsIcon,
  },
  {
    name: THREAD_COMMAND,
    description: 'New thread',
    icon: PlusIcon,
  },
]

/** Exact → prefix → earlier substring. Equal scores keep document order. */
function rankMentionNodes(nodes: AgentMentionNode[], query: string) {
  const needle = query.toLowerCase()
  const scored = nodes
    .map((node, index) => {
      const name = node.name.toLowerCase()
      let score = 0
      if (!needle) score = 1
      else if (name === needle) score = 300
      else if (name.startsWith(needle)) score = 200
      else {
        const at = name.indexOf(needle)
        if (at < 0) return null
        // Earlier matches rank above later ones; still below any prefix hit.
        score = 100 - Math.min(at, 99)
      }
      return { node, score, index }
    })
    .filter(
      (
        entry,
      ): entry is { node: AgentMentionNode; score: number; index: number } =>
        entry !== null,
    )
  scored.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  )
  return scored.slice(0, 8).map((entry) => entry.node)
}

/** True when every typed token starts a word in the label or command name. */
function softMatchesSlash(haystack: string, raw: string) {
  const tokens = raw.split(/\s+/).filter((token) => token.length >= 2)
  if (tokens.length === 0) return false
  const parts = haystack.toLowerCase().split(/[\s/_-]+/).filter(Boolean)
  return tokens.every((token) =>
    parts.some((part) => part.startsWith(token)),
  )
}

/**
 * Prefix match first; then soft match on the human label and name tokens so
 * typing `connect` or `/model sol` still finds the right row without also
 * hitting `Disconnect`.
 */
function matchesSlashCommand(command: SlashCommand, query: string) {
  if (command.name.startsWith(query)) return true
  const raw = query.slice(1).toLowerCase()
  if (raw.length < 2) return false
  return (
    softMatchesSlash(command.description, raw) ||
    softMatchesSlash(command.name, raw)
  )
}

/** Drop the first `@name` (and a trailing space if present) from the draft. */
function stripMentionToken(text: string, name: string) {
  const token = `@${name}`
  const withSpace = `${token} `
  const next = text.includes(withSpace)
    ? text.replace(withSpace, '')
    : text.replace(token, '')
  return next.replace(/ {2,}/g, ' ')
}

/** Wrap the first case-insensitive match so the row can light the typed chars. */
function highlightMatch(text: string, query: string) {
  if (!query) return text
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text
  return (
    <>
      <span className="text-muted-foreground">{text.slice(0, index)}</span>
      <span className="font-medium text-foreground">
        {text.slice(index, index + query.length)}
      </span>
      <span className="text-muted-foreground">
        {text.slice(index + query.length)}
      </span>
    </>
  )
}

/** Split the draft so resolved @names can render as chips over the textarea. */
function mentionSegments(
  text: string,
  mentions: { id: string; name: string }[],
) {
  if (!text || mentions.length === 0) {
    return [{ kind: 'text' as const, value: text }]
  }
  const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length)
  const segments: Array<
    | { kind: 'text'; value: string }
    | { kind: 'mention'; value: string; id: string }
  > = []
  let cursor = 0
  while (cursor < text.length) {
    let best: { index: number; mention: { id: string; name: string } } | null = null
    for (const mention of ordered) {
      const token = `@${mention.name}`
      const index = text.indexOf(token, cursor)
      if (index < 0) continue
      if (
        !best ||
        index < best.index ||
        (index === best.index && mention.name.length > best.mention.name.length)
      ) {
        best = { index, mention }
      }
    }
    if (!best) {
      segments.push({ kind: 'text', value: text.slice(cursor) })
      break
    }
    if (best.index > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, best.index) })
    }
    const token = `@${best.mention.name}`
    segments.push({ kind: 'mention', value: token, id: best.mention.id })
    cursor = best.index + token.length
  }
  return segments
}

function AgentMenuFooter({ action }: { action: 'run' | 'insert' }) {
  return (
    <div className="flex items-center gap-3 border-t border-line/50 px-2.5 py-1.5 text-2xs text-muted-foreground/80">
      <span className="flex items-center gap-1">
        <Kbd className="h-4 min-w-4 bg-transparent text-2xs">↑↓</Kbd>
        navigate
      </span>
      <span className="flex items-center gap-1">
        <Kbd className="h-4 min-w-4 bg-transparent text-2xs">⇥</Kbd>
        complete
      </span>
      <span className="flex items-center gap-1">
        <Kbd className="h-4 min-w-4 bg-transparent text-2xs">↵</Kbd>
        {action}
      </span>
      <span className="ms-auto flex items-center gap-1">
        <Kbd className="h-4 min-w-4 bg-transparent text-2xs">esc</Kbd>
        close
      </span>
    </div>
  )
}

function MenuIconTile({
  selected,
  children,
}: {
  selected: boolean
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-md border transition-colors duration-75',
        selected
          ? 'border-line/80 bg-surface text-foreground shadow-sm'
          : 'border-transparent text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

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

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('')
    .trim()
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
  nodes,
}: {
  designId: string
  draftId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Node ids selected right now, so "make this bigger" resolves. */
  selection?: string[]
  /** Layers @ can offer, read when the menu opens so it never goes stale. */
  nodes?: () => AgentMentionNode[]
}) {
  const [status, setStatus] = useState<AgentChatStatus | null>(null)
  const [thread, setThread] = useState<{
    id: string
    messages: UIMessage[]
  } | null>(null)
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [offset, setOffset] = useState<AgentChatOffset>({ x: 0, y: 0 })
  const [model, setModel] = useState<ChatGptModel>(() =>
    chatGptModel(
      typeof localStorage === 'undefined' ? null : localStorage.getItem('loora:chatgpt-model'),
    ) ?? DEFAULT_CHATGPT_MODEL,
  )
  const [reasoningEffort, setReasoningEffort] = useState<ChatGptReasoningEffort>(
    () =>
      chatGptReasoningEffort(
        typeof localStorage === 'undefined'
          ? null
          : localStorage.getItem('loora:reasoning-effort'),
      ) ?? DEFAULT_CHATGPT_REASONING_EFFORT,
  )
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
    return open ? (
      <AgentChatSkeleton offset={offset} onOffsetChange={setOffset} />
    ) : null
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
      nodes={nodes}
      onClose={() => onOpenChange(false)}
      onNewThread={async () => {
        const next = await orpc.assistant
          .newThread({ designId, draftId })
          .catch(() => null)
        if (next) setThread({ id: next.threadId, messages: [] })
      }}
      onStatusChange={setStatus}
      offset={offset}
      onOffsetChange={setOffset}
      model={model}
      onModelChange={(next) => {
        setModel(next)
        localStorage.setItem('loora:chatgpt-model', next)
      }}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={(next) => {
        setReasoningEffort(next)
        localStorage.setItem('loora:reasoning-effort', next)
      }}
    />
  )
}

function AgentChatShell({
  children,
  className,
  offset,
  onOffsetChange,
  running = false,
}: {
  children: React.ReactNode
  className?: string
  offset: AgentChatOffset
  onOffsetChange: (offset: AgentChatOffset) => void
  /** Lights the scan line along the top edge while a run is in flight. */
  running?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerX: number
    pointerY: number
    offset: AgentChatOffset
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null>(null)

  const bounds = () => {
    const box = boxRef.current
    const parent = box?.parentElement?.parentElement
    if (!box || !parent) return null
    const boxRect = box.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    const inset = 8
    return {
      minX: offset.x + parentRect.left + inset - boxRect.left,
      maxX: offset.x + parentRect.right - inset - boxRect.right,
      minY: offset.y + parentRect.top + inset - boxRect.top,
      maxY: offset.y + parentRect.bottom - inset - boxRect.bottom,
    }
  }

  const clampOffset = (next: AgentChatOffset, limits = bounds()) => {
    if (!limits) return next
    return {
      x: Math.min(limits.maxX, Math.max(limits.minX, next.x)),
      y: Math.min(limits.maxY, Math.max(limits.minY, next.y)),
    }
  }

  return (
    // Clears the tool strip below it (`bottom-3`, ~2rem tall) rather than
    // landing on top of it.
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-4">
      <div
        ref={boxRef}
        data-running={running || undefined}
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
        className={cn(
          'cx-agent-box group/agent pointer-events-auto w-full max-w-xl cursor-grab overflow-hidden rounded-lg will-change-transform active:cursor-grabbing [&_button]:cursor-pointer [&_textarea]:cursor-text',
          className,
        )}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return
          const target = event.target as HTMLElement
          if (target.closest('textarea, button, a, input, select')) return
          const limits = bounds()
          if (!limits) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            offset,
            ...limits,
          }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return
          onOffsetChange(
            clampOffset(
              {
                x: drag.offset.x + event.clientX - drag.pointerX,
                y: drag.offset.y + event.clientY - drag.pointerY,
              },
              drag,
            ),
          )
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
      >
        {children}
      </div>
    </div>
  )
}

function AgentChatSkeleton({
  offset,
  onOffsetChange,
}: {
  offset: AgentChatOffset
  onOffsetChange: (offset: AgentChatOffset) => void
}) {
  return (
    <AgentChatShell offset={offset} onOffsetChange={onOffsetChange}>
      <div className="flex h-11 items-center px-3">
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
  nodes,
  onClose,
  onNewThread,
  onStatusChange,
  offset,
  onOffsetChange,
  model,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
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
  nodes?: () => AgentMentionNode[]
  onClose: () => void
  onNewThread: () => Promise<void>
  onStatusChange: (status: AgentChatStatus) => void
  offset: AgentChatOffset
  onOffsetChange: (offset: AgentChatOffset) => void
  model: ChatGptModel
  onModelChange: (model: ChatGptModel) => void
  reasoningEffort: ChatGptReasoningEffort
  onReasoningEffortChange: (effort: ChatGptReasoningEffort) => void
}) {
  // What @-picks have been made this draft; only the ones whose @name still
  // appears in the text travel with the send. State so the chip overlay redraws.
  const [draftMentions, setDraftMentions] = useState<
    { id: string; name: string; type: string }[]
  >([])
  const sentMentionsRef = useRef<{ id: string; name: string }[]>([])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: apiUrl('/api/assistant/chat'),
        credentials: 'include',
        body: () => ({
          designId,
          draftId,
          selection: selectionRef.current,
          mentions: sentMentionsRef.current,
          model,
          reasoningEffort,
        }),
      }),
    [designId, draftId, model, reasoningEffort, selectionRef],
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
  const conversation = chat.messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: messageText(message),
    }))
    .filter((message) => message.text)
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
      if (command === MODEL_COMMAND) {
        onInputChange(`${MODEL_COMMAND} `)
        return true
      }
      if (command.startsWith(`${MODEL_COMMAND} `)) {
        const next = chatGptModel(command.slice(MODEL_COMMAND.length + 1))
        if (!next) return false
        onModelChange(next)
        onNotice(`Model set to ${CHATGPT_MODELS.find((item) => item.id === next)?.label}.`)
        return true
      }
      if (command === EFFORT_COMMAND) {
        onInputChange(`${EFFORT_COMMAND} `)
        return true
      }
      if (command.startsWith(`${EFFORT_COMMAND} `)) {
        const next = chatGptReasoningEffort(command.slice(EFFORT_COMMAND.length + 1))
        if (!next) return false
        onReasoningEffortChange(next)
        onNotice(
          `Reasoning effort set to ${CHATGPT_REASONING_EFFORTS.find((item) => item.id === next)?.label}.`,
        )
        return true
      }
      if (command === THREAD_COMMAND) {
        await onNewThread()
        onNotice(null)
        return true
      }
      return false
    },
    [
      connect,
      onModelChange,
      onNewThread,
      onNotice,
      onReasoningEffortChange,
      onStatusChange,
    ],
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
    // Only mentions still named in the text count; a deleted @name is retracted.
    sentMentionsRef.current = draftMentions
      .filter((mention) => text.includes(`@${mention.name}`))
      .map(({ id, name }) => ({ id, name }))
    setDraftMentions([])
    void chat.sendMessage({ text })
  }, [chat, connected, draftMentions, input, onInputChange, onNotice, runCommand, running])

  // Keep the trailing space: `/model` is the parent command, while `/model `
  // opens its choices.
  const query = input.trimStart()
  const modelCommands: SlashCommand[] = CHATGPT_MODELS.map((item) => ({
    name: `${MODEL_COMMAND} ${item.id}`,
    description: item.label,
    icon: BotIcon,
    current: item.id === model,
  }))
  const effortCommands: SlashCommand[] = CHATGPT_REASONING_EFFORTS.map((item) => ({
    name: `${EFFORT_COMMAND} ${item.id}`,
    description: item.label,
    icon: SettingsIcon,
    current: item.id === reasoningEffort,
  }))
  const [commandPool, menuLabel] = query.startsWith(`${MODEL_COMMAND} `)
    ? ([modelCommands, 'Models'] as const)
    : query.startsWith(`${EFFORT_COMMAND} `)
      ? ([effortCommands, 'Reasoning effort'] as const)
      : ([SLASH_COMMANDS, 'Commands'] as const)
  const slashOpen = query.startsWith('/') && !menuDismissed
  const matches = slashOpen
    ? commandPool.filter(
        (command) =>
          (command.when?.(status) ?? true) && matchesSlashCommand(command, query),
      )
    : []
  const active = matches[Math.min(highlighted, matches.length - 1)]

  // An @token at the end of what is typed offers the document's layers.
  const mentionToken =
    !slashOpen && !menuDismissed && nodes ? MENTION_TOKEN.exec(input) : null
  const mentionQuery = mentionToken?.[2] ?? ''
  const mentionOpen = Boolean(mentionToken)
  const mentionMatches =
    mentionOpen && nodes
      ? rankMentionNodes(nodes(), mentionQuery)
      : []
  const activeMention =
    mentionMatches[Math.min(highlighted, mentionMatches.length - 1)]

  // Drop picks whose @name the person already deleted or half-edited away.
  useEffect(() => {
    setDraftMentions((current) => {
      const next = current.filter((mention) => input.includes(`@${mention.name}`))
      return next.length === current.length ? current : next
    })
  }, [input])

  const chooseMention = useCallback(
    (node: AgentMentionNode) => {
      onInputChange(input.replace(/@[^\s@]*$/, `@${node.name} `))
      setDraftMentions((current) => [
        ...current.filter((mention) => mention.id !== node.id),
        { id: node.id, name: node.name, type: node.type },
      ])
      setMenuDismissed(false)
      setHighlighted(0)
      inputRef.current?.focus()
    },
    [input, inputRef, onInputChange],
  )

  const removeMention = useCallback(
    (id: string) => {
      const target = draftMentions.find((mention) => mention.id === id)
      if (!target) return
      onInputChange(stripMentionToken(input, target.name))
      setDraftMentions((current) => current.filter((mention) => mention.id !== id))
      inputRef.current?.focus()
    },
    [draftMentions, input, inputRef, onInputChange],
  )

  const segments = mentionSegments(input, draftMentions)

  const line = approval
    ? null
    : running
      ? (tool ? assistantToolLabel(getToolOrDynamicToolName(tool)) : 'Thinking') + '…'
      : (notice ?? error ?? answer)
  const history = line === answer && conversation.at(-1)?.role === 'assistant'
    ? conversation.slice(0, -1)
    : conversation

  return (
    <AgentChatShell offset={offset} onOffsetChange={onOffsetChange} running={running}>
      {history.length > 0 ? (
        <div className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-out group-hover/agent:grid-rows-[1fr] group-hover/agent:opacity-100">
          <div className="min-h-0 overflow-hidden">
            <div
              aria-label="Conversation history"
              className="max-h-56 space-y-3 overflow-y-auto border-b border-line/70 px-3 py-3 overscroll-contain"
            >
              {history.map((message) =>
                message.role === 'user' ? (
                  // What was asked sits right, in a quiet bubble; what the
                  // agent said flows left as plain text. No labels needed.
                  <div key={message.id} className="flex justify-end pl-10">
                    <p className="whitespace-pre-wrap rounded-lg rounded-br-sm bg-foreground/8 px-2.5 py-1.5 text-xs text-foreground">
                      {message.text}
                    </p>
                  </div>
                ) : (
                  <p
                    key={message.id}
                    className="whitespace-pre-wrap pr-6 text-xs text-foreground"
                  >
                    {message.text}
                  </p>
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}

      {approval ? (
        <div className="border-b border-line/70 px-3 py-2">
          <div className="min-w-0">
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
        <div className="border-b border-line/70 px-3 py-2">
          <p
            className={cn(
              'max-h-32 min-w-0 overflow-y-auto whitespace-pre-wrap text-xs',
              running
                ? 'cx-shimmer text-muted-foreground'
                : error
                  ? 'text-destructive-foreground'
                  : 'text-foreground',
            )}
          >
            {line}
          </p>
        </div>
      ) : null}

      {slashOpen ? (
        <div className="border-b border-line/70">
          <p className="px-3 pt-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {menuLabel}
          </p>
          {matches.length > 0 ? (
            <ul
              role="listbox"
              aria-label="Commands"
              className="max-h-56 overflow-y-auto p-1"
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
                        'flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-start transition-colors duration-75',
                        selected && 'bg-foreground/8',
                      )}
                    >
                      <MenuIconTile selected={selected}>
                        <Icon size={13} />
                      </MenuIconTile>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-foreground">
                          {command.description}
                        </span>
                        {/* What is typed stays bright; the rest of the command
                            is a ghost. A bare slash dims nothing. */}
                        <span className="block truncate font-mono text-2xs text-muted-foreground">
                          {command.name.startsWith(query) && query.length > 1 ? (
                            <>
                              <span className="text-foreground/80">
                                {command.name.slice(0, query.length)}
                              </span>
                              {command.name.slice(query.length)}
                            </>
                          ) : (
                            command.name
                          )}
                        </span>
                      </span>
                      {command.current ? (
                        <CheckIcon size={12} className="shrink-0 text-foreground" />
                      ) : (
                        <Kbd
                          className={cn(
                            'h-4 min-w-4 bg-transparent text-2xs transition-opacity duration-75',
                            selected ? 'opacity-100' : 'opacity-0',
                          )}
                        >
                          ↵
                        </Kbd>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              No matching command.
            </p>
          )}
          <AgentMenuFooter action="run" />
        </div>
      ) : null}

      {mentionOpen ? (
        <div className="border-b border-line/70">
          <p className="px-3 pt-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Layers
          </p>
          {mentionMatches.length > 0 ? (
            <ul
              role="listbox"
              aria-label="Layers"
              className="max-h-56 overflow-y-auto p-1"
            >
              {mentionMatches.map((node, index) => {
                const Icon = mentionIcon(node.type)
                const selected = node.id === activeMention?.id
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => chooseMention(node)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-start transition-colors duration-75',
                        selected && 'bg-foreground/8',
                      )}
                    >
                      <MenuIconTile selected={selected}>
                        <Icon size={13} />
                      </MenuIconTile>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-foreground">
                          {highlightMatch(node.name, mentionQuery)}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {node.path ? `${node.path} · ${node.type}` : node.type}
                        </span>
                      </span>
                      <Kbd
                        className={cn(
                          'h-4 min-w-4 bg-transparent text-2xs transition-opacity duration-75',
                          selected ? 'opacity-100' : 'opacity-0',
                        )}
                      >
                        ↵
                      </Kbd>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              No layers match.
            </p>
          )}
          <AgentMenuFooter action="insert" />
        </div>
      ) : null}

      {draftMentions.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b border-line/50 px-2.5 pb-1.5 pt-2">
          {draftMentions.map((mention) => {
            const Icon = mentionIcon(mention.type)
            return (
              <span
                key={mention.id}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-foreground/8 py-0.5 pl-1.5 pr-0.5 text-2xs text-foreground"
              >
                <Icon size={11} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{mention.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${mention.name}`}
                  className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => removeMention(mention.id)}
                >
                  <XIcon size={10} />
                </button>
              </span>
            )
          })}
        </div>
      ) : null}

      <div className="flex items-end gap-1.5 px-2.5 py-2">
        <div className="relative min-w-0 flex-1">
          {/* Mirror of the draft: plain text plus chips for resolved @names.
              The textarea sits on top, transparent when non-empty so chips show.
              Removable chips live in the strip above — the overlay is visual only. */}
          {input ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap break-words px-1 py-1.5 text-xs text-foreground"
            >
              {segments.map((segment, index) =>
                segment.kind === 'mention' ? (
                  <span
                    key={`${segment.id}-${index}`}
                    className="rounded-sm bg-foreground/10 px-0.5 text-foreground"
                  >
                    {segment.value}
                  </span>
                ) : (
                  <span key={index}>{segment.value}</span>
                ),
              )}
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            spellCheck={false}
            aria-label="Ask the agent"
            placeholder={
              connected
                ? 'Ask the agent…  / commands  @ layers'
                : `Type ${CHATGPT_LOGIN_COMMAND} to connect ChatGPT`
            }
            className={cn(
              'max-h-40 w-full resize-none bg-transparent px-1 py-1.5 text-xs outline-none placeholder:text-muted-foreground',
              input
                ? 'relative caret-foreground text-transparent'
                : 'text-foreground',
            )}
            onChange={(event) => {
              onInputChange(event.target.value)
              setMenuDismissed(false)
              setHighlighted(0)
            }}
            onScroll={(event) => {
              const mirror = event.currentTarget.previousElementSibling
              if (mirror instanceof HTMLElement) {
                mirror.scrollTop = event.currentTarget.scrollTop
              }
            }}
            onKeyDown={(event) => {
              const count =
                matches.length > 0
                  ? matches.length
                  : mentionMatches.length > 0
                    ? mentionMatches.length
                    : 0
              const menuActive = slashOpen || mentionOpen
              if (event.key === 'Escape') {
                event.preventDefault()
                // The menu first, the box second.
                if (menuActive) setMenuDismissed(true)
                else onClose()
                return
              }
              if (
                count > 0 &&
                (event.key === 'ArrowDown' || event.key === 'ArrowUp')
              ) {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : count - 1
                setHighlighted((current) =>
                  (Math.min(current, count - 1) + step) % count,
                )
                return
              }
              if (count > 0 && event.key === 'Tab') {
                // Completes without running, for anybody who wants to look first.
                event.preventDefault()
                if (matches.length > 0 && active) onInputChange(active.name)
                else if (activeMention) chooseMention(activeMention)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (matches.length > 0 && active) void choose(active.name)
                else if (mentionMatches.length > 0 && activeMention)
                  chooseMention(activeMention)
                else void submit()
              }
            }}
          />
        </div>
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
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-150',
              input.trim()
                ? 'bg-foreground text-background hover:opacity-90'
                : 'text-muted-foreground disabled:opacity-40',
            )}
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
