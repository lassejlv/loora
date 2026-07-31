/**
 * What the service turned away.
 *
 * Rejections are the shape of trouble here: a run of refused tickets is
 * somebody probing, a run of replays is a ticket that leaked, and drops mean a
 * client is talking faster than the room allows. Without a count they are all
 * silent, so `/health` carries them.
 */
export const REJECTION_KINDS = [
  'ticketInvalid',
  'ticketReplayed',
  'originRefused',
  'ingestUnauthorized',
  'ingestInvalid',
  'ingestThrottled',
  'messagesDropped',
  'socketsEvicted',
] as const

export type RejectionKind = (typeof REJECTION_KINDS)[number]

export type Rejections = Record<RejectionKind, number>

export interface Counters {
  count: (kind: RejectionKind) => void
  snapshot: () => Rejections
}

export function createCounters(): Counters {
  const counts = Object.fromEntries(
    REJECTION_KINDS.map((kind) => [kind, 0]),
  ) as Rejections
  return {
    count: (kind) => {
      counts[kind] += 1
    },
    snapshot: () => ({ ...counts }),
  }
}
