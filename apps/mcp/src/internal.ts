import type { Config } from './config'
import type { FetchImpl } from './env'
import type { JsonValue } from './tools'

export class InternalMcpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InternalMcpError'
  }
}

export type InternalAction =
  | { action: 'ready' }
  | { action: 'access'; userId: string }
  | { action: 'execute'; userId: string; tool: string; arguments: JsonValue }
  | { action: 'resolveUser'; selector: string }

const INTERNAL_TIMEOUT_MS = 120_000

export async function callInternal(
  config: Config,
  body: InternalAction,
  fetchImpl: FetchImpl,
): Promise<JsonValue> {
  let response: Response
  try {
    response = await fetchImpl(config.internalApiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.internalToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(INTERNAL_TIMEOUT_MS),
    })
  } catch {
    throw new InternalMcpError(
      "Loora's MCP execution service is temporarily unavailable.",
    )
  }
  let value: JsonValue
  try {
    value = (await response.json()) as JsonValue
  } catch {
    throw new InternalMcpError(
      "Loora's MCP execution service returned an invalid response.",
    )
  }
  if (response.ok) return value
  const message =
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.error === 'string'
      ? value.error
      : "Loora's MCP execution service rejected the request."
  throw new InternalMcpError(message)
}
