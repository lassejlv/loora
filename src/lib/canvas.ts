export type ShapeType = 'rect' | 'ellipse' | 'text' | 'frame'

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
}

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
  updateShape: (id: string, patch: Partial<Omit<Shape, 'id'>>) => Shape | null
  deleteShape: (id: string) => boolean
}

let counter = 0
export function shapeId() {
  counter += 1
  return `s${Date.now().toString(36)}${counter}`
}
