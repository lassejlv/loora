/**
 * What the editor and the chat endpoint agree on. Nothing here imports a
 * runtime — the popup and the route both read these names, and neither pulls
 * the AI SDK in to do it.
 */

/**
 * The tools the in-app agent may call. A strict subset of the MCP catalog:
 * everything that reads or writes the open document, and nothing that could
 * reach a different design, a branch lifecycle, or billing.
 */
export const ASSISTANT_TOOL_NAMES = [
  'getDesignContext',
  'readTree',
  'readNode',
  'searchNodes',
  'listAssets',
  'createPage',
  'insertNodes',
  'patchNodes',
  'moveNodes',
  'deleteNodes',
  'createComponent',
  'createInstance',
  'setTokens',
  'setAnimations',
  'animateNodes',
  'viewNode',
  'viewPage',
  'viewCanvas',
  'getScreenshot',
] as const

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number]

/**
 * Deliberately the same wording as the realtime agent badge
 * (`packages/rpc/src/mcp-agent-activity.ts`), so the ring on the canvas and the
 * line in the chat box never disagree about what is happening.
 */
export const ASSISTANT_TOOL_LABELS: Record<AssistantToolName, string> = {
  getDesignContext: 'Reading the design',
  readTree: 'Reading the layers',
  readNode: 'Inspecting a layer',
  searchNodes: 'Searching the canvas',
  listAssets: 'Reading assets',
  createPage: 'Adding a page',
  insertNodes: 'Adding elements',
  patchNodes: 'Editing elements',
  moveNodes: 'Moving elements',
  deleteNodes: 'Deleting elements',
  createComponent: 'Creating a component',
  createInstance: 'Placing a component',
  setTokens: 'Updating tokens',
  setAnimations: 'Defining animations',
  animateNodes: 'Animating elements',
  viewNode: 'Looking at a layer',
  viewPage: 'Looking at a page',
  viewCanvas: 'Looking at the canvas',
  getScreenshot: 'Taking a screenshot',
}

/**
 * Canvas invariant: destructive agent actions are confirmed in product UX.
 * These tools pause for approval instead of running straight through.
 */
export const ASSISTANT_APPROVAL_TOOLS: readonly AssistantToolName[] = [
  'deleteNodes',
]

export function isAssistantToolName(value: string): value is AssistantToolName {
  return (ASSISTANT_TOOL_NAMES as readonly string[]).includes(value)
}

export function assistantToolLabel(name: string) {
  return isAssistantToolName(name) ? ASSISTANT_TOOL_LABELS[name] : 'Working'
}

export interface AssistantTarget {
  designId: string
  draftId: string | null
}

/** Why a run could not start. The editor turns each into one plain sentence. */
export type AssistantErrorCode =
  | 'CHATGPT_NOT_CONFIGURED'
  | 'CHATGPT_NOT_CONNECTED'
  | 'CHATGPT_RECONNECT_REQUIRED'
  | 'PROVIDER_ERROR'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'

export interface AssistantErrorBody {
  error: string
  code: AssistantErrorCode
}

/** The slash command that starts the ChatGPT connection from the chat box. */
export const CHATGPT_LOGIN_COMMAND = '/login-with-chatgpt'
export const CHATGPT_LOGOUT_COMMAND = '/logout-chatgpt'

export const CHATGPT_MODELS = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
] as const

export type ChatGptModel = (typeof CHATGPT_MODELS)[number]['id']

export const CHATGPT_REASONING_EFFORTS = [
  { id: 'low', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Xhigh' },
  { id: 'max', label: 'Max' },
] as const

export type ChatGptReasoningEffort =
  (typeof CHATGPT_REASONING_EFFORTS)[number]['id']

export const DEFAULT_CHATGPT_MODEL: ChatGptModel = 'gpt-5.6-terra'
export const DEFAULT_CHATGPT_REASONING_EFFORT: ChatGptReasoningEffort = 'medium'

export function chatGptModel(value: unknown): ChatGptModel | undefined {
  return CHATGPT_MODELS.find((model) => model.id === value)?.id
}

export function chatGptReasoningEffort(
  value: unknown,
): ChatGptReasoningEffort | undefined {
  return CHATGPT_REASONING_EFFORTS.find((effort) => effort.id === value)?.id
}
