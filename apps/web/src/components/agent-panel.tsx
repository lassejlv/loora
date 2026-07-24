import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type FileUIPart,
  type UIMessage,
} from 'ai'
import {
  ChatGPTProxyError,
  createChatGPTProxyProvider,
} from '@opencoredev/loginwithchatgpt-ai'
import { nanoid } from 'nanoid'
import {
  CheckIcon,
  LayersIcon,
  SearchIcon,
  ChevronDownIcon,
  EyeIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  PlusIcon,
  XIcon,
} from '#/components/icons'
import { Spinner } from '#/components/ui/spinner'
import {
  BookOpenIcon,
  FileTextIcon,
  GitBranchPlusIcon,
  GroupIcon,
  MoveIcon,
  PaperclipIcon,
  ScrollTextIcon,
  UngroupIcon,
  PenLineIcon,
  Trash2Icon,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '#/components/ai-elements/conversation'
import { Message, MessageContent } from '#/components/ai-elements/message'
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '#/components/ai-elements/prompt-input'
import { applyCodeEdits, type CanvasElement, type CodeEdit, type ElementActions } from '#/lib/canvas'
import { awaitRenderResult, captureElement, measureElement, readElementLogs } from '#/components/element-frame'
import { snapshotCanvas } from '#/lib/snapshot'
import { commitIfChanged } from '@loora/rpc/history'
import { sanitizeChatMessagesForStorage } from '@loora/rpc/chat-storage'
import { Sidebar } from '#/components/ui/sidebar'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { SliderPrimitive } from '#/components/ui/slider'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import { interruptIn, interruptTransition } from '#/lib/motion'
import { orpc } from '#/lib/orpc-client'
import {
  CHATGPT_REASONING_EFFORTS,
  DEFAULT_MODEL,
  getChatGPTReasoningEffort,
  MODELS,
  PROVIDERS,
  type ChatGPTReasoningEffort,
} from '@loora/agent/models'
import { modelSupportsImageInput } from '@loora/agent/messages'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { MentionMenu, MentionChip } from '#/components/mention-menu'
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

type ChatState = ReturnType<typeof useChat>
type ChatSummary = {
  id: string
  draftId?: string | null
  title: string
  updatedAt: number
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

// Kept above AgentPanel so ChatMessageRow / tool UI can reference it without
// a temporal-dead-zone on TOOL_META.
const TOOL_META = {
  createElement: { icon: PlusIcon, label: 'Create' },
  createElements: { icon: PlusIcon, label: 'Create' },
  updateElement: { icon: PenLineIcon, label: 'Update' },
  editElement: { icon: PenLineIcon, label: 'Edit' },
  arrangeElements: { icon: MoveIcon, label: 'Arrange' },
  reorderElements: { icon: LayersIcon, label: 'Reorder' },
  groupElements: { icon: GroupIcon, label: 'Group' },
  ungroupElements: { icon: UngroupIcon, label: 'Ungroup' },
  searchCanvas: { icon: SearchIcon, label: 'Search' },
  readElementLogs: { icon: ScrollTextIcon, label: 'Logs' },
  viewElement: { icon: EyeIcon, label: 'Inspect' },
  deleteElement: { icon: Trash2Icon, label: 'Delete' },
  readElement: { icon: BookOpenIcon, label: 'Read' },
  loadSkill: { icon: BookOpenIcon, label: 'Skill' },
  viewCanvas: { icon: EyeIcon, label: 'Verify' },
  listGitHubRepositories: { icon: LayersIcon, label: 'Listed repositories' },
  listRepositoryTree: { icon: LayersIcon, label: 'Browsed repository' },
  searchRepositoryCode: { icon: SearchIcon, label: 'Searched repository' },
  readRepositoryFile: { icon: BookOpenIcon, label: 'Read repository file' },
  viewRepositoryImage: { icon: EyeIcon, label: 'Viewed repository image' },
} as const

/**
 * Full catalog (incl. GitHub repo list — expensive). Used on doc load.
 * Cached briefly because every mounted ChatSession asks on mount, and
 * parallel sessions would otherwise multiply the GitHub sync.
 */
const mentionRemoteCache = new Map<string, { at: number; promise: ReturnType<typeof loadMentionRemotes> }>()

function fetchMentionRemotes(designId: string) {
  const cached = mentionRemoteCache.get(designId)
  if (cached && performance.now() - cached.at < 30_000) return cached.promise
  const promise = loadMentionRemotes(designId)
  mentionRemoteCache.set(designId, { at: performance.now(), promise })
  return promise
}

async function loadMentionRemotes(designId: string) {
  const [assets, repos, binding] = await Promise.all([
    orpc.asset.list().catch((error) => {
      console.error('[mentions] Failed to list assets:', error)
      return [] as { id: string; name: string }[]
    }),
    orpc.github.repositories().catch((error) => {
      console.error('[mentions] Failed to list repositories:', error)
      return [] as { fullName: string }[]
    }),
    orpc.github.binding({ designId }).catch((error) => {
      console.error('[mentions] Failed to load linked repository:', error)
      return null
    }),
  ])
  return {
    assets: assets.map((asset) => ({ id: asset.id, name: asset.name })),
    repos: repos.map((repo) => ({ fullName: repo.fullName })),
    preferredRepo: binding?.fullName ?? null,
  }
}

/**
 * Cheap refresh for newly uploaded assets / relinked repo. Skips
 * `github.repositories` — that syncs installations and hits GitHub per open.
 */
async function refreshMentionLocals(designId: string) {
  const [assets, binding] = await Promise.all([
    orpc.asset.list().catch((error) => {
      console.error('[mentions] Failed to list assets:', error)
      return [] as { id: string; name: string }[]
    }),
    orpc.github.binding({ designId }).catch((error) => {
      console.error('[mentions] Failed to load linked repository:', error)
      return null
    }),
  ])
  return {
    assets: assets.map((asset) => ({ id: asset.id, name: asset.name })),
    preferredRepo: binding?.fullName ?? null,
  }
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
      'tool-editElement',
      'tool-arrangeElements',
      'tool-reorderElements',
      'tool-groupElements',
      'tool-ungroupElements',
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

type ChatSessionApi = {
  dispatch: (text: string) => void
  busy: () => boolean
  ready: () => boolean
}

type SharedSessionProps = {
  actions: ElementActions
  shapesRef: React.RefObject<CanvasElement[]>
  selectedIdsRef?: React.RefObject<string[]>
  docId: string
  draftId?: string | null
}

/**
 * Shell that owns the chat list and mounts one ChatSession per chat that is
 * either active or still running. Sessions keep their useChat instance (and
 * the client-side tool loop) alive while hidden, so switching chats no longer
 * kills an in-flight generation — that is what makes parallel agents work.
 */
export const AgentPanel = memo(function AgentPanel({
  actions,
  shapesRef,
  selectedIdsRef,
  docId,
  draftId = null,
  getTargetBindings,
  isTargetReadOnly,
  onTargetChange,
  branches = [],
  onCreateBranch,
  onRunningTargetsChange,
  ready = true,
  sendRef,
}: SharedSessionProps & {
  getTargetBindings?: (draftId: string | null) => {
    actions: ElementActions
    shapesRef: React.RefObject<CanvasElement[]>
  }
  isTargetReadOnly?: (draftId: string | null) => boolean
  onTargetChange?: (
    draftId: string | null,
    options?: { announce?: boolean },
  ) => void
  branches?: Array<{ id: string; name: string }>
  onCreateBranch?: (name: string) => Promise<{ id: string; name: string }>
  onRunningTargetsChange?: (draftIds: Array<string | null>) => void
  ready?: boolean
  // Exposes a send-message entry point for canvas comment pins.
  sendRef?: React.RefObject<((text: string) => boolean) | null>
}) {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [branchDialogOpen, setBranchDialogOpen] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [branchError, setBranchError] = useState<string | null>(null)
  const [creatingBranch, setCreatingBranch] = useState(false)
  const sessionApis = useRef(new Map<string, ChatSessionApi>())
  const creatingTarget = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setChats([])
    setActiveChatId(null)
    setRunningIds([])
    if (!ready) return

    void (async () => {
      try {
        let stored = await orpc.chat.list({ designId: docId })
        let matching = stored.filter((chat) => (chat.draftId ?? null) === draftId)
        if (matching.length === 0 && !isTargetReadOnly?.(draftId)) {
          const created = await orpc.chat.create({
            id: `chat_${nanoid()}`,
            designId: docId,
            draftId,
            title: 'New chat',
          })
          stored = [created, ...stored]
          matching = [created]
        }
        if (!cancelled) {
          setChats(stored)
          setActiveChatId(matching[0]?.id ?? null)
        }
      } catch (error) {
        console.error('[chat] Failed to list chats:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [docId, ready])

  const createChat = async (targetDraftId = draftId) => {
    if (isTargetReadOnly?.(targetDraftId)) return
    const created = await orpc.chat.create({
      id: `chat_${nanoid()}`,
      designId: docId,
      draftId: targetDraftId,
      title: 'New chat',
    })
    setChats((current) => [created, ...current])
    setActiveChatId(created.id)
    onTargetChange?.(targetDraftId)
  }

  const createBranchChat = async () => {
    const name = branchName.trim()
    if (!name || !onCreateBranch) return
    setCreatingBranch(true)
    setBranchError(null)
    try {
      const branch = await onCreateBranch(name)
      await createChat(branch.id)
      setBranchDialogOpen(false)
      setBranchName('')
    } catch (error) {
      setBranchError(
        error instanceof Error ? error.message : 'Could not create this branch.',
      )
    } finally {
      setCreatingBranch(false)
    }
  }

  useEffect(() => {
    if (!ready || chats.length === 0) return
    const active = chats.find((chat) => chat.id === activeChatId)
    if ((active?.draftId ?? null) === draftId) return
    const matching = chats.find((chat) => (chat.draftId ?? null) === draftId)
    if (matching) {
      setActiveChatId(matching.id)
      return
    }
    if (isTargetReadOnly?.(draftId)) return
    const marker = draftId ?? 'main'
    if (creatingTarget.current === marker) return
    creatingTarget.current = marker
    void orpc.chat
      .create({
        id: `chat_${nanoid()}`,
        designId: docId,
        draftId,
        title: 'New chat',
      })
      .then((created) => {
        setChats((current) => [created, ...current])
        setActiveChatId(created.id)
      })
      .catch((error) => console.error('[chat] Failed to create target chat:', error))
      .finally(() => {
        if (creatingTarget.current === marker) creatingTarget.current = null
      })
  }, [activeChatId, chats, docId, draftId, ready])

  const onTitleChange = useCallback((chatId: string, title: string) => {
    setChats((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, title } : chat)),
    )
  }, [])

  const onRunningChange = useCallback((chatId: string, running: boolean) => {
    setRunningIds((current) => {
      if (running) return current.includes(chatId) ? current : [...current, chatId]
      return current.includes(chatId) ? current.filter((id) => id !== chatId) : current
    })
  }, [])

  useEffect(() => {
    onRunningTargetsChange?.(
      runningIds.map(
        (id) => chats.find((chat) => chat.id === id)?.draftId ?? null,
      ),
    )
  }, [chats, runningIds, onRunningTargetsChange])

  const registerApi = useCallback((chatId: string, api: ChatSessionApi | null) => {
    if (api) sessionApis.current.set(chatId, api)
    else sessionApis.current.delete(chatId)
  }, [])

  // Canvas comment pins send through here. Returns false while the active
  // chat is busy or still loading so the caller can keep the comment draft open.
  if (sendRef) {
    sendRef.current = (text: string): boolean => {
      const api = activeChatId ? sessionApis.current.get(activeChatId) : null
      if (!api || !api.ready() || api.busy()) return false
      api.dispatch(text)
      return true
    }
  }

  const activeBusy = activeChatId !== null && runningIds.includes(activeChatId)
  // Mounted = active chat + every chat with an in-flight run. An idle chat
  // unmounts on switch (its unmount save flushes); a running one stays alive.
  const mountedChats = chats.filter(
    (chat) => chat.id === activeChatId || runningIds.includes(chat.id),
  )
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const targetBusy = chats.some(
    (chat) =>
      runningIds.includes(chat.id) &&
      chat.id !== activeChatId &&
      (chat.draftId ?? null) === (activeChat?.draftId ?? null),
  )

  const selectChat = (chat: ChatSummary) => {
    setActiveChatId(chat.id)
    onTargetChange?.(chat.draftId ?? null, { announce: true })
  }

  const branchLabel = (targetDraftId: string | null | undefined) =>
    targetDraftId
      ? branches.find((branch) => branch.id === targetDraftId)?.name ?? 'Unknown branch'
      : 'Main'

  return (
    <>
      <Sidebar
        variant="floating"
        resizable
        className="[&_[data-slot=sidebar-inner]]:overflow-hidden [&_[data-slot=sidebar-inner]]:rounded-2xl [&_[data-slot=sidebar-inner]]:shadow-sm"
      >
        <header className="flex items-center gap-2 border-b px-3 py-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!activeChat}
                className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-semibold leading-none outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    activeBusy ? 'animate-pulse bg-cx-accent' : 'bg-muted-foreground/40',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-none">
                    {activeChat?.title ?? 'Loading…'}
                  </span>
                  {activeChat ? (
                    <span className="mt-1 block truncate text-[10px] font-normal leading-none text-muted-foreground">
                      Working on {branchLabel(activeChat.draftId)}
                    </span>
                  ) : null}
                </span>
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Chats
              </DropdownMenuLabel>
              {chats.map((chat) => (
                <DropdownMenuItem key={chat.id} onSelect={() => selectChat(chat)}>
                  <MessageSquareIcon />
                  <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                  <span className="max-w-20 truncate text-[10px] text-muted-foreground">
                    {branchLabel(chat.draftId)}
                  </span>
                  {runningIds.includes(chat.id) && (
                    <Spinner aria-label="Agent running" className="size-3 text-cx-accent" />
                  )}
                  {chat.id === activeChatId && <CheckIcon className="text-foreground" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  chats.some(
                    (chat) =>
                      runningIds.includes(chat.id) &&
                      (chat.draftId ?? null) === draftId,
                  ) || isTargetReadOnly?.(draftId)
                }
                onSelect={() => void createChat()}
              >
                <PlusIcon />
                New chat here
              </DropdownMenuItem>
              {onCreateBranch ? (
                <DropdownMenuItem onSelect={() => setBranchDialogOpen(true)}>
                  <GitBranchPlusIcon />
                  New chat in new branch…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {mountedChats.map((chat) => {
          const bindings =
            (chat.draftId ?? null) === draftId
              ? { actions, shapesRef }
              : getTargetBindings?.(chat.draftId ?? null) ?? { actions, shapesRef }
          return (
            <ChatSession
              key={chat.id}
              chatId={chat.id}
              draftId={chat.draftId ?? null}
              title={chat.title}
              active={chat.id === activeChatId}
              actions={bindings.actions}
              shapesRef={bindings.shapesRef}
              selectedIdsRef={
                (chat.draftId ?? null) === draftId ? selectedIdsRef : undefined
              }
              docId={docId}
              targetBlocked={targetBusy && chat.id === activeChatId}
              targetReadOnly={Boolean(isTargetReadOnly?.(chat.draftId ?? null))}
              targetName={branchLabel(chat.draftId)}
              onCreateBranchChat={
                onCreateBranch ? () => setBranchDialogOpen(true) : undefined
              }
              onTitleChange={onTitleChange}
              onRunningChange={onRunningChange}
              registerApi={registerApi}
            />
          )
        })}
      </Sidebar>

      <Dialog
        open={branchDialogOpen}
        onOpenChange={(open) => {
          setBranchDialogOpen(open)
          if (!open) {
            setBranchName('')
            setBranchError(null)
          }
        }}
      >
        <DialogPopup className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New branch and chat</DialogTitle>
            <DialogDescription>
              Starts from the latest Main canvas. Your current prompt and attachments stay here.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={branchName}
            maxLength={200}
            placeholder="Pricing experiment"
            aria-label="Branch name"
            onChange={(event) => setBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createBranchChat()
            }}
          />
          {branchError ? (
            <p className="text-sm text-destructive">{branchError}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!branchName.trim() || creatingBranch}
              onClick={() => void createBranchChat()}
            >
              {creatingBranch ? 'Creating…' : 'Create branch'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  )
})

function ChatSession({
  chatId,
  title,
  active,
  actions,
  shapesRef,
  selectedIdsRef,
  docId,
  draftId = null,
  targetBlocked = false,
  targetReadOnly = false,
  targetName,
  onCreateBranchChat,
  onTitleChange,
  onRunningChange,
  registerApi,
}: SharedSessionProps & {
  chatId: string
  title: string
  active: boolean
  targetBlocked?: boolean
  targetReadOnly?: boolean
  targetName: string
  onCreateBranchChat?: () => void
  onTitleChange: (chatId: string, title: string) => void
  onRunningChange: (chatId: string, running: boolean) => void
  registerApi: (chatId: string, api: ChatSessionApi | null) => void
}) {
  const [input, setInput] = useState('')
  const [caret, setCaret] = useState(0)
  const [mentionAssets, setMentionAssets] = useState<{ id: string; name: string }[]>([])
  const [mentionRepos, setMentionRepos] = useState<{ fullName: string }[]>([])
  const [preferredRepo, setPreferredRepo] = useState<string | null>(null)
  const [trackedMentions, setTrackedMentions] = useState<MentionItem[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissedStart, setMentionDismissedStart] = useState<number | null>(null)
  const [model, setModel] = useState(() => {
    // localStorage is absent in the node test environment
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem('loora:model')
    return stored && MODELS.some((m) => m.id === stored) ? stored : DEFAULT_MODEL
  })
  const [reasoningEffort, setReasoningEffort] = useState<ChatGPTReasoningEffort>(() =>
    getChatGPTReasoningEffort(
      typeof localStorage === 'undefined'
        ? undefined
        : localStorage.getItem('loora:reasoning-effort'),
    ),
  )
  const [chatGPTModels, setChatGPTModels] = useState<string[] | null>(null)
  const [loadingChatGPTModels, setLoadingChatGPTModels] = useState(false)
  const [chatGPTModelsError, setChatGPTModelsError] = useState<'disconnected' | 'failed' | null>(null)
  const modelRef = useRef(model)
  modelRef.current = model
  const reasoningEffortRef = useRef(reasoningEffort)
  reasoningEffortRef.current = reasoningEffort
  const usingChatGPT = MODELS.find((candidate) => candidate.id === model)?.provider === 'chatgpt'
  const imageInputsEnabled = modelSupportsImageInput(model)
  const changeModel = (next: string) => {
    setModel(next)
    if (typeof localStorage !== 'undefined') localStorage.setItem('loora:model', next)
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
    } catch (error) {
      setChatGPTModels([])
      setChatGPTModelsError(
        error instanceof ChatGPTProxyError && error.status === 401 ? 'disconnected' : 'failed',
      )
    } finally {
      setLoadingChatGPTModels(false)
    }
  }
  const [chatReady, setChatReady] = useState(false)
  // Elements created from a still-streaming createElement call: toolCallId →
  // element id, so later chunks (and the final tool call) update instead of
  // duplicating.
  const streamedCreates = useRef(new Map<string, string>())
  const streamedAppliedAt = useRef(new Map<string, number>())
  const [stallError, setStallError] = useState<string | null>(null)
  const titleRef = useRef(title)
  titleRef.current = title
  const recoveryRetries = useRef(0)
  const retryResponse = useRef<() => void>(() => {})
  const forceCanvasAction = useRef(false)
  // Messages typed while the agent is busy. Delivered at the next step
  // boundary: the wrapped sendAutomaticallyWhen suppresses the automatic
  // continuation, and onFinish sends the queued text instead — so the model
  // sees the tool results plus the user's steering in one request. When the
  // run is already over, the same path simply starts the next turn.
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const queuedRef = useRef(queuedMessages)
  queuedRef.current = queuedMessages
  const dispatchPrompt = useRef<(text: string, files?: FileUIPart[]) => void>(() => {})
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Executor shared by live onToolCall and reload recovery; the id set keeps
  // repeated tool parts from running twice.
  const runToolCall = useRef<
    (toolCall: { toolName: string; toolCallId: string; input: unknown; dynamic?: boolean }) => void
  >(() => {})
  const executedToolCallIds = useRef(new Set<string>())

  const { messages, setMessages, sendMessage, regenerate, addToolOutput, status, stop, error } =
    useChat({
      id: chatId,
      transport: new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          shapes: shapesRef.current,
          selectedIds: selectedIdsRef?.current ?? [],
          designId: docId,
          draftId,
          chatId,
          model: modelRef.current,
          reasoningEffort: reasoningEffortRef.current,
          forceCanvasAction: forceCanvasAction.current,
        }),
      }),
      sendAutomaticallyWhen: (options) =>
        queuedRef.current.length === 0 &&
        lastAssistantMessageIsCompleteWithToolCalls(options),
      onFinish({ message, isAbort, isError }) {
        if (isAbort && queuedRef.current.length > 0) {
          // The user stopped the run; hand queued text back to the composer
          // instead of firing it at an agent they just interrupted.
          const queued = queuedRef.current
          setQueuedMessages([])
          setInput((current) =>
            [current.trim(), ...queued].filter(Boolean).join('\n'),
          )
        } else if (!isError && queuedRef.current.length > 0) {
          // The queue-flush effect sends the next message once every client
          // tool has reported its render result; skip stall recovery here.
          recoveryRetries.current = 0
          forceCanvasAction.current = false
          return
        }
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
        runToolCall.current(toolCall)
      },
    })

  runToolCall.current = (toolCall) => {
        if (toolCall.dynamic) return
        if (executedToolCallIds.current.has(toolCall.toolCallId)) return
        executedToolCallIds.current.add(toolCall.toolCallId)
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
          let render = await awaitRenderResult(el.id)
          // The ok ack races async crashes (effects, timers) that land after
          // the grace period. The frame's log buffer was cleared when this
          // payload mounted, so any uncaught entry in it belongs to the code
          // being acked — report it instead of a false "ok".
          if (render?.ok) {
            const logs = await readElementLogs(el.id, 500)
            const crash = logs?.find((line) => line.startsWith('uncaught: '))
            if (crash) render = { ok: false, error: crash.slice('uncaught: '.length) }
          }
          // Content overflow is the most common silent failure (a page taller
          // than its element box gets clipped); measure and put it in the
          // render string so the model cannot miss it.
          let renderText = render ? (render.ok ? 'ok' : `error: ${render.error}`) : 'unknown'
          if (render?.ok) {
            const size = await measureElement(el.id)
            if (size && (size.h > el.h + 8 || size.w > el.w + 8)) {
              const axes: string[] = []
              if (size.h > el.h + 8) axes.push(`${size.h}px tall vs element h=${el.h}`)
              if (size.w > el.w + 8) axes.push(`${size.w}px wide vs element w=${el.w}`)
              renderText = `ok, but the content overflows and is clipped (${axes.join(', ')}) — resize the element with arrangeElements to fit`
            }
          }
          return {
            id: el.id,
            name: el.name,
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            render: renderText,
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
            case 'editElement': {
              const { id, edits } = input as { id: string; edits: CodeEdit[] }
              const el = shapesRef.current.find((s) => s.id === id)
              if (!el) {
                respond({ error: `No element with id ${id}` })
                break
              }
              const result = applyCodeEdits(el.code, edits ?? [])
              if (!result.ok) {
                respond({ error: result.error })
                break
              }
              const updated = actions.updateElement(id, { code: result.code })
              if (!updated) {
                respond({ error: `No element with id ${id}` })
              } else {
                void ackWithRender(updated).then((ack) => respond({ ...ack, applied: result.contexts }))
              }
              break
            }
            case 'arrangeElements': {
              const changes =
                (input as { changes?: ({ id: string } & Partial<CanvasElement>)[] }).changes ?? []
              const updated: Pick<CanvasElement, 'id' | 'name' | 'x' | 'y' | 'w' | 'h'>[] = []
              const missing: string[] = []
              for (const { id, ...patch } of changes) {
                const el = actions.updateElement(id, patch)
                if (el) updated.push({ id: el.id, name: el.name, x: el.x, y: el.y, w: el.w, h: el.h })
                else missing.push(id)
              }
              respond(missing.length > 0 ? { updated, missing } : { updated })
              break
            }
            case 'searchCanvas': {
              const query = String((input as { query?: string }).query ?? '')
              const needle = query.toLowerCase()
              const matches: { id: string; name: string; line: number; text: string }[] = []
              let truncated = false
              for (const el of shapesRef.current) {
                const lines = el.code.split('\n')
                for (let i = 0; i < lines.length; i++) {
                  if (!lines[i].toLowerCase().includes(needle)) continue
                  if (matches.length >= 50) {
                    truncated = true
                    break
                  }
                  const text = lines[i].trim()
                  matches.push({
                    id: el.id,
                    name: el.name,
                    line: i + 1,
                    text: text.length > 200 ? `${text.slice(0, 200)}…` : text,
                  })
                }
                if (truncated) break
              }
              respond(truncated ? { matches, truncated: true } : { matches })
              break
            }
            case 'reorderElements': {
              const orderedIds = (input as { orderedIds?: string[] }).orderedIds ?? []
              respond({ order: actions.reorderElements(orderedIds) })
              break
            }
            case 'groupElements': {
              const ids = (input as { ids?: string[] }).ids ?? []
              const group = actions.groupElements(ids)
              respond(
                group ?? { error: 'Fewer than 2 of the given ids exist on the canvas — nothing was grouped.' },
              )
              break
            }
            case 'ungroupElements': {
              const ids = (input as { ids?: string[] }).ids ?? []
              respond({ ungrouped: actions.ungroupElements(ids) })
              break
            }
            case 'readElementLogs': {
              const id = (input as { id?: string }).id
              if (!id || !shapesRef.current.some((s) => s.id === id)) {
                respond({ error: `No element with id ${String(id)}` })
                break
              }
              void readElementLogs(id).then((logs) =>
                respond(
                  logs === null
                    ? { error: 'The element frame is not mounted or did not respond.' }
                    : logs.length > 0
                      ? { logs }
                      : { logs: [], note: 'No console output or runtime errors since the code last mounted.' },
                ),
              )
              break
            }
            case 'viewElement': {
              if (!modelSupportsImageInput(modelRef.current)) {
                respond({ unavailable: true })
                break
              }
              const id = (input as { id?: string }).id
              if (!id || !shapesRef.current.some((s) => s.id === id)) {
                respond({ error: `No element with id ${String(id)}` })
                break
              }
              void captureElement(id, 4000)
                .then((capture) =>
                  respond(
                    capture
                      ? capture.fontsSkipped
                        ? {
                            image: capture.png,
                            note: 'Webfonts could not be embedded in this capture — typography on the live canvas may differ.',
                          }
                        : { image: capture.png }
                      : { error: 'Could not capture the element.' },
                  ),
                )
                .catch(() => fail('Could not capture the element.'))
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
              void snapshotCanvas(shapesRef.current, { freshness: 'fresh' })
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
  }
  const addToolOutputRef = useRef(addToolOutput)
  addToolOutputRef.current = addToolOutput

  retryResponse.current = () => {
    setStallError(null)
    void regenerate()
  }

  // One send path for composer submits, comment pins, and queue flushes:
  // chat title, history checkpoint, canvas snapshot, sendMessage.
  dispatchPrompt.current = (text, files = []) => {
    if (targetBlocked || targetReadOnly) {
      setStallError(
        targetReadOnly
          ? 'This branch is read-only. Choose Main or an active branch to make changes.'
          : `Another agent is already working on ${targetName}. Start a new branch to work in parallel.`,
      )
      return
    }
    setStallError(null)
    recoveryRetries.current = 0
    const promptLabel =
      text.trim() ||
      files.map((file) => file.filename).filter(Boolean).join(', ') ||
      'Attached files'
    if (titleRef.current === 'New chat') {
      onTitleChange(chatId, titleFromPrompt(promptLabel))
    }
    // safety checkpoint: restorable from History if the agent goes wrong
    const historyId = draftId ? `${docId}:draft:${draftId}` : docId
    commitIfChanged(historyId, `Before: ${promptLabel.slice(0, 60)}`, shapesRef.current)
    void orpc.history
      .commit({
        id: `c${nanoid()}`,
        designId: docId,
        draftId,
        message: `Before: ${promptLabel.slice(0, 60)}`,
        shapes: shapesRef.current,
        skipIfUnchanged: true,
      })
      .catch((error) => console.error('[history] Failed to save checkpoint:', error))
    void (async () => {
      const snapshot = imageInputsEnabled ? await snapshotCanvas(shapesRef.current) : null
      const uploadedFiles = imageInputsEnabled
        ? files
        : files.filter((file) => !file.mediaType.startsWith('image/'))
      void sendMessage({
        text,
        files: [
          ...uploadedFiles,
          ...(snapshot
            ? [{ type: 'file' as const, mediaType: 'image/png', url: snapshot }]
            : []),
        ],
      })
    })()
  }

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Report run state up (chat-list spinner, mount lifetime) and expose the
  // send entry point for comment pins.
  const busy = status === 'streaming' || status === 'submitted'
  const busyRef = useRef(busy)
  busyRef.current = busy
  const chatReadyRef = useRef(chatReady)
  chatReadyRef.current = chatReady
  useEffect(() => {
    onRunningChange(chatId, busy)
  }, [busy, chatId, onRunningChange])
  useEffect(() => {
    registerApi(chatId, {
      dispatch: (text) => dispatchPrompt.current(text),
      busy: () => busyRef.current,
      ready: () => chatReadyRef.current,
    })
    return () => {
      registerApi(chatId, null)
      onRunningChange(chatId, false)
    }
  }, [chatId, registerApi, onRunningChange])

  // Reload recovery: a saved chat can end with tool calls that never produced
  // outputs (the tab closed between the stream finishing and the tools
  // running). Execute them once the stored messages land — their outputs
  // re-arm sendAutomaticallyWhen, so the interrupted loop continues on its
  // own. The executed-id set keeps restored tool parts from running twice.
  const recoveredRef = useRef(false)
  useEffect(() => {
    if (!chatReady || recoveredRef.current) return
    if (status === 'streaming' || status === 'submitted') return
    recoveredRef.current = true
    const last = messagesRef.current[messagesRef.current.length - 1]
    if (!last || last.role !== 'assistant') return
    for (const part of last.parts) {
      const p = part as unknown as ToolPart
      if (typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue
      if (p.state !== 'input-available') continue
      const toolName = p.type.slice(5)
      // Approval tools park for the user's inline answer — never auto-run.
      if (toolName === 'askQuestion' || toolName === 'deleteElement') continue
      runToolCall.current({ toolName, toolCallId: p.toolCallId, input: p.input })
    }
  }, [chatReady, status])

  // Queue flush. Runs when the chat goes idle AND every tool part on the last
  // assistant message has an output — client tools resolve after the stream
  // closes (renders wait ~1.5s), and sending before they land would submit a
  // conversation with incomplete tool results. The wrapped
  // sendAutomaticallyWhen keeps the SDK from auto-continuing first, so the
  // queued text rides in the same request as the tool results (steering).
  useEffect(() => {
    if (status !== 'ready' || queuedMessages.length === 0 || !chatReady) return
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant') {
      const pending = last.parts.some((part) => {
        const p = part as unknown as ToolPart
        return (
          typeof p.type === 'string' &&
          p.type.startsWith('tool-') &&
          p.state !== 'output-available' &&
          p.state !== 'output-error'
        )
      })
      if (pending) return
    }
    const [next, ...rest] = queuedMessages
    setQueuedMessages(rest)
    recoveryRetries.current = 0
    forceCanvasAction.current = false
    dispatchPrompt.current(next)
  }, [status, messages, queuedMessages, chatReady])

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
    if (chatReady && active) composerRef.current?.focus()
  }, [chatReady, active])

  const mentionQuery = activeMentionQuery(input, caret)
  const mentionOpen = Boolean(mentionQuery && mentionDismissedStart !== mentionQuery.start)
  const mentionItems = mentionOpen && mentionQuery
    ? filterMentionItems(
        composerMentionItems({
          elements: shapesRef.current,
          assets: mentionAssets,
          repos: mentionRepos,
          selectedIds: selectedIdsRef?.current ?? [],
          preferredRepo,
        }),
        mentionQuery.query,
      )
    : []

  useEffect(() => {
    let cancelled = false
    void fetchMentionRemotes(docId).then((remote) => {
      if (cancelled) return
      setMentionAssets(remote.assets)
      setMentionRepos(remote.repos)
      setPreferredRepo(remote.preferredRepo)
    })
    return () => {
      cancelled = true
    }
  }, [docId])

  // Light refresh when @ opens so newly uploaded assets / relinks appear —
  // without re-hitting the full GitHub repository list every keystroke session.
  const mentionOpenRef = useRef(false)
  useEffect(() => {
    const opened = mentionOpen && !mentionOpenRef.current
    mentionOpenRef.current = mentionOpen
    if (!opened) return

    let cancelled = false
    void refreshMentionLocals(docId).then((remote) => {
      if (cancelled) return
      setMentionAssets(remote.assets)
      setPreferredRepo(remote.preferredRepo)
    })
    return () => {
      cancelled = true
    }
  }, [mentionOpen, docId])

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery?.start, mentionQuery?.query])

  // Keep apply/Escape dismiss until that @ is deleted so arrowing back into a
  // completed `@Label` does not reopen the menu and steal Enter.
  useEffect(() => {
    if (mentionDismissedStart === null) return
    if (input[mentionDismissedStart] !== '@') setMentionDismissedStart(null)
  }, [input, mentionDismissedStart])

  const applyMention = (item: MentionItem) => {
    if (!mentionQuery) return
    const start = mentionQuery.start
    const next = insertMention(input, start, caret, item.label)
    setInput(next.text)
    setCaret(next.caret)
    setTrackedMentions((current) => [...current, item])
    // insert leaves caret after `@Label `; activeMentionQuery would still
    // match that span and keep the menu open / steal Enter — dismiss it.
    setMentionDismissedStart(start)
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  const syncCaret = (el: HTMLTextAreaElement) => {
    const next = el.selectionStart ?? el.value.length
    setCaret((prev) => (prev === next ? prev : next))
  }

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

  // Load this chat's stored messages once on mount; the session is keyed by
  // chatId so a chat switch mounts a fresh session instead of resetting state.
  useEffect(() => {
    let cancelled = false
    orpc.chat
      .get({ id: chatId })
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
  }, [chatId, setMessages])

  useEffect(() => {
    if (!chatReady) return
    const timeout = window.setTimeout(() => {
      void orpc.chat
        .save({
          id: chatId,
          title: titleRef.current,
          messages: sanitizeChatMessagesForStorage(messages),
        })
        .catch((error) => console.error('[chat] Failed to save chat:', error))
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [chatId, chatReady, messages])

  useEffect(() => {
    if (!chatReady) return
    return () => {
      void orpc.chat
        .save({
          id: chatId,
          title: titleRef.current,
          messages: sanitizeChatMessagesForStorage(messagesRef.current),
        })
        .catch((error) => console.error('[chat] Failed to save chat:', error))
    }
  }, [chatId, chatReady])

  const answerQuestion = useCallback((toolCallId: string, answer: string) => {
    addToolOutputRef.current({
      tool: 'askQuestion',
      toolCallId,
      output: { answer },
    } as Parameters<typeof addToolOutput>[0])
  }, [])

  const resolveDelete = useCallback((toolCallId: string, allow: boolean, id: string) => {
    let output: unknown
    const target = shapesRef.current.find((s) => s.id === id)
    if (!allow) {
      output = { deleted: false, reason: 'User declined the deletion' }
    } else {
      const ok = actions.deleteElement(id)
      output = ok ? { deleted: true, id, name: target?.name } : { error: 'No such element' }
    }
    addToolOutputRef.current({
      tool: 'deleteElement',
      toolCallId,
      output,
    } as Parameters<typeof addToolOutput>[0])
  }, [actions, shapesRef])

  // Hidden sessions keep every hook (the useChat loop, tool execution,
  // persistence) alive; only the visible chrome is skipped.
  if (!active) return null

  return (
    <>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Direct the canvas"
              description='Try "add a title that says Hello" or "make three blue squares in a row".'
            />
          )}
          {messages.map((message, index) => (
            <ChatMessageRow
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
              streaming={
                index === messages.length - 1 &&
                (status === 'streaming' || status === 'submitted')
              }
              shapesRef={shapesRef}
              onAnswer={answerQuestion}
              onResolveDelete={resolveDelete}
            />
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

      <div className="relative border-t p-3">
        {mentionOpen && mentionItems.length > 0 ? (
          <MentionMenu
            items={mentionItems}
            activeIndex={mentionIndex}
            onSelect={applyMention}
            onHover={setMentionIndex}
          />
        ) : null}
        {queuedMessages.length > 0 && (
          <div className="mb-2 flex flex-col gap-1" aria-label="Queued messages">
            {queuedMessages.map((text, index) => (
              <div
                key={`${index}-${text.slice(0, 24)}`}
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
              >
                <Spinner className="size-3 shrink-0 opacity-50" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{text}</span>
                <button
                  type="button"
                  aria-label="Remove queued message"
                  className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    setQueuedMessages((queue) => queue.filter((_, i) => i !== index))
                  }
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {targetBlocked ? (
          <div
            role="note"
            className="mb-2 rounded-lg border border-cx-accent/20 bg-cx-accent/8 p-2.5"
          >
            <p className="text-xs font-medium">
              Another agent is already working on {targetName}.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Start from the latest Main canvas to keep both agents isolated.
            </p>
            {onCreateBranchChat ? (
              <Button
                size="xs"
                variant="outline"
                className="mt-2"
                onClick={onCreateBranchChat}
              >
                <GitBranchPlusIcon />
                Start in a new branch…
              </Button>
            ) : null}
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
          onError={({ message }) => setStallError(message)}
          onSubmit={async ({ text, files }) => {
            const trimmed = text.trim()
            if ((!trimmed && files.length === 0) || !chatReady) return
            if (targetBlocked || targetReadOnly) {
              setStallError(
                targetReadOnly
                  ? 'This branch is read-only. Choose Main or an active branch to make changes.'
                  : `Another agent is already working on ${targetName}. Start a new branch to work in parallel.`,
              )
              return
            }
            if ((status === 'streaming' || status === 'submitted') && files.length > 0) {
              setStallError('Wait for the current run to finish before sending attachments.')
              throw new Error('Attachments cannot be queued during an active run.')
            }
            const outbound = trimmed
              ? trimmed + mentionSuffix(trimmed, trackedMentions)
              : ''
            setInput('')
            setCaret(0)
            setTrackedMentions([])
            setMentionDismissedStart(null)
            if (status === 'streaming' || status === 'submitted') {
              // Busy: queue instead of send. Delivered at the next step
              // boundary (steering) or when the run finishes (next turn).
              setQueuedMessages((queue) => [...queue, outbound])
              return
            }
            forceCanvasAction.current = false
            dispatchPrompt.current(outbound, files)
          }}
        >
          <ComposerAttachmentTray />
          <PromptInputTextarea
            ref={composerRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              syncCaret(e.target)
            }}
            onClick={(e) => syncCaret(e.currentTarget)}
            onSelect={(e) => syncCaret(e.currentTarget)}
            onKeyUp={(e) => syncCaret(e.currentTarget)}
            onKeyDown={(e) => {
              if (!mentionOpen || mentionItems.length === 0) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionIndex((index) => (index + 1) % mentionItems.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex(
                  (index) => (index - 1 + mentionItems.length) % mentionItems.length,
                )
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                const item = mentionItems[mentionIndex]
                if (item) applyMention(item)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                if (mentionQuery) setMentionDismissedStart(mentionQuery.start)
              }
            }}
            placeholder={
              !chatReady
                ? 'Loading chat…'
                : targetReadOnly
                  ? 'This branch is read-only…'
                  : targetBlocked
                  ? `Another agent is working on ${targetName}…`
                : status === 'streaming' || status === 'submitted'
                  ? 'Steer the agent — Enter queues your message…'
                  : 'Describe a change… (@ to mention)'
            }
            disabled={!chatReady || targetBlocked || targetReadOnly}
            className="w-full"
          />
          <PromptInputFooter>
            <div className="flex items-center gap-1">
              <ComposerAttachmentButton disabled={!chatReady || busy} />
              <ModelPicker
                model={model}
                chatGPTModels={chatGPTModels}
                chatGPTModelsError={chatGPTModelsError}
                loadingChatGPTModels={loadingChatGPTModels}
                onLoadChatGPTModels={loadChatGPTModels}
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
              onStop={() => stop()}
              chatReady={chatReady}
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
        const label = file.filename || (file.mediaType.startsWith('image/') ? 'Pasted image' : 'File')
        return (
          <div
            key={file.id}
            className="group/attachment relative flex min-w-0 max-w-44 items-center gap-2 rounded-md border bg-muted/40 p-1.5 pr-7 text-xs"
          >
            {file.mediaType.startsWith('image/') ? (
              <img
                src={file.url}
                alt={label}
                className="size-9 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex size-9 shrink-0 items-center justify-center rounded bg-background">
                <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
              </div>
            )}
            <span className="truncate" title={label}>{label}</span>
            <button
              type="button"
              aria-label={`Remove ${label}`}
              className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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

function ReasoningEffortPicker({
  effort,
  onChange,
}: {
  effort: ChatGPTReasoningEffort
  onChange: (effort: ChatGPTReasoningEffort) => void
}) {
  const index = CHATGPT_REASONING_EFFORTS.findIndex((option) => option.id === effort)
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
      <PopoverContent side="top" align="start" sideOffset={8} className="w-64">
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
                data-testid="reasoning-effort-stops"
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
                stop === 0 && 'text-left',
                stop === CHATGPT_REASONING_EFFORTS.length - 1 && 'text-right',
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
  onModelChange,
}: {
  model: string
  chatGPTModels: string[] | null
  chatGPTModelsError: 'disconnected' | 'failed' | null
  loadingChatGPTModels: boolean
  onLoadChatGPTModels: () => Promise<void>
  onModelChange: (model: string) => void
}) {
  const standardModels = MODELS.filter(({ provider }) => provider !== 'chatgpt')
  const availableChatGPTModels = MODELS.filter(
    ({ provider, modelId }) => provider === 'chatgpt' && chatGPTModels?.includes(modelId),
  )

  return (
    <DropdownMenu onOpenChange={(open) => open && void onLoadChatGPTModels()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs leading-none text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>{modelLabel(model)}</span>
          <ChevronDownIcon className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Model</DropdownMenuLabel>
        {standardModels.map(({ id, label, provider }) => (
          <DropdownMenuItem key={id} onSelect={() => onModelChange(id)}>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-xs text-muted-foreground">{PROVIDERS[provider].label}</span>
            {model === id && <CheckIcon className="text-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {availableChatGPTModels.map(({ id, label, provider }) => (
          <DropdownMenuItem key={id} onSelect={() => onModelChange(id)}>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-xs text-muted-foreground">{PROVIDERS[provider].label}</span>
            {model === id && <CheckIcon className="text-foreground" />}
          </DropdownMenuItem>
        ))}
        {availableChatGPTModels.length === 0 ? (
          <DropdownMenuItem disabled>
            {loadingChatGPTModels || chatGPTModels === null
              ? 'Checking ChatGPT…'
              : chatGPTModelsError === 'disconnected'
                ? 'Reconnect ChatGPT in Settings'
                : chatGPTModelsError === 'failed'
                  ? 'Could not load ChatGPT models'
                  : 'GPT-5.6 Sol unavailable on this account'}
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
  output?: Record<string, unknown>
  errorText?: string
  preliminary?: boolean
}

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
  if (name === 'arrangeElements') {
    const changes = (input.changes as unknown[] | undefined)?.length ?? 0
    return `${changes} element${changes === 1 ? '' : 's'}`
  }
  if (name === 'searchCanvas') {
    return String(input.query ?? '')
  }
  if (name === 'reorderElements') {
    const count = (input.orderedIds as unknown[] | undefined)?.length ?? 0
    return `${count} element${count === 1 ? '' : 's'}`
  }
  if (name === 'groupElements' || name === 'ungroupElements') {
    const count = (input.ids as unknown[] | undefined)?.length ?? 0
    return `${count} element${count === 1 ? '' : 's'}`
  }
  if (name === 'listGitHubRepositories') {
    return String(input.query ?? 'all accessible repositories')
  }
  if (name === 'listRepositoryTree') {
    return `${String(input.repository ?? 'repository')} · ${String(input.pathPrefix ?? 'root')}`
  }
  if (name === 'searchRepositoryCode') {
    return `${String(input.repository ?? 'repository')} · ${String(input.query ?? '')}`
  }
  if (name === 'readRepositoryFile' || name === 'viewRepositoryImage') {
    return `${String(input.repository ?? 'repository')} · ${String(input.path ?? '')}`
  }
  const target = elements.find((s) => s.id === input.id)
  if (name === 'readElement' || name === 'readElementLogs' || name === 'viewElement') {
    return describeElement(target) || String(input.id ?? '')
  }
  if (name === 'updateElement') {
    const changed = Object.keys(input)
      .filter((k) => k !== 'id')
      .join(', ')
    return `${describeElement(target) || String(input.id ?? '')} · ${changed}`
  }
  if (name === 'editElement') {
    const edits = (input.edits as unknown[] | undefined)?.length ?? 0
    return `${describeElement(target) || String(input.id ?? '')} · ${edits} edit${edits === 1 ? '' : 's'}`
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
  | { kind: 'file'; part: FileUIPart }
  | { kind: 'reasoning' }
  | { kind: 'tools'; parts: ToolPart[] }
  | { kind: 'question'; part: ToolPart }

function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  const reduceMotion = useReducedMotion()
  const tokens = useMemo(() => text.match(/\S+\s*|\s+/g) ?? [], [text])

  if (!streaming || reduceMotion) return <span>{text}</span>

  return (
    <span>
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

/** User bubbles: hide the machine mention suffix and chip surviving @labels. */
function UserMessageText({ text }: { text: string }) {
  const { body, suffix } = stripMentionSuffix(text)
  const mentions = suffix ? parseMentionSuffix(suffix) : []
  const segments = mentions.length > 0 ? segmentMentionText(body, mentions) : null

  if (!segments) {
    // Parse failed or no mentions — still never show the raw suffix.
    return <span className="whitespace-pre-wrap">{body}</span>
  }

  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <MentionChip key={index} kind={segment.item.kind} label={segment.item.label} />
        ),
      )}
    </span>
  )
}

function ChatFileAttachment({ file }: { file: FileUIPart }) {
  const label = file.filename || (file.mediaType.startsWith('image/') ? 'Image' : 'File')

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
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate text-xs">{label}</span>
    </div>
  )
}

// Group consecutive tool calls so a burst of 20 creates reads as one line.
// Questions stay standalone - they need their own interactive card.
function toBlocks(parts: { type: string }[]): Block[] {
  const blocks: Block[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ kind: 'text', text: (part as unknown as { text: string }).text })
    } else if (part.type === 'file') {
      blocks.push({ kind: 'file', part: part as FileUIPart })
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

export const ChatMessageRow = memo(function ChatMessageRow({
  message,
  isLast,
  streaming,
  shapesRef,
  onAnswer,
  onResolveDelete,
  onRenderMeasure,
}: {
  message: UIMessage
  isLast: boolean
  streaming: boolean
  shapesRef: React.RefObject<CanvasElement[]>
  onAnswer: (toolCallId: string, answer: string) => void
  onResolveDelete: (toolCallId: string, allow: boolean, id: string) => void
  onRenderMeasure?: () => void
}) {
  onRenderMeasure?.()
  const blocks = useMemo(() => toBlocks(message.parts), [message.parts])
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
          ) : block.kind === 'question' ? (
            <QuestionCard key={index} part={block.part} onAnswer={onAnswer} />
          ) : (
            <ToolGroup
              key={index}
              parts={block.parts}
              shapesRef={shapesRef}
              onResolveDelete={onResolveDelete}
            />
          ),
        )}
      </MessageContent>
    </Message>
  )
})

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
  editElement: 'Edited',
  arrangeElements: 'Arranged',
  reorderElements: 'Reordered',
  groupElements: 'Grouped',
  ungroupElements: 'Ungrouped',
  searchCanvas: 'Searched',
  readElementLogs: 'Read logs from',
  viewElement: 'Inspected',
  deleteElement: 'Deleted',
  readElement: 'Read',
  loadSkill: 'Loaded skill',
  viewCanvas: 'Verified',
  listGitHubRepositories: 'Listed',
  listRepositoryTree: 'Browsed',
  searchRepositoryCode: 'Searched',
  readRepositoryFile: 'Read',
  viewRepositoryImage: 'Viewed',
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
              <XIcon aria-label="Tool failed" className="size-3.5 text-destructive-foreground" />
            ) : busy ? (
              <Spinner aria-label="Tool in progress" className="size-3.5 text-cx-accent" />
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
            <XIcon aria-label="Tool failed" className="size-3.5 text-destructive-foreground" />
          ) : denied ? (
            <span className="text-[11px] text-muted-foreground">denied</span>
          ) : done ? (
            <CheckIcon className="size-3.5 text-muted-foreground" />
          ) : awaitingConfirm ? null : (
            <Spinner aria-label="Tool in progress" className="size-3.5 text-cx-accent" />
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
