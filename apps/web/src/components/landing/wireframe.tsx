import { motion, type MotionValue } from 'motion/react'
import { usePalette } from '#/components/landing/palette'

/* ------------------------------------------------------------------------- *
 * Canvas primitives.
 *
 * These recreate what the canvas actually looks like: elements are sharp-cornered
 * white rectangles on a dotted field, their contents are flat grey wireframe
 * blocks, and a selected element carries a blue outline with four 8px square
 * handles. Nothing here is rounded — rounding is for app chrome, not elements.
 * ------------------------------------------------------------------------- */

type WireTone = 'strong' | 'mid' | 'soft'

const WIRE_KEY = { strong: 'wireStrong', mid: 'wireMid', soft: 'wireSoft' } as const

export function Wire({
  w,
  h = 10,
  tone = 'mid',
  className = '',
}: {
  w: string
  h?: number
  tone?: WireTone
  className?: string
}) {
  const palette = usePalette()
  return (
    <div className={className} style={{ width: w, height: h, background: palette[WIRE_KEY[tone]] }} />
  )
}

/** Streams a wireframe block in on a delay, the way generated code lands. */
export function StreamWire({
  step,
  on,
  children,
}: {
  step: number
  on: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: on ? 1 : 0 }}
      transition={{ duration: 0.2, delay: on ? step * 0.1 : 0 }}
    >
      {children}
    </motion.div>
  )
}

export function DotField({ y }: { y?: MotionValue<number> }) {
  const palette = usePalette()
  return (
    <motion.div
      aria-hidden="true"
      className="absolute inset-[-10%]"
      style={{
        backgroundImage: `radial-gradient(circle, ${palette.dot} 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
        y,
      }}
    />
  )
}

/** Four corner handles: element-surface fill, 1.5px accent stroke, square. */
export function Handles() {
  const palette = usePalette()
  return (
    <>
      {(
        ['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'] as const
      ).map((pos) => (
        <motion.span
          key={pos}
          className={`absolute size-2 bg-card ${pos}`}
          style={{ border: `1.5px solid ${palette.accent}` }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        />
      ))}
    </>
  )
}
