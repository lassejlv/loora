import { createContext, useContext } from 'react'

/**
 * The landing pages paint their own wireframe colors instead of leaning on the
 * app tokens: the demo has to read as *canvas*, not as chrome, and its greys
 * are tuned against each other rather than against the editor surfaces.
 */
export type Palette = {
  accent: string
  accentSoft: string
  accentFaint: string
  accentWire: string
  wireStrong: string
  wireMid: string
  wireSoft: string
  surface: string
  tint: string
  line: string
  dot: string
  page: string
  ok: string
  dotAccent: string
  glow: string
  /** Text that sits on the accent — dark mode's accent is light, so it isn't white. */
  accentInk: string
}

export const LIGHT: Palette = {
  accent: '#1e3dea',
  accentSoft: 'rgba(30,61,234,0.10)',
  accentFaint: 'rgba(30,61,234,0.05)',
  accentWire: 'rgba(30,61,234,0.35)',
  wireStrong: '#c6c6c6',
  wireMid: '#d2d2d2',
  wireSoft: '#dedede',
  surface: '#ffffff',
  tint: '#f4f4f2',
  line: '#e4e4e2',
  dot: '#d3d1c9',
  page: '#fafaf8',
  ok: '#059669',
  dotAccent: 'rgba(30,61,234,0.34)',
  // Neutral on purpose: an accent-tinted wash reads as a blue shadow behind the hero.
  glow: 'rgba(26,25,23,0.05)',
  accentInk: '#ffffff',
}

export const PaletteContext = createContext<Palette>(LIGHT)

export const usePalette = () => useContext(PaletteContext)
