export interface WsConfig {
  port: number
  /**
   * Shared with the web app, which mints the connection tickets. More than one
   * during a rotation: the web app signs with the first, this service still
   * accepts tickets signed with the one being retired.
   */
  ticketSecrets: string[]
  /** Shared with every service that publishes through `POST /publish`. */
  internalToken: string
  /** Absent means single-instance: rooms live in this process only. */
  redisUrl: string | null
  /** Absent means any origin; a browser still needs a valid ticket. */
  allowedOrigins: string[] | null
}

export class WsConfigError extends Error {}

function origins(value: string | undefined) {
  const list = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin
      } catch {
        return entry
      }
    })
  return list.length > 0 ? list : null
}

export function readWsConfig(
  env: Record<string, string | undefined> = process.env,
): WsConfig {
  const ticketSecret = env.REALTIME_TICKET_SECRET?.trim()
  const internalToken = env.REALTIME_INTERNAL_TOKEN?.trim()
  if (!ticketSecret || ticketSecret.length < 32) {
    throw new WsConfigError(
      'REALTIME_TICKET_SECRET must be set to at least 32 characters.',
    )
  }
  if (!internalToken || internalToken.length < 32) {
    throw new WsConfigError(
      'REALTIME_INTERNAL_TOKEN must be set to at least 32 characters.',
    )
  }
  const previousSecret = env.REALTIME_TICKET_SECRET_PREVIOUS?.trim()
  return {
    port: Number(env.PORT ?? 4200),
    ticketSecrets:
      previousSecret && previousSecret !== ticketSecret
        ? [ticketSecret, previousSecret]
        : [ticketSecret],
    internalToken,
    redisUrl: env.REDIS_URL?.trim() || null,
    allowedOrigins:
      origins(env.REALTIME_ALLOWED_ORIGINS) ?? origins(env.BETTER_AUTH_URL),
  }
}
