import type { ServerWebSocket } from 'bun'
import type { RealtimeTicketClaims } from '@loora/realtime/ticket'
import type { Counters } from './counters'

export interface SocketData {
  channel: string
  claims: RealtimeTicketClaims
  /** When this socket must re-authenticate with a fresh ticket. */
  closeAt: number
  allow: (now?: number) => boolean
}

export type Socket = ServerWebSocket<SocketData>

/** One account, many tabs — but not unbounded. The oldest socket gives way. */
export const CLOSE_TOO_MANY = 4002
export const MAX_SOCKETS_PER_USER = 20

/**
 * Who is connected, indexed the two ways this service asks the question: by
 * account, to keep one person from holding the place open with unbounded
 * sockets, and by room, to hand a message to everyone in it except the socket
 * that sent it.
 */
export class Connections {
  #counters: Counters
  #all = new Set<Socket>()
  #byUser = new Map<string, Set<Socket>>()
  #byChannel = new Map<string, Set<Socket>>()

  constructor(counters: Counters) {
    this.#counters = counters
  }

  get size() {
    return this.#all.size
  }

  get all(): Iterable<Socket> {
    return this.#all
  }

  room(channel: string): Iterable<Socket> {
    return this.#byChannel.get(channel) ?? []
  }

  /**
   * Registers a socket and closes the account's oldest ones if it is now over
   * the cap. The newest tab is the one somebody is looking at, so it stays.
   */
  add(socket: Socket) {
    this.#all.add(socket)

    const mine = this.#byUser.get(socket.data.claims.userId) ?? new Set<Socket>()
    mine.add(socket)
    this.#byUser.set(socket.data.claims.userId, mine)
    for (const oldest of mine) {
      if (mine.size <= MAX_SOCKETS_PER_USER) break
      mine.delete(oldest)
      this.#counters.count('socketsEvicted')
      oldest.close(CLOSE_TOO_MANY, 'Too many connections')
    }

    const room = this.#byChannel.get(socket.data.channel) ?? new Set<Socket>()
    room.add(socket)
    this.#byChannel.set(socket.data.channel, room)
  }

  remove(socket: Socket) {
    this.#all.delete(socket)

    const mine = this.#byUser.get(socket.data.claims.userId)
    if (mine) {
      mine.delete(socket)
      if (mine.size === 0) this.#byUser.delete(socket.data.claims.userId)
    }

    const room = this.#byChannel.get(socket.data.channel)
    if (room) {
      room.delete(socket)
      if (room.size === 0) this.#byChannel.delete(socket.data.channel)
    }
  }

  /** Sockets past their ticket's life, which reconnect with a fresh one. */
  expired(now: number) {
    return [...this.#all].filter((socket) => socket.data.closeAt <= now)
  }
}
