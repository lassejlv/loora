import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type FileUIPart,
  type UIMessage,
} from 'ai'
import { useChat } from '@ai-sdk/react'
import {
  ChatGPTProxyError,
  createChatGPTProxyProvider,
} from '@opencoredev/loginwithchatgpt-ai'
import {
  BookOpenIcon,
  ComponentIcon,
  MoveIcon,
  PaletteIcon,
  PaperclipIcon,
  PenLineIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  BoxesIcon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  FileTextIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from '#/components/icons'
import {
  canvasId,
  createInstanceNode,
  defaultLayout,
  defaultStyle,
  orderedChildren,
  type CanvasNode,
} from '@loora/canvas/model'
import {
  useCanvasDocument,
  useCanvasDomRegistry,
  useCanvasEngine,
  useCanvasSelection,
  useCanvasTransaction,
} from '@loora/canvas/react'
import {
  createComponentInputSchema,
  createComponentTransaction,
  createInstanceInputSchema,
  createPageInputSchema,
  createPageTransaction,
  deleteNodesInputSchema,
  insertDescriptorOperations,
  insertNodesInputSchema,
  moveNodesInputSchema,
  normalizeDeletionNodeIds,
  patchNodesInputSchema,
  patchOperationsForChanges,
  readCanvasNodeRef,
  readNodeInputSchema,
  readTreeInputSchema,
  searchCanvasNodes,
  searchNodesInputSchema,
  semanticTree,
  setTokensInputSchema,
  sourceContainerForRef,
  tokenOperations,
  viewCanvasInputSchema,
  viewNodeInputSchema,
  viewPageInputSchema,
} from '@loora/agent/canvas-v2-tools'
import {
  CHATGPT_REASONING_EFFORTS,
  DEFAULT_MODEL,
  getChatGPTReasoningEffort,
  MODELS,
  PROVIDERS,
  type ChatGPTReasoningEffort,
} from '@loora/agent/models'
import { modelSupportsImageInput } from '@loora/agent/messages'
import { sanitizeChatMessagesForStorage } from '@loora/rpc/chat-storage'
import { orpc } from '#/lib/orpc-client'
import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '#/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '#/components/ai-elements/message'
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '#/components/ai-elements/prompt-input'
import { MentionChip, MentionMenu } from '#/components/mention-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { SliderPrimitive } from '#/components/ui/slider'
import { cn } from '#/lib/utils'
import {
  activeMentionQuery,
  composerMentionItems,
  filterMentionItems,
  insertMention,
  mentionSuffix,
  parseMentionSuffix,
  segmentMentionText,
  stripMentionSuffix,
  type MentionItem,
} from '#/lib/mentions'
import {
  captureCanvasPng,
  captureNodePng,
  renderPagePng,
} from '#/lib/canvas-v2-capture'

interface CanvasAgentTarget {
  designId: string
  draftId: string | null
}

interface ChatSummary {
  id: string
  draftId?: string | null
  title: string
  updatedAt: number
}

type ChatState = ReturnType<typeof useChat>
type CustomAiProviderConnections = Awaited<ReturnType<typeof orpc.aiProvider.list>>
export type CanvasAgentClient = typeof orpc

interface PendingQuestion {
  toolCallId: string
  question: string
  options: string[]
}

interface PendingDelete {
  toolCallId: string
  nodeIds: string[]
}

const DOCUMENT_UPLOAD_ACCEPT = [
  'application/pdf',
  'application/json',
  'application/xml',
  'text/*',
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.xml',
  '.yaml',
  '.yml',
].join(',')

const TOOL_META = {
  createPage: { icon: LayersIcon, label: 'Create Page', past: 'Created Page' },
  insertNodes: { icon: PlusIcon, label: 'Insert', past: 'Inserted' },
  patchNodes: { icon: PenLineIcon, label: 'Update', past: 'Updated' },
  moveNodes: { icon: MoveIcon, label: 'Move', past: 'Moved' },
  deleteNodes: { icon: Trash2Icon, label: 'Delete', past: 'Deleted' },
  readNode: { icon: BookOpenIcon, label: 'Read', past: 'Read' },
  readTree: { icon: BookOpenIcon, label: 'Read tree', past: 'Read tree' },
  searchNodes: { icon: SearchIcon, label: 'Search', past: 'Searched' },
  createComponent: {
    icon: ComponentIcon,
    label: 'Create component',
    past: 'Created component',
  },
  createInstance: {
    icon: BoxesIcon,
    label: 'Create instance',
    past: 'Created instance',
  },
  setTokens: { icon: PaletteIcon, label: 'Set tokens', past: 'Set tokens' },
  viewNode: { icon: EyeIcon, label: 'Inspect', past: 'Inspected' },
  viewPage: { icon: EyeIcon, label: 'Inspect Page', past: 'Inspected Page' },
  viewCanvas: { icon: EyeIcon, label: 'Verify', past: 'Verified' },
  listGitHubRepositories: {
    icon: LayersIcon,
    label: 'List repositories',
    past: 'Listed repositories',
  },
  listRepositoryTree: {
    icon: LayersIcon,
    label: 'Browse repository',
    past: 'Browsed repository',
  },
  searchRepositoryCode: {
    icon: SearchIcon,
    label: 'Search repository',
    past: 'Searched repository',
  },
  readRepositoryFile: {
    icon: BookOpenIcon,
    label: 'Read repository file',
    past: 'Read repository file',
  },
  viewRepositoryImage: {
    icon: EyeIcon,
    label: 'View repository image',
    past: 'Viewed repository image',
  },
} as const

function titleFromPrompt(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, ' ')
  return title.length > 48 ? `${title.slice(0, 47)}…` : title
}

function canvasLengthValue(
  value: CanvasNode['layout']['width'],
  fallback = 0,
) {
  return value.unit === 'px' || value.unit === 'percent'
    ? Math.round(value.value)
    : fallback
}

function isThinking(status: ChatState['status'], messages: UIMessage[]) {
  if (status === 'submitted') return true
  if (status !== 'streaming') return false
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return true
  const lastPart = last.parts.at(-1)
  if (lastPart?.type === 'reasoning') return false
  return !(lastPart?.type === 'text' && lastPart.text.length > 0)
}

function AgentThinking({ label = 'Thinking' }: { label?: string }) {
  const text = `${label}…`
  return (
    <p className="w-fit text-[13px]" role="status" aria-label={text}>
      <span className="cx-agent-thinking" aria-hidden="true">
        {text}
      </span>
    </p>
  )
}

function readableError(message?: string) {
  if (!message) return null
  try {
    const parsed = JSON.parse(message)
    if (typeof parsed?.error === 'string') return parsed.error
  } catch {
    // The SDK also returns ordinary Error messages.
  }
  return message
}

async function loadMentionRemotes(
  client: CanvasAgentClient,
  designId: string,
) {
  const [assets, repositories, binding] = await Promise.all([
    client.asset.list().catch(() => [] as { id: string; name: string }[]),
    client.github
      .repositories()
      .catch(() => [] as { fullName: string }[]),
    client.github.binding({ designId }).catch(() => null),
  ])
  return {
    assets: assets.map((asset) => ({ id: asset.id, name: asset.name })),
    repositories: repositories.map((repository) => ({
      fullName: repository.fullName,
    })),
    preferredRepository: binding?.fullName ?? null,
  }
}

export function CanvasV2AgentPanel({
  target,
  readOnly,
  queuedPrompt,
  onQueuedPromptConsumed,
  onClose,
  client = orpc,
}: {
  target: CanvasAgentTarget
  readOnly: boolean
  queuedPrompt: { id: string; message: string } | null
  onQueuedPromptConsumed: () => void
  onClose: () => void
  client?: CanvasAgentClient
}) {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [runningChatIds, setRunningChatIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setChats([])
    setActiveChatId(null)
    setRunningChatIds([])
    void (async () => {
      try {
        const stored = await client.chat.list({ designId: target.designId })
        let matching = stored.filter(
          (chat) => (chat.draftId ?? null) === target.draftId,
        )
        if (cancelled) return
        if (matching.length === 0 && !readOnly) {
          const created = await client.chat.create({
            id: `chat_${crypto.randomUUID().replaceAll('-', '')}`,
            designId: target.designId,
            draftId: target.draftId,
            title: 'New chat',
          })
          matching = [created]
        }
        if (cancelled) return
        setChats(matching)
        setActiveChatId(matching[0]?.id ?? null)
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not open chat')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, readOnly, target.designId, target.draftId])

  const createChat = async () => {
    if (readOnly) return
    try {
      const created = await client.chat.create({
        id: `chat_${crypto.randomUUID().replaceAll('-', '')}`,
        designId: target.designId,
        draftId: target.draftId,
        title: 'New chat',
      })
      setChats((current) => [created, ...current])
      setActiveChatId(created.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create chat')
    }
  }

  const onTitleChange = useCallback((chatId: string, title: string) => {
    setChats((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, title } : chat)),
    )
  }, [])

  const onRunningChange = useCallback((chatId: string, running: boolean) => {
    setRunningChatIds((current) => {
      if (running) {
        return current.includes(chatId) ? current : [...current, chatId]
      }
      return current.filter((id) => id !== chatId)
    })
  }, [])

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null
  const activeBusy = Boolean(
    activeChatId && runningChatIds.includes(activeChatId),
  )
  const mountedChats = chats.filter(
    (chat) =>
      chat.id === activeChatId || runningChatIds.includes(chat.id),
  )

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-sidebar">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!activeChat}
              className="inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium leading-none outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  activeBusy
                    ? 'animate-pulse bg-foreground/60'
                    : 'bg-muted-foreground/40',
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {activeChat?.title ?? 'Loading…'}
              </span>
              <span className="shrink-0 truncate text-[10px] font-normal text-muted-foreground">
                {target.draftId ? 'branch' : 'Main'}
              </span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Chats
            </DropdownMenuLabel>
            {chats.map((chat) => (
              <DropdownMenuItem
                key={chat.id}
                onSelect={() => setActiveChatId(chat.id)}
              >
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                {runningChatIds.includes(chat.id) ? (
                  <Spinner
                    aria-label="Agent running"
                    className="size-3 text-muted-foreground"
                  />
                ) : null}
                {chat.id === activeChatId ? (
                  <CheckIcon className="size-3.5 text-foreground" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={readOnly}
              onSelect={() => void createChat()}
            >
              <PlusIcon />
              New chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon-xs" variant="ghost" aria-label="Close agent" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      {loading ? (
        <div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground">
          <Spinner aria-label="Opening chat" className="size-4" />
        </div>
      ) : error ? (
        <div className="p-3 text-xs text-destructive">{error}</div>
      ) : mountedChats.length > 0 ? (
        mountedChats.map((chat) => (
          <CanvasV2AgentSession
            key={chat.id}
            chatId={chat.id}
            initialTitle={chat.title}
            active={chat.id === activeChatId}
            target={target}
            readOnly={readOnly}
            queuedPrompt={chat.id === activeChatId ? queuedPrompt : null}
            onQueuedPromptConsumed={onQueuedPromptConsumed}
            onTitleChange={onTitleChange}
            onRunningChange={onRunningChange}
            client={client}
          />
        ))
      ) : (
        <div className="p-3 text-xs text-muted-foreground">
          This branch is read-only and has no agent chat.
        </div>
      )}
    </aside>
  )
}

export function CanvasV2AgentSession({
  chatId,
  initialTitle,
  active,
  target,
  readOnly,
  queuedPrompt,
  onQueuedPromptConsumed,
  onTitleChange,
  onRunningChange,
  client,
}: {
  chatId: string
  initialTitle: string
  active: boolean
  target: CanvasAgentTarget
  readOnly: boolean
  queuedPrompt: { id: string; message: string } | null
  onQueuedPromptConsumed: () => void
  onTitleChange: (chatId: string, title: string) => void
  onRunningChange: (chatId: string, running: boolean) => void
  client: CanvasAgentClient
}) {
  const engine = useCanvasEngine()
  const document = useCanvasDocument()
  const registry = useCanvasDomRegistry()
  const selection = useCanvasSelection()
  const transact = useCanvasTransaction()
  const documentRef = useRef(document)
  const selectionRef = useRef(selection)
  documentRef.current = document
  selectionRef.current = selection
  const [input, setInput] = useState('')
  const [caret, setCaret] = useState(0)
  const [mentionAssets, setMentionAssets] = useState<
    { id: string; name: string }[]
  >([])
  const [mentionRepositories, setMentionRepositories] = useState<
    { fullName: string }[]
  >([])
  const [preferredRepository, setPreferredRepository] = useState<string | null>(
    null,
  )
  const [trackedMentions, setTrackedMentions] = useState<MentionItem[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissedStart, setMentionDismissedStart] = useState<
    number | null
  >(null)
  const [ready, setReady] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [composerError, setComposerError] = useState<string | null>(null)
  const [model, setModel] = useState(() => {
    const stored =
      typeof localStorage === 'undefined'
        ? null
        : localStorage.getItem('loora:model')
    return stored && MODELS.some((candidate) => candidate.id === stored)
      ? stored
      : DEFAULT_MODEL
  })
  const [reasoningEffort, setReasoningEffort] =
    useState<ChatGPTReasoningEffort>(() =>
      getChatGPTReasoningEffort(
        typeof localStorage === 'undefined'
          ? undefined
          : localStorage.getItem('loora:reasoning-effort'),
      ),
    )
  const [chatGPTModels, setChatGPTModels] = useState<string[] | null>(null)
  const [loadingChatGPTModels, setLoadingChatGPTModels] = useState(false)
  const [chatGPTModelsError, setChatGPTModelsError] = useState<
    'disconnected' | 'failed' | null
  >(null)
  const [openRouterConnected, setOpenRouterConnected] = useState<
    boolean | null
  >(null)
  const [openRouterStatusError, setOpenRouterStatusError] = useState(false)
  const [customAiProviderConnections, setCustomAiProviderConnections] =
    useState<CustomAiProviderConnections | null>(null)
  const [customAiProviderStatusError, setCustomAiProviderStatusError] =
    useState(false)
  const executed = useRef(new Set<string>())
  const deliveredPrompt = useRef<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const queuedMessagesRef = useRef(queuedMessages)
  queuedMessagesRef.current = queuedMessages
  const modelRef = useRef(model)
  const reasoningEffortRef = useRef(reasoningEffort)
  modelRef.current = model
  reasoningEffortRef.current = reasoningEffort
  const usingChatGPT =
    MODELS.find((candidate) => candidate.id === model)?.provider === 'chatgpt'
  const imageInputsEnabled = modelSupportsImageInput(model)

  const changeModel = (next: string) => {
    setModel(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('loora:model', next)
    }
  }

  const changeReasoningEffort = (next: ChatGPTReasoningEffort) => {
    setReasoningEffort(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('loora:reasoning-effort', next)
    }
  }

  const loadChatGPTModels = async () => {
    if (loadingChatGPTModels) return
    setLoadingChatGPTModels(true)
    setChatGPTModelsError(null)
    try {
      const provider = createChatGPTProxyProvider()
      setChatGPTModels(await provider.listModels())
    } catch (cause) {
      setChatGPTModels([])
      setChatGPTModelsError(
        cause instanceof ChatGPTProxyError && cause.status === 401
          ? 'disconnected'
          : 'failed',
      )
    } finally {
      setLoadingChatGPTModels(false)
    }
  }

  const loadOpenRouterStatus = async () => {
    setOpenRouterStatusError(false)
    try {
      const result = await client.openrouter.status()
      setOpenRouterConnected(result.connected)
    } catch {
      setOpenRouterConnected(false)
      setOpenRouterStatusError(true)
    }
  }

  const loadCustomAiProviderStatus = async () => {
    setCustomAiProviderStatusError(false)
    try {
      setCustomAiProviderConnections(await client.aiProvider.list())
    } catch {
      setCustomAiProviderConnections(null)
      setCustomAiProviderStatusError(true)
    }
  }

  const {
    messages,
    setMessages,
    sendMessage,
    addToolOutput,
    status,
    stop,
    error,
  } = useChat({
    id: chatId,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        document: engine.document,
        selectedRefs: selectionRef.current,
        designId: target.designId,
        draftId: target.draftId,
        chatId,
        model: modelRef.current,
        reasoningEffort: reasoningEffortRef.current,
      }),
    }),
    sendAutomaticallyWhen: (options) =>
      queuedMessagesRef.current.length === 0 &&
      lastAssistantMessageIsCompleteWithToolCalls(options),
    onToolCall({ toolCall }) {
      if (toolCall.dynamic || executed.current.has(toolCall.toolCallId)) return
      executed.current.add(toolCall.toolCallId)
      void executeTool(
        toolCall.toolName,
        toolCall.toolCallId,
        toolCall.input,
      )
    },
  })
  const messagesRef = useRef(messages)
  const titleRef = useRef(title)
  messagesRef.current = messages
  titleRef.current = title

  const respond = useCallback(
    (tool: string, toolCallId: string, output: unknown) => {
      addToolOutput({
        tool,
        toolCallId,
        output,
      } as Parameters<typeof addToolOutput>[0])
    },
    [addToolOutput],
  )

  const fail = useCallback(
    (tool: string, toolCallId: string, cause: unknown) => {
      addToolOutput({
        tool,
        toolCallId,
        state: 'output-error',
        errorText: cause instanceof Error ? cause.message : String(cause),
      } as Parameters<typeof addToolOutput>[0])
    },
    [addToolOutput],
  )

  const executeTool = async (
    tool: string,
    toolCallId: string,
    rawInput: unknown,
  ) => {
    try {
      const current = engine.document
      if (tool === 'askQuestion') {
        const input = rawInput as { question?: string; options?: string[] }
        if (!input.question || !Array.isArray(input.options)) {
          throw new Error('Question input is invalid')
        }
        setPendingQuestion({
          toolCallId,
          question: input.question,
          options: input.options,
        })
        return
      }
      if (tool === 'createPage') {
        const input = createPageInputSchema.parse(rawInput)
        const created = createPageTransaction(current, input)
        const result = transact(created.transaction)
        respond(tool, toolCallId, {
          pageId: created.pageId,
          refs: created.refs,
          changedNodeIds: [...result.changedNodeIds],
        })
        return
      }
      if (tool === 'insertNodes') {
        const input = insertNodesInputSchema.parse(rawInput)
        const parent = sourceContainerForRef(current, input.parent)
        const built = insertDescriptorOperations(
          current,
          parent.id,
          input.nodes,
        )
        const result = transact({
          id: canvasId('tx'),
          label: 'Agent inserted nodes',
          operations: built.operations,
        })
        respond(tool, toolCallId, {
          refs: built.refs,
          nodeIds: built.nodeIds,
          changedNodeIds: [...result.changedNodeIds],
        })
        return
      }
      if (tool === 'patchNodes') {
        const input = patchNodesInputSchema.parse(rawInput)
        const result = transact({
          id: canvasId('tx'),
          label: 'Agent updated nodes',
          operations: patchOperationsForChanges(current, input.changes),
        })
        respond(tool, toolCallId, {
          changedNodeIds: [...result.changedNodeIds],
        })
        return
      }
      if (tool === 'moveNodes') {
        const input = moveNodesInputSchema.parse(rawInput)
        const offsets = new Map<string, number>()
        const operations = input.changes.map((change) => {
          const source = current.nodes[change.nodeId]
          if (!source) throw new Error(`Node "${change.nodeId}" does not exist`)
          if (source.locked) throw new Error(`Node "${source.name}" is locked`)
          const key = change.parentId ?? '$root'
          const offset = offsets.get(key) ?? 0
          offsets.set(key, offset + 1)
          const order =
            change.order ??
            (orderedChildren(current, change.parentId).at(-1)?.order ?? 0) +
              (offset + 1) * 1024
          return {
            type: 'node.move' as const,
            id: change.nodeId,
            parentId: change.parentId,
            order,
          }
        })
        const result = transact({
          id: canvasId('tx'),
          label: 'Agent moved nodes',
          operations,
        })
        respond(tool, toolCallId, {
          changedNodeIds: [...result.changedNodeIds],
        })
        return
      }
      if (tool === 'deleteNodes') {
        const input = deleteNodesInputSchema.parse(rawInput)
        const nodeIds = normalizeDeletionNodeIds(current, input.nodeIds)
        for (const id of nodeIds) {
          const source = current.nodes[id]
          if (!source) throw new Error(`Node "${id}" does not exist`)
          if (source.locked) throw new Error(`Node "${source.name}" is locked`)
        }
        setPendingDelete({ toolCallId, nodeIds })
        return
      }
      if (tool === 'readNode') {
        const input = readNodeInputSchema.parse(rawInput)
        respond(tool, toolCallId, readCanvasNodeRef(current, input.ref))
        return
      }
      if (tool === 'readTree') {
        const input = readTreeInputSchema.parse(rawInput)
        respond(
          tool,
          toolCallId,
          semanticTree(current, input.root ?? null, input.depth),
        )
        return
      }
      if (tool === 'searchNodes') {
        const input = searchNodesInputSchema.parse(rawInput)
        respond(
          tool,
          toolCallId,
          searchCanvasNodes(current, input.query, input.types),
        )
        return
      }
      if (tool === 'createComponent') {
        const input = createComponentInputSchema.parse(rawInput)
        const created = createComponentTransaction(current, input)
        const result = transact(created.transaction)
        respond(tool, toolCallId, {
          componentId: created.componentId,
          refs: created.refs,
          changedNodeIds: [...result.changedNodeIds],
        })
        return
      }
      if (tool === 'createInstance') {
        const input = createInstanceInputSchema.parse(rawInput)
        const parent = sourceContainerForRef(current, input.parent)
        const component = current.nodes[input.componentId]
        if (component?.type !== 'component') throw new Error('Component does not exist')
        const node: CanvasNode = createInstanceNode(
          component.id,
          input.name ?? `${component.name} instance`,
          {
            parentId: parent.id,
            order: (orderedChildren(current, parent.id).at(-1)?.order ?? 0) + 1024,
            layout: {
              ...defaultLayout(320, 200, {
                position: parent.layout.mode === 'absolute' ? 'absolute' : 'flow',
              }),
              ...input.layout,
            },
            style: { ...defaultStyle(), ...input.style },
            variant: input.variant ?? component.defaultVariant,
          },
        )
        const result = transact({
          id: canvasId('tx'),
          label: `Create ${component.name} instance`,
          operations: [{ type: 'node.insert', node }],
        })
        respond(tool, toolCallId, {
          instanceId: node.id,
          changedNodeIds: [...result.changedNodeIds],
        })
        return
      }
      if (tool === 'setTokens') {
        const input = setTokensInputSchema.parse(rawInput)
        const result = transact({
          id: canvasId('tx'),
          label: 'Agent updated tokens',
          operations: tokenOperations(input.tokens),
        })
        respond(tool, toolCallId, {
          tokenIds: input.tokens.map((token) => token.id),
          changedNodeIds: [...result.changedNodeIds],
          changedTokenIds: [...result.changedTokenIds],
        })
        return
      }
      if (tool === 'viewNode') {
        const input = viewNodeInputSchema.parse(rawInput)
        readCanvasNodeRef(current, input.ref)
        respond(tool, toolCallId, {
          image: await captureNodePng(registry, input.ref),
        })
        return
      }
      if (tool === 'viewPage') {
        const input = viewPageInputSchema.parse(rawInput)
        const page = current.nodes[input.pageId]
        if (page?.type !== 'page') {
          throw new Error(`Page "${input.pageId}" does not exist`)
        }
        respond(tool, toolCallId, {
          image: await renderPagePng(
            current,
            input.pageId,
            input.width ?? page.viewport.width,
          ),
        })
        return
      }
      if (tool === 'viewCanvas') {
        viewCanvasInputSchema.parse(rawInput)
        respond(tool, toolCallId, {
          image: await captureCanvasPng(current, registry),
        })
        return
      }
      throw new Error(`Unsupported client tool "${tool}"`)
    } catch (cause) {
      fail(tool, toolCallId, cause)
    }
  }

  useEffect(() => {
    let cancelled = false
    void client.chat
      .get({ id: chatId })
      .then(({ messages: stored }) => {
        if (!cancelled) {
          setMessages(stored as UIMessage[])
          setReady(true)
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [chatId, client, setMessages])

  useEffect(() => {
    if (!ready || status === 'submitted' || status === 'streaming') return
    const last = messages.at(-1)
    if (!last || last.role !== 'assistant') return
    for (const part of last.parts) {
      const tool = part as ToolPart
      if (
        !tool.type.startsWith('tool-') ||
        tool.state !== 'input-available' ||
        executed.current.has(tool.toolCallId)
      ) {
        continue
      }
      executed.current.add(tool.toolCallId)
      void executeTool(
        tool.type.slice(5),
        tool.toolCallId,
        tool.input,
      )
    }
  }, [messages, ready, status])

  useEffect(() => {
    if (!ready) return
    const timeout = window.setTimeout(() => {
      void client.chat.save({
        id: chatId,
        title,
        messages: sanitizeChatMessagesForStorage(messages),
      })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [chatId, client, messages, ready, title])

  useEffect(() => {
    if (!ready) return
    return () => {
      void client.chat.save({
        id: chatId,
        title: titleRef.current,
        messages: sanitizeChatMessagesForStorage(messagesRef.current),
      })
    }
  }, [chatId, client, ready])

  const submitText = useCallback(
    async (text: string, files: FileUIPart[] = []) => {
      const prompt = text.trim()
      const nextTitle =
        title === 'New chat'
          ? titleFromPrompt(prompt || files[0]?.filename || 'New chat')
          : title
      if (nextTitle !== title) {
        setTitle(nextTitle)
        onTitleChange(chatId, nextTitle)
      }
      try {
        await client.history.commitV2({
          id: `v${crypto.randomUUID().replaceAll('-', '')}`,
          designId: target.designId,
          draftId: target.draftId,
          message: `Before: ${(prompt || 'Attachment request').slice(0, 60)}`,
          document: engine.document,
          skipIfUnchanged: true,
        })
      } catch {
        // A checkpoint failure should not strand the user's prompt; the
        // transaction log still preserves every structured mutation.
      }
      await sendMessage({ text: prompt, files })
    },
    [
      chatId,
      client,
      engine,
      onTitleChange,
      sendMessage,
      target.designId,
      target.draftId,
      title,
    ],
  )

  useEffect(() => {
    if (
      !ready ||
      readOnly ||
      !queuedPrompt ||
      deliveredPrompt.current === queuedPrompt.id ||
      status === 'submitted' ||
      status === 'streaming'
    ) {
      return
    }
    deliveredPrompt.current = queuedPrompt.id
    void submitText(queuedPrompt.message).finally(onQueuedPromptConsumed)
  }, [
    onQueuedPromptConsumed,
    queuedPrompt,
    readOnly,
    ready,
    status,
    submitText,
  ])

  useEffect(() => {
    if (!ready || status !== 'ready' || queuedMessages.length === 0) return
    const last = messages.at(-1)
    if (
      last?.role === 'assistant' &&
      last.parts.some((part) => {
        const tool = part as ToolPart
        return (
          typeof tool.type === 'string' &&
          tool.type.startsWith('tool-') &&
          tool.state !== 'output-available' &&
          tool.state !== 'output-error'
        )
      })
    ) {
      return
    }
    const [next, ...remaining] = queuedMessages
    if (!next) return
    setQueuedMessages(remaining)
    void submitText(next)
  }, [messages, queuedMessages, ready, status, submitText])

  useEffect(() => {
    let cancelled = false
    void loadMentionRemotes(client, target.designId).then((remote) => {
      if (cancelled) return
      setMentionAssets(remote.assets)
      setMentionRepositories(remote.repositories)
      setPreferredRepository(remote.preferredRepository)
    })
    return () => {
      cancelled = true
    }
  }, [client, target.designId])

  const mentionQuery = activeMentionQuery(input, caret)
  const mentionOpen = Boolean(
    mentionQuery && mentionDismissedStart !== mentionQuery.start,
  )
  const mentionItems =
    mentionOpen && mentionQuery
      ? filterMentionItems(
          composerMentionItems({
            elements: Object.values(document.nodes).map((node) => ({
              id: node.id,
              name: node.name,
              w: canvasLengthValue(
                node.layout.width,
                node.type === 'page' ? node.viewport.width : 0,
              ),
              h: canvasLengthValue(
                node.layout.height,
                node.type === 'page' ? node.viewport.minHeight : 0,
              ),
            })),
            assets: mentionAssets,
            repos: mentionRepositories,
            selectedIds: selection.map((ref) => ref.nodeId),
            preferredRepo: preferredRepository,
          }),
          mentionQuery.query,
        )
      : []

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery?.query, mentionQuery?.start])

  useEffect(() => {
    if (
      mentionDismissedStart !== null &&
      input[mentionDismissedStart] !== '@'
    ) {
      setMentionDismissedStart(null)
    }
  }, [input, mentionDismissedStart])

  useEffect(() => {
    if (active && ready) composerRef.current?.focus()
  }, [active, ready])

  const applyMention = (item: MentionItem) => {
    if (!mentionQuery) return
    const next = insertMention(input, mentionQuery.start, caret, item.label)
    setInput(next.text)
    setCaret(next.caret)
    setTrackedMentions((current) => [...current, item])
    setMentionDismissedStart(mentionQuery.start)
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  const syncCaret = (element: HTMLTextAreaElement) => {
    setCaret(element.selectionStart ?? element.value.length)
  }

  const resolveQuestion = (answer: string) => {
    if (!pendingQuestion) return
    respond('askQuestion', pendingQuestion.toolCallId, { answer })
    setPendingQuestion(null)
  }

  const resolveDelete = (allow: boolean) => {
    if (!pendingDelete) return
    if (!allow) {
      respond('deleteNodes', pendingDelete.toolCallId, {
        deleted: false,
        reason: 'User declined the deletion',
      })
      setPendingDelete(null)
      return
    }
    try {
      const result = transact({
        id: canvasId('tx'),
        label: 'Agent deleted nodes',
        operations: pendingDelete.nodeIds.map((id) => ({
          type: 'node.delete' as const,
          id,
        })),
      })
      respond('deleteNodes', pendingDelete.toolCallId, {
        deleted: true,
        nodeIds: pendingDelete.nodeIds,
        changedNodeIds: [...result.changedNodeIds],
      })
    } catch (cause) {
      fail('deleteNodes', pendingDelete.toolCallId, cause)
    } finally {
      setPendingDelete(null)
    }
  }

  const busy = status === 'submitted' || status === 'streaming'
  useEffect(() => {
    onRunningChange(chatId, busy)
    return () => onRunningChange(chatId, false)
  }, [busy, chatId, onRunningChange])

  if (!active) return null

  return (
    <>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-2.5">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Direct the canvas"
              description='Try “build a portfolio hero” or select a layer and ask “make this more compact”.'
            />
          ) : null}
          {messages.map((message, index) => (
            <ChatMessageRow
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
              streaming={
                index === messages.length - 1 &&
                (status === 'streaming' || status === 'submitted')
              }
              document={document}
            />
          ))}
          {isThinking(status, messages) ? <AgentThinking /> : null}
          {error ? (
            <p className="text-xs text-destructive">
              {readableError(error.message) ?? 'Request failed.'}
            </p>
          ) : null}
          {composerError ? (
            <p className="text-xs text-destructive">{composerError}</p>
          ) : null}
          {pendingQuestion ? (
            <div className="rounded-md border bg-background px-2.5 py-2">
              <p className="text-[11px]">{pendingQuestion.question}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {pendingQuestion.options.map((option) => (
                  <Button
                    key={option}
                    size="xs"
                    variant="outline"
                    onClick={() => resolveQuestion(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {pendingDelete ? (
            <div className="rounded-md border bg-background px-2.5 py-2">
              <p className="text-[11px] font-medium">
                Delete {pendingDelete.nodeIds.length} node
                {pendingDelete.nodeIds.length === 1 ? '' : 's'}?
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Descendants are deleted too. This can be undone until the
                history is cleared.
              </p>
              <div className="mt-1.5 flex justify-end gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => resolveDelete(false)}
                >
                  Keep
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => resolveDelete(true)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="relative shrink-0 border-t p-2">
        {mentionOpen && mentionItems.length > 0 ? (
          <MentionMenu
            items={mentionItems}
            activeIndex={mentionIndex}
            onSelect={applyMention}
            onHover={setMentionIndex}
          />
        ) : null}
        {queuedMessages.length > 0 ? (
          <div className="mb-2 flex flex-col gap-1" aria-label="Queued messages">
            {queuedMessages.map((text, index) => (
              <div
                key={`${index}-${text.slice(0, 24)}`}
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
              >
                <Spinner className="size-3 shrink-0 opacity-50" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{text}</span>
                <button
                  type="button"
                  aria-label="Remove queued message"
                  className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    setQueuedMessages((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <PromptInput
          accept={
            imageInputsEnabled
              ? `image/*,${DOCUMENT_UPLOAD_ACCEPT}`
              : DOCUMENT_UPLOAD_ACCEPT
          }
          maxFiles={5}
          maxFileSize={10 * 1024 * 1024}
          multiple
          onError={({ message }) => setComposerError(message)}
          onSubmit={async ({ text, files }) => {
            const trimmed = text.trim()
            if ((!trimmed && files.length === 0) || !ready || readOnly) return
            const outbound = trimmed
              ? `${trimmed}${mentionSuffix(trimmed, trackedMentions)}`
              : ''
            if (busy) {
              if (files.length > 0) {
                setComposerError(
                  'Wait for the current run to finish before sending attachments.',
                )
                return
              }
              setComposerError(null)
              setQueuedMessages((current) => [...current, outbound])
              setInput('')
              setCaret(0)
              setTrackedMentions([])
              setMentionDismissedStart(null)
              return
            }
            setComposerError(null)
            setInput('')
            setCaret(0)
            setTrackedMentions([])
            setMentionDismissedStart(null)
            await submitText(outbound, files)
          }}
        >
          <ComposerAttachmentTray />
          <PromptInputTextarea
            ref={composerRef}
            value={input}
            onChange={(event) => {
              setComposerError(null)
              setInput(event.target.value)
              syncCaret(event.target)
            }}
            onClick={(event) => syncCaret(event.currentTarget)}
            onSelect={(event) => syncCaret(event.currentTarget)}
            onKeyUp={(event) => syncCaret(event.currentTarget)}
            onKeyDown={(event) => {
              if (!mentionOpen || mentionItems.length === 0) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setMentionIndex((current) => (current + 1) % mentionItems.length)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setMentionIndex(
                  (current) =>
                    (current - 1 + mentionItems.length) % mentionItems.length,
                )
              } else if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const item = mentionItems[mentionIndex]
                if (item) applyMention(item)
              } else if (event.key === 'Escape' && mentionQuery) {
                event.preventDefault()
                setMentionDismissedStart(mentionQuery.start)
              }
            }}
            placeholder={
              !ready
                ? 'Loading chat…'
                : readOnly
                  ? 'This branch is read-only…'
                  : busy
                    ? 'Steer the agent — Enter queues your message…'
                    : 'Describe a change… (@ to mention)'
            }
            disabled={!ready || readOnly}
            className="w-full text-[13px]"
          />
          <PromptInputFooter>
            <div className="flex min-w-0 items-center gap-1">
              <ComposerAttachmentButton disabled={!ready || busy || readOnly} />
              <ModelPicker
                model={model}
                chatGPTModels={chatGPTModels}
                chatGPTModelsError={chatGPTModelsError}
                loadingChatGPTModels={loadingChatGPTModels}
                onLoadChatGPTModels={loadChatGPTModels}
                openRouterConnected={openRouterConnected}
                openRouterStatusError={openRouterStatusError}
                onLoadOpenRouterStatus={loadOpenRouterStatus}
                customAiProviderConnections={customAiProviderConnections}
                customAiProviderStatusError={customAiProviderStatusError}
                onLoadCustomAiProviderStatus={loadCustomAiProviderStatus}
                onModelChange={changeModel}
              />
              {usingChatGPT ? (
                <ReasoningEffortPicker
                  effort={reasoningEffort}
                  onChange={changeReasoningEffort}
                />
              ) : null}
            </div>
            <ComposerSubmit
              status={status}
              onStop={() => void stop()}
              chatReady={ready}
              hasText={Boolean(input.trim())}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  )
}

function ComposerAttachmentTray() {
  const { files, remove } = usePromptInputAttachments()
  if (files.length === 0) return null

  return (
    <PromptInputHeader className="gap-2 pb-0">
      {files.map((file) => {
        const label =
          file.filename ||
          (file.mediaType.startsWith('image/') ? 'Pasted image' : 'File')
        return (
          <div
            key={file.id}
            className="group/attachment relative flex min-w-0 max-w-44 items-center gap-2 rounded-md border bg-muted/40 p-1.5 pe-7 text-xs"
          >
            {file.mediaType.startsWith('image/') ? (
              <img
                src={file.url}
                alt={label}
                className="size-9 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex size-9 shrink-0 items-center justify-center rounded bg-background">
                <FileTextIcon
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
              </div>
            )}
            <span className="truncate" title={label}>
              {label}
            </span>
            <button
              type="button"
              aria-label={`Remove ${label}`}
              className="absolute end-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => remove(file.id)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )
      })}
    </PromptInputHeader>
  )
}

function ComposerAttachmentButton({ disabled }: { disabled: boolean }) {
  const { openFileDialog } = usePromptInputAttachments()
  return (
    <PromptInputButton
      aria-label="Attach files"
      disabled={disabled}
      onClick={openFileDialog}
      tooltip="Attach files"
    >
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  )
}

function ComposerSubmit({
  chatReady,
  hasText,
  status,
  onStop,
}: {
  chatReady: boolean
  hasText: boolean
  status: ChatState['status']
  onStop: () => void
}) {
  const { files } = usePromptInputAttachments()
  return (
    <PromptInputSubmit
      status={status}
      onStop={onStop}
      disabled={
        status !== 'streaming' &&
        status !== 'submitted' &&
        (!chatReady || (!hasText && files.length === 0))
      }
    />
  )
}

function modelLabel(model: string) {
  return MODELS.find((candidate) => candidate.id === model)?.label ?? model
}

function ReasoningEffortPicker({
  effort,
  onChange,
}: {
  effort: ChatGPTReasoningEffort
  onChange: (effort: ChatGPTReasoningEffort) => void
}) {
  const index = CHATGPT_REASONING_EFFORTS.findIndex(
    (option) => option.id === effort,
  )
  const label = CHATGPT_REASONING_EFFORTS[index]?.label
  const selectIndex = (next: number) => {
    const option = CHATGPT_REASONING_EFFORTS[next]
    if (option) onChange(option.id)
  }

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs leading-none text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        title="Reasoning effort"
      >
        <span>{label}</span>
        <ChevronDownIcon className="size-3 opacity-70" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64"
      >
        <div className="mb-3 text-sm font-medium">Reasoning effort</div>
        <SliderPrimitive.Root
          value={index}
          min={0}
          max={CHATGPT_REASONING_EFFORTS.length - 1}
          step={1}
          onValueChange={selectIndex}
        >
          <SliderPrimitive.Control className="flex h-5 touch-none select-none items-center px-1">
            <SliderPrimitive.Track className="relative h-1.5 grow rounded-full bg-input">
              <SliderPrimitive.Indicator className="absolute inset-y-0 rounded-full bg-cx-accent" />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-[3px] inset-y-0 z-10 flex items-center justify-between"
              >
                {CHATGPT_REASONING_EFFORTS.map((option, stop) => (
                  <span
                    key={option.id}
                    className={cn(
                      'size-1 rounded-full',
                      stop <= index ? 'bg-white/70' : 'bg-foreground/25',
                    )}
                  />
                ))}
              </span>
              <SliderPrimitive.Thumb
                index={0}
                aria-label="Reasoning effort"
                className="z-20 block size-4 rounded-full border border-black/10 bg-white shadow-md outline-none transition-[scale,box-shadow] has-focus-visible:ring-3 has-focus-visible:ring-ring/30 data-dragging:scale-110"
              />
            </SliderPrimitive.Track>
          </SliderPrimitive.Control>
        </SliderPrimitive.Root>
        <div className="mt-1.5 flex justify-between">
          {CHATGPT_REASONING_EFFORTS.map((option, stop) => (
            <button
              key={option.id}
              type="button"
              onClick={() => selectIndex(stop)}
              className={cn(
                'rounded px-0.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30',
                stop === index
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ModelPicker({
  model,
  chatGPTModels,
  chatGPTModelsError,
  loadingChatGPTModels,
  onLoadChatGPTModels,
  openRouterConnected,
  openRouterStatusError,
  onLoadOpenRouterStatus,
  customAiProviderConnections,
  customAiProviderStatusError,
  onLoadCustomAiProviderStatus,
  onModelChange,
}: {
  model: string
  chatGPTModels: string[] | null
  chatGPTModelsError: 'disconnected' | 'failed' | null
  loadingChatGPTModels: boolean
  onLoadChatGPTModels: () => Promise<void>
  openRouterConnected: boolean | null
  openRouterStatusError: boolean
  onLoadOpenRouterStatus: () => Promise<void>
  customAiProviderConnections: CustomAiProviderConnections | null
  customAiProviderStatusError: boolean
  onLoadCustomAiProviderStatus: () => Promise<void>
  onModelChange: (model: string) => void
}) {
  const standardModels = MODELS.filter(
    ({ provider }) => provider === 'loora',
  )
  const openRouterModels = openRouterConnected
    ? MODELS.filter(({ provider }) => provider === 'openrouter')
    : []
  const availableChatGPTModels = MODELS.filter(
    ({ provider, modelId }) =>
      provider === 'chatgpt' && chatGPTModels?.includes(modelId),
  )
  const customProviderModels = (
    ['google', 'openai', 'anthropic'] as const
  ).flatMap((provider) =>
    customAiProviderConnections?.[provider].connected
      ? MODELS.filter((candidate) => candidate.provider === provider)
      : [],
  )

  const modelItem = ({
    id,
    label,
    provider,
  }: (typeof MODELS)[number]) => (
    <DropdownMenuItem key={id} onSelect={() => onModelChange(id)}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs text-muted-foreground">
        {PROVIDERS[provider].label}
      </span>
      {model === id ? <CheckIcon className="size-3.5 text-foreground" /> : null}
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return
        void Promise.all([
          onLoadChatGPTModels(),
          onLoadOpenRouterStatus(),
          onLoadCustomAiProviderStatus(),
        ])
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs leading-none text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{modelLabel(model)}</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Model
        </DropdownMenuLabel>
        {standardModels.map(modelItem)}
        <DropdownMenuSeparator />
        {openRouterModels.map(modelItem)}
        {openRouterModels.length === 0 ? (
          <DropdownMenuItem disabled>
            {openRouterConnected === null
              ? 'Checking OpenRouter…'
              : openRouterStatusError
                ? 'Could not load OpenRouter'
                : 'Connect OpenRouter in Settings'}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {customProviderModels.map(modelItem)}
        {customProviderModels.length === 0 ? (
          <DropdownMenuItem disabled>
            {customAiProviderStatusError
              ? 'Could not load API key providers'
              : customAiProviderConnections === null
                ? 'Checking API key providers…'
                : 'Add provider keys in Settings'}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {availableChatGPTModels.map(modelItem)}
        {availableChatGPTModels.length === 0 ? (
          <DropdownMenuItem disabled>
            {loadingChatGPTModels || chatGPTModels === null
              ? 'Checking ChatGPT…'
              : chatGPTModelsError === 'disconnected'
                ? 'Reconnect ChatGPT in Settings'
                : chatGPTModelsError === 'failed'
                  ? 'Could not load ChatGPT models'
                  : 'No supported ChatGPT model found'}
          </DropdownMenuItem>
        ) : null}
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
  output?: unknown
  errorText?: string
}

type MessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'file'; part: FileUIPart }
  | { kind: 'reasoning' }
  | { kind: 'tools'; parts: ToolPart[] }

function messageBlocks(
  parts: Array<{ type: string }>,
): MessageBlock[] {
  const blocks: MessageBlock[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({
        kind: 'text',
        text: (part as unknown as { text: string }).text,
      })
    } else if (part.type === 'file') {
      blocks.push({ kind: 'file', part: part as FileUIPart })
    } else if (part.type === 'reasoning') {
      blocks.push({ kind: 'reasoning' })
    } else if (
      part.type.startsWith('tool-') &&
      part.type !== 'tool-askQuestion'
    ) {
      const previous = blocks.at(-1)
      if (previous?.kind === 'tools') {
        previous.parts.push(part as ToolPart)
      } else {
        blocks.push({ kind: 'tools', parts: [part as ToolPart] })
      }
    }
  }
  return blocks
}

function ChatFileAttachment({ file }: { file: FileUIPart }) {
  const label =
    file.filename || (file.mediaType.startsWith('image/') ? 'Image' : 'File')
  if (file.mediaType.startsWith('image/')) {
    return (
      <figure className="overflow-hidden rounded-md border bg-background/40">
        <img
          src={file.url}
          alt={label}
          className="max-h-64 w-full max-w-sm object-contain"
        />
        <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">
          {label}
        </figcaption>
      </figure>
    )
  }
  return (
    <div className="flex max-w-xs items-center gap-2 rounded-md border bg-background/40 px-2.5 py-2">
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-xs">{label}</span>
    </div>
  )
}

function UserMessageText({ text }: { text: string }) {
  const { body, suffix } = stripMentionSuffix(text)
  const mentions = suffix ? parseMentionSuffix(suffix) : []
  const segments =
    mentions.length > 0 ? segmentMentionText(body, mentions) : null
  if (!segments) {
    return <span className="whitespace-pre-wrap">{body}</span>
  }
  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <MentionChip
            key={index}
            kind={segment.item.kind}
            label={segment.item.label}
          />
        ),
      )}
    </span>
  )
}

function StreamingText({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  const reduceMotion = useReducedMotion()
  const tokens = useMemo(() => text.match(/\S+\s*|\s+/g) ?? [], [text])
  if (!streaming || reduceMotion) {
    return <MessageResponse>{text}</MessageResponse>
  }
  return (
    <span className="whitespace-pre-wrap">
      {tokens.map((token, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          {token}
        </motion.span>
      ))}
    </span>
  )
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  isLast,
  streaming,
  document,
}: {
  message: UIMessage
  isLast: boolean
  streaming: boolean
  document: ReturnType<typeof useCanvasDocument>
}) {
  const blocks = useMemo(
    () => messageBlocks(message.parts),
    [message.parts],
  )
  return (
    <Message from={message.role}>
      <MessageContent>
        {blocks.map((block, index) =>
          block.kind === 'text' ? (
            message.role === 'user' ? (
              <UserMessageText key={index} text={block.text} />
            ) : (
              <StreamingText
                key={index}
                text={block.text}
                streaming={isLast && streaming}
              />
            )
          ) : block.kind === 'file' ? (
            <ChatFileAttachment key={index} file={block.part} />
          ) : block.kind === 'reasoning' ? (
            isLast && index === blocks.length - 1 && streaming ? (
              <AgentThinking key={index} label="Reasoning" />
            ) : null
          ) : (
            <ToolGroup key={index} parts={block.parts} document={document} />
          ),
        )}
      </MessageContent>
    </Message>
  )
})

function countInput(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return Array.isArray(value) ? value.length : 0
}

function refLabel(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const ref = value as { nodeId?: string; instancePath?: string[] }
  return [
    ref.nodeId,
    ref.instancePath?.length ? `in ${ref.instancePath.join(' / ')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function toolSummary(
  name: string,
  part: ToolPart,
  document: ReturnType<typeof useCanvasDocument>,
) {
  const input = part.input ?? {}
  if (name === 'insertNodes') {
    const count = countInput(input, 'nodes')
    return `${count} node${count === 1 ? '' : 's'}`
  }
  if (name === 'patchNodes' || name === 'moveNodes') {
    const count = countInput(input, 'changes')
    return `${count} node${count === 1 ? '' : 's'}`
  }
  if (name === 'deleteNodes') {
    const count = countInput(input, 'nodeIds')
    return `${count} node${count === 1 ? '' : 's'}`
  }
  if (name === 'setTokens') {
    const count = countInput(input, 'tokens')
    return `${count} token${count === 1 ? '' : 's'}`
  }
  if (name === 'createPage' || name === 'createComponent') {
    return String(input.name ?? '')
  }
  if (name === 'createInstance') {
    return String(input.name ?? input.componentId ?? '')
  }
  if (name === 'searchNodes') return String(input.query ?? '')
  if (name === 'readNode' || name === 'viewNode') {
    return refLabel(input.ref)
  }
  if (name === 'readTree') return refLabel(input.root)
  if (name === 'viewPage') {
    const page = document.nodes[String(input.pageId ?? '')]
    return page?.name ?? String(input.pageId ?? '')
  }
  if (name === 'viewCanvas') return 'canvas'
  if (name === 'listGitHubRepositories') {
    return String(input.query ?? 'accessible repositories')
  }
  if (
    name === 'listRepositoryTree' ||
    name === 'searchRepositoryCode' ||
    name === 'readRepositoryFile' ||
    name === 'viewRepositoryImage'
  ) {
    return [
      String(input.repository ?? 'repository'),
      String(input.path ?? input.pathPrefix ?? input.query ?? ''),
    ]
      .filter(Boolean)
      .join(' · ')
  }
  return ''
}

function ToolGroup({
  parts,
  document,
}: {
  parts: ToolPart[]
  document: ReturnType<typeof useCanvasDocument>
}) {
  if (parts.length === 1) {
    return <ToolRow part={parts[0]!} document={document} />
  }
  const failed = parts.some((part) => part.state === 'output-error')
  const busy = parts.some(
    (part) =>
      part.state === 'input-streaming' || part.state === 'input-available',
  )
  const counts = new Map<string, number>()
  for (const part of parts) {
    const name = part.type.slice(5) as keyof typeof TOOL_META
    const label = TOOL_META[name]?.past
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const summary = [...counts]
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ')
  return (
    <details className="group">
      <summary className="flex h-6 cursor-pointer list-none items-center gap-1.5 text-[11px]">
        <ChevronDownIcon className="size-3 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
        <span className="font-medium">{summary || `${parts.length} actions`}</span>
        <span className="ms-auto">
          {failed ? (
            <XIcon className="size-3 text-destructive" aria-label="Tool failed" />
          ) : busy ? (
            <Spinner
              className="size-3 text-muted-foreground"
              aria-label="Tool in progress"
            />
          ) : (
            <CheckIcon className="size-3 text-muted-foreground" />
          )}
        </span>
      </summary>
      <div className="ms-1.5 mt-1 flex flex-col gap-1 border-s ps-2.5">
        {parts.map((part) => (
          <ToolRow
            key={part.toolCallId}
            part={part}
            document={document}
          />
        ))}
      </div>
    </details>
  )
}

function ToolRow({
  part,
  document,
}: {
  part: ToolPart
  document: ReturnType<typeof useCanvasDocument>
}) {
  const name = part.type.slice(5) as keyof typeof TOOL_META
  const meta = TOOL_META[name]
  if (!meta) return null
  const failed = part.state === 'output-error'
  const done = part.state === 'output-available'
  const summary = toolSummary(name, part, document)
  return (
    <div className="flex h-5 items-center gap-1.5 text-[11px]">
      <meta.icon
        className={cn(
          'size-3 shrink-0 text-muted-foreground',
          name === 'deleteNodes' && 'text-destructive/70',
        )}
      />
      <span className="font-medium">{meta.label}</span>
      {summary ? (
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {summary}
        </span>
      ) : null}
      <span className="ms-auto shrink-0">
        {failed ? (
          <XIcon className="size-3.5 text-destructive" aria-label="Tool failed" />
        ) : done ? (
          <CheckIcon className="size-3.5 text-muted-foreground" />
        ) : (
          <Spinner className="size-3.5 text-cx-accent" aria-label="Tool in progress" />
        )}
      </span>
    </div>
  )
}
