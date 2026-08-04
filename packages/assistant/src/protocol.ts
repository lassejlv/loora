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

export const ASSISTANT_CONNECT_PATH = '/api/chatgpt/connect'

export function chatgptConnectUrl(returnTo?: string) {
  const params = returnTo
    ? `?returnTo=${encodeURIComponent(returnTo)}`
    : ''
  return `${ASSISTANT_CONNECT_PATH}${params}`
}
