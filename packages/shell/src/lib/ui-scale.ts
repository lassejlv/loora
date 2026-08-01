const STORAGE_KEY = 'loora:ui-scale'

/**
 * Interface scale, applied as the root font size. Everything in the app chrome
 * sizes in rem, so one root value moves type, controls, and spacing together.
 *
 * Canvas documents are unaffected: node geometry is px from the model, and the
 * camera owns document zoom. This scales the editor around the design, not the
 * design.
 */
export const UI_SCALES = [0.9, 1, 1.1, 1.25, 1.5] as const

export type UiScale = (typeof UI_SCALES)[number]

export const DEFAULT_UI_SCALE: UiScale = 1

const MIN = UI_SCALES[0]
const MAX = UI_SCALES[UI_SCALES.length - 1]

function isUiScale(value: number): value is UiScale {
  return (UI_SCALES as readonly number[]).includes(value)
}

/** Snaps a stored or typed value onto the nearest offered step. */
export function normalizeUiScale(value: unknown): UiScale {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return DEFAULT_UI_SCALE
  if (isUiScale(parsed)) return parsed
  const clamped = Math.min(MAX, Math.max(MIN, parsed))
  return UI_SCALES.reduce((best, step) =>
    Math.abs(step - clamped) < Math.abs(best - clamped) ? step : best,
  )
}

export function getUiScale(): UiScale {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    const stored = storage?.getItem(STORAGE_KEY) ?? null
    return stored === null ? DEFAULT_UI_SCALE : normalizeUiScale(stored)
  } catch {
    // Storage can be unavailable in private browsing or blocked contexts.
    return DEFAULT_UI_SCALE
  }
}

export function applyUiScale(scale: UiScale = getUiScale()) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // Default stays unset so the browser's own font-size preference wins.
  if (scale === DEFAULT_UI_SCALE) root.style.removeProperty('font-size')
  else root.style.fontSize = `${Math.round(scale * 100)}%`
}

export function setUiScale(scale: UiScale) {
  try {
    const storage = globalThis.localStorage ?? globalThis.window?.localStorage ?? null
    storage?.setItem(STORAGE_KEY, String(scale))
  } catch {
    // Applying the scale still works when persistence is unavailable.
  }
  applyUiScale(scale)
}

/** Applies the stored scale and keeps other tabs of the app in step. */
export function syncUiScale() {
  applyUiScale()
  if (typeof window === 'undefined') return () => {}
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) applyUiScale()
  }
  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}

// Runs before first paint so a stored scale cannot flash at the default size.
export const UI_SCALE_INIT_SCRIPT = `(()=>{try{const r=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(r===null||r==='')return;const v=Number(r);if(!Number.isFinite(v)||v===${DEFAULT_UI_SCALE})return;const s=Math.min(${MAX},Math.max(${MIN},v));document.documentElement.style.fontSize=Math.round(s*100)+'%'}catch(e){}})()`
