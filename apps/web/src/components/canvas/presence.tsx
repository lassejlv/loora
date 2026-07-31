import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCanvasSelection } from '@loora/canvas/react'
import type { CanvasPeer } from '#/lib/canvas-client'
import type { CanvasEditorController } from './editor'
import { cn } from '@loora/ui/utils'

const EMPTY_PEERS: CanvasPeer[] = []

export interface PresenceCamera {
  x: number
  y: number
  zoom: number
}

function usePeers(controller: CanvasEditorController) {
  const empty = EMPTY_PEERS
  // Presence has its own channel: subscribing to the document store here woke
  // every panel in the editor on each cursor frame.
  const subscribe = controller.subscribePresence ?? controller.subscribe
  return useSyncExternalStore(
    subscribe,
    () => controller.peers ?? empty,
    () => controller.peers ?? empty,
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase()
}

/**
 * Sends this person's pointer and selection to everyone else. The pointer is
 * reported in scene coordinates so each viewer places it under their own
 * camera — a peer zoomed out sees the cursor over the same node, not the same
 * pixel.
 */
function useBroadcastPresence(
  controller: CanvasEditorController,
  surfaceRef: { current: HTMLElement | null },
) {
  const selection = useCanvasSelection()

  useEffect(() => {
    controller.publishPresence?.({
      selection: selection.map((ref) => ref.nodeId),
    })
  }, [controller, selection])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const scene = () =>
      surface.querySelector<HTMLElement>('[data-loora-canvas-scene]')
    const onMove = (event: PointerEvent) => {
      const element = scene()
      if (!element) return
      const rect = element.getBoundingClientRect()
      const zoom = rect.width === 0 ? 1 : rect.width / element.offsetWidth || 1
      controller.publishPresence?.({
        cursor: {
          x: (event.clientX - rect.left) / zoom,
          y: (event.clientY - rect.top) / zoom,
        },
      })
    }
    const onLeave = () => controller.publishPresence?.({ cursor: null })
    surface.addEventListener('pointermove', onMove)
    surface.addEventListener('pointerleave', onLeave)
    return () => {
      surface.removeEventListener('pointermove', onMove)
      surface.removeEventListener('pointerleave', onLeave)
    }
  }, [controller, surfaceRef])
}

function PeerCursor({
  peer,
  camera,
}: {
  peer: CanvasPeer
  camera: PresenceCamera
}) {
  if (!peer.cursor) return null
  const left = peer.cursor.x * camera.zoom + camera.x
  const top = peer.cursor.y * camera.zoom + camera.y
  return (
    <div
      className="pointer-events-none absolute z-30 will-change-transform"
      style={{
        transform: `translate3d(${left}px, ${top}px, 0)`,
        transition: 'transform 90ms linear',
      }}
    >
      <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true">
        <path
          d="M1 1l12 9-5.2.9L11 18.5 8.4 19.6 5.6 13 1 16z"
          fill={peer.color}
          stroke="#fff"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="ms-3 -mt-1 inline-block max-w-40 truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
        style={{ backgroundColor: peer.color }}
      >
        {peer.name}
      </span>
    </div>
  )
}

/**
 * What each peer has selected, measured off the rendered nodes rather than
 * recomputed from geometry, so it lines up with whatever the canvas is
 * currently showing.
 */
function PeerSelection({
  peers,
  camera,
  surfaceRef,
}: {
  peers: CanvasPeer[]
  camera: PresenceCamera
  surfaceRef: { current: HTMLElement | null }
}) {
  const [boxes, setBoxes] = useState<
    { key: string; color: string; name: string; rect: DOMRect }[]
  >([])
  const selectionKey = peers
    .map((peer) => `${peer.sessionId}:${peer.color}:${peer.selection.join(',')}`)
    .join('|')

  const peersRef = useRef(peers)
  peersRef.current = peers

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    let frame = 0
    const measure = () => {
      const surfaceRect = surface.getBoundingClientRect()
      const next: { key: string; color: string; name: string; rect: DOMRect }[] =
        []
      for (const peer of peersRef.current) {
        for (const nodeId of peer.selection.slice(0, 12)) {
          const element = surface.querySelector<HTMLElement>(
            `[data-loora-node="${CSS.escape(nodeId)}"]`,
          )
          if (!element) continue
          const rect = element.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) continue
          next.push({
            key: `${peer.sessionId}:${nodeId}`,
            color: peer.color,
            name: peer.name,
            rect: new DOMRect(
              rect.left - surfaceRect.left,
              rect.top - surfaceRect.top,
              rect.width,
              rect.height,
            ),
          })
        }
      }
      setBoxes(next)
    }
    frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `peers` is read
    // through `selectionKey`, which changes only when a selection does.
  }, [selectionKey, camera, surfaceRef])

  return (
    <>
      {boxes.map((box) => (
        <div
          key={box.key}
          className="pointer-events-none absolute z-20 rounded-[3px]"
          style={{
            left: box.rect.x,
            top: box.rect.y,
            width: box.rect.width,
            height: box.rect.height,
            outline: `1.5px solid ${box.color}`,
            backgroundColor: `${box.color}14`,
          }}
        />
      ))}
    </>
  )
}

export function CanvasCollaboratorPresence({
  controller,
  camera,
  surfaceRef,
}: {
  controller: CanvasEditorController
  camera: PresenceCamera
  surfaceRef: { current: HTMLElement | null }
}) {
  const peers = usePeers(controller)
  useBroadcastPresence(controller, surfaceRef)
  if (peers.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <PeerSelection peers={peers} camera={camera} surfaceRef={surfaceRef} />
      {peers.map((peer) => (
        <PeerCursor key={peer.sessionId} peer={peer} camera={camera} />
      ))}
    </div>
  )
}

/** Who else is in the document. One face per person, not per tab. */
export function CanvasPresenceFacePile({
  controller,
  className,
}: {
  controller: CanvasEditorController
  className?: string
}) {
  const peers = usePeers(controller)
  const unique = peers.filter(
    (peer, index) =>
      peers.findIndex((other) => other.userId === peer.userId) === index,
  )
  if (unique.length === 0) return null
  return (
    <div className={cn('flex items-center -space-x-1.5', className)}>
      {unique.slice(0, 5).map((peer) => (
        <span
          key={peer.userId}
          title={`${peer.name}${peer.role === 'view' ? ' (viewing)' : ''}`}
          className="grid size-6 place-items-center overflow-hidden rounded-full border border-surface text-[10px] font-medium text-white"
          style={{ backgroundColor: peer.color }}
        >
          {peer.image ? (
            <img
              src={peer.image}
              alt=""
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            initials(peer.name)
          )}
        </span>
      ))}
      {unique.length > 5 ? (
        <span className="grid size-6 place-items-center rounded-full border border-surface bg-muted text-[10px] font-medium text-muted-foreground">
          +{unique.length - 5}
        </span>
      ) : null}
    </div>
  )
}

export function useSurfaceRef() {
  return useRef<HTMLElement | null>(null)
}
