/**
 * Last-known access verdicts (preview access, active subscription) cached per
 * user so returning users mount the editor immediately instead of watching the
 * gate dialogs flash while the checks re-run. The server re-verifies on every
 * load and enforces access on every RPC regardless, so a stale optimistic
 * verdict only ever shows UI — it can't grant real access.
 */

const key = (gate: string, userId: string) => `loora:access:${gate}:${userId}`

export function readAccessVerdict(gate: string, userId: string): boolean {
  try {
    return window.localStorage.getItem(key(gate, userId)) === '1'
  } catch {
    return false
  }
}

export function writeAccessVerdict(gate: string, userId: string, granted: boolean) {
  try {
    if (granted) window.localStorage.setItem(key(gate, userId), '1')
    else window.localStorage.removeItem(key(gate, userId))
  } catch {
    // Storage unavailable (private mode) — verdicts just aren't cached.
  }
}
