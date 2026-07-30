import {
  canvasRealtimeChannel,
  isCanvasPresencePeer,
  isCanvasRealtimeActivity,
  parseCanvasRealtimeEvent,
  type CanvasPresencePeer,
  type CanvasRealtimeActivity,
  type CanvasRealtimeEventInput,
  type CanvasRealtimeTarget,
} from '@loora/realtime/events'
import type { RealtimeRoomState } from '@loora/realtime/ingest'
import type { RealtimeBus } from './bus'

export type Deliver = (channel: string, payload: string) => void

/**
 * Rooms.
 *
 * A channel is subscribed on the bus once, no matter how many sockets in this
 * process are watching it, and dropped again when the last one leaves. Every
 * event a room produces goes out on the bus and comes back through that single
 * subscription, so an instance never has to decide whether a message is its own
 * — local sockets and remote instances are fed by exactly the same path.
 */
export class RealtimeHub {
  #bus: RealtimeBus
  #deliver: Deliver
  #rooms = new Map<string, number>()

  constructor(bus: RealtimeBus, deliver: Deliver) {
    this.#bus = bus
    this.#deliver = deliver
  }

  get bus() {
    return this.#bus
  }

  get roomCount() {
    return this.#rooms.size
  }

  channelFor(ownerUserId: string, target: CanvasRealtimeTarget) {
    return canvasRealtimeChannel(ownerUserId, target)
  }

  async join(channel: string) {
    const watchers = this.#rooms.get(channel) ?? 0
    this.#rooms.set(channel, watchers + 1)
    if (watchers > 0) return
    try {
      await this.#bus.subscribe(channel, (message) => {
        this.#deliver(channel, message)
      })
    } catch (error) {
      this.#rooms.delete(channel)
      throw error
    }
  }

  async leave(channel: string) {
    const watchers = this.#rooms.get(channel) ?? 0
    if (watchers <= 1) {
      this.#rooms.delete(channel)
      await this.#bus.unsubscribe(channel).catch(() => undefined)
      return
    }
    this.#rooms.set(channel, watchers - 1)
  }

  /** Stamps `sentAt`, validates against the wire protocol, then fans out. */
  async publishEvent(channel: string, event: CanvasRealtimeEventInput) {
    const payload = JSON.stringify({ ...event, sentAt: Date.now() })
    if (!parseCanvasRealtimeEvent(payload)) return false
    try {
      return await this.#bus.publish(channel, payload)
    } catch {
      console.error('[loora-ws] could not publish to', channel)
      return false
    }
  }

  async publishPresence(channel: string, peer: CanvasPresencePeer) {
    if (!isCanvasPresencePeer(peer)) return false
    try {
      await this.#bus.writePresence(channel, peer)
    } catch {
      console.error('[loora-ws] could not record presence on', channel)
      return false
    }
    return this.publishEvent(channel, {
      type: 'presence.peer',
      sessionId: peer.sessionId,
      peer,
    })
  }

  async clearPresence(channel: string, sessionId: string) {
    try {
      await this.#bus.clearPresence(channel, sessionId)
    } catch {
      console.error('[loora-ws] could not clear presence on', channel)
    }
    return this.publishEvent(channel, {
      type: 'presence.peer',
      sessionId,
      peer: null,
    })
  }

  async publishActivity(
    channel: string,
    activity: CanvasRealtimeActivity | null,
  ) {
    if (activity && !isCanvasRealtimeActivity(activity)) return false
    try {
      await this.#bus.writeActivity(channel, activity)
    } catch {
      console.error('[loora-ws] could not record agent activity on', channel)
      return false
    }
    return this.publishEvent(channel, { type: 'agent.activity', activity })
  }

  /** The room as it stands, for a socket that just connected. */
  async readState(channel: string): Promise<RealtimeRoomState> {
    const [peers, activity] = await Promise.all([
      this.#bus.readPresence(channel).catch(() => []),
      this.#bus.readActivity(channel).catch(() => null),
    ])
    return { peers, activity }
  }
}
