export type ShapeType = 'rect' | 'ellipse' | 'text' | 'frame' | 'image' | 'component'

export interface Shape {
  id: string
  type: ShapeType
  x: number
  y: number
  w: number
  h: number
  fill: string
  stroke?: string
  strokeWidth?: number
  radius?: number
  opacity?: number
  text?: string
  fontSize?: number
  fontWeight?: number
  align?: 'left' | 'center' | 'right'
  src?: string // image shapes: URL, usually /api/asset/{id}
  code?: string // component shapes: JSX source defining function App()
}

let measureCtx: CanvasRenderingContext2D | null = null

function measure(text: string, fontSize: number, fontWeight: number) {
  if (typeof document === 'undefined') return text.length * fontSize * 0.55
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  measureCtx.font = `${fontWeight} ${fontSize}px Archivo, sans-serif`
  return measureCtx.measureText(text).width
}

// Split a text shape's content into lines: hard newlines plus soft wrap at box width.
export function layoutText(s: Shape): string[] {
  const fontSize = s.fontSize ?? 20
  const fontWeight = s.fontWeight ?? 400
  const lines: string[] = []
  for (const hard of (s.text ?? '').split('\n')) {
    const words = hard.split(' ')
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && measure(candidate, fontSize, fontWeight) > s.w) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

export const LINE_HEIGHT = 1.3

// Frames render behind everything else, in insertion order within each band.
export function renderOrder(shapes: Shape[]): Shape[] {
  return [...shapes.filter((s) => s.type === 'frame'), ...shapes.filter((s) => s.type !== 'frame')]
}

export const PALETTE = [
  '#1a1917', // ink
  '#ffffff', // white
  '#2440e6', // ultramarine
  '#e8442e', // vermilion
  '#f5c518', // yellow
  '#23a25d', // green
] as const

export interface CanvasActions {
  createShape: (shape: Omit<Shape, 'id'> & { id?: string }) => Shape
  createShapes: (shapes: Omit<Shape, 'id'>[]) => Shape[]
  updateShape: (id: string, patch: Partial<Omit<Shape, 'id'>>) => Shape | null
  deleteShape: (id: string) => boolean
}

let counter = 0
export function shapeId() {
  counter += 1
  return `s${Date.now().toString(36)}${counter}`
}
