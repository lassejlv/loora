import { describe, expect, test } from 'vitest'
import { CanvasEngine } from './engine'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
  parseCanvasDocument,
  validateDocument,
  type CanvasDocument,
} from './model'
import {
  animationCss,
  isCanvasAnimation,
  isCanvasTransition,
  keyframesCss,
  motionPreset,
  transitionCss,
} from './motion'
import { motionStyleSheet, nodeMotionDeclarations } from './motion-css'
import { hoverPreset } from './motion-presets'
import { compileCanvas } from './export'

function documentWithFrame() {
  const document = createCanvasDocument('Motion', 'motion')
  const page = createPageNode('Page')
  const frame = createFrameNode('Card', { parentId: page.id })
  document.nodes[page.id] = page
  document.nodes[frame.id] = frame
  return { document, page, frame }
}

describe('motion values', () => {
  test('rejects the shapes a canvas must not store', () => {
    expect(isCanvasTransition({ duration: 200, easing: 'ease-out' })).toBe(true)
    // No freeform CSS: an easing is a name or four numbers, never a string of
    // someone else's syntax.
    expect(isCanvasTransition({ duration: 200, easing: 'cubic-bezier(0,0,1,1)' })).toBe(false)
    expect(isCanvasTransition({ duration: -1, easing: 'ease' })).toBe(false)
    expect(isCanvasTransition({ duration: 200, easing: { cubicBezier: [2, 0, 1, 1] } })).toBe(false)

    const animation = motionPreset('fade-in-up')
    expect(isCanvasAnimation(animation)).toBe(true)
    // Offsets have to ascend, or the sequence does not read in the order it plays.
    expect(
      isCanvasAnimation({
        ...animation,
        keyframes: [{ offset: 1, opacity: 1 }, { offset: 0, opacity: 0 }],
      }),
    ).toBe(false)
    expect(isCanvasAnimation({ ...animation, keyframes: [{ offset: 0, opacity: 0 }] })).toBe(false)
  })

  test('writes the CSS a browser runs', () => {
    expect(transitionCss({ duration: 180, easing: 'ease-out' })).toBe('all 180ms ease-out')
    expect(
      transitionCss({
        duration: 200,
        delay: 50,
        easing: { cubicBezier: [0.16, 1, 0.3, 1] },
        properties: ['opacity', 'transform'],
      }),
    ).toBe(
      'opacity 200ms cubic-bezier(0.16,1,0.3,1) 50ms, transform 200ms cubic-bezier(0.16,1,0.3,1) 50ms',
    )

    const fade = motionPreset('fade-in-up')
    expect(keyframesCss(fade)).toBe(
      '@keyframes loora-motion-fade-in-up{0%{opacity:0;transform:translate(0px,16px)}100%{opacity:1;transform:translate(0px,0px)}}',
    )
    expect(animationCss(fade, { animationId: fade.id, trigger: 'load', delay: 120 })).toBe(
      'loora-motion-fade-in-up 500ms ease-out 120ms 1 normal backwards',
    )
  })

  test('no preset holds the properties a hover needs', () => {
    expect(motionPreset('spin').fill).toBe('none')
    expect(motionPreset('spin').iterations).toBe('infinite')
    // A filled animation outranks author rules for what it touches, so an
    // entrance that held its last frame would silently kill a hover that moves
    // the same node. `backwards` still covers a delay.
    expect(motionPreset('fade-in-up').fill).toBe('backwards')
  })
})

describe('motion on a document', () => {
  test('a node may only play animations the document defines', () => {
    const { document, frame } = documentWithFrame()
    frame.animations = [{ animationId: 'missing', trigger: 'load' }]

    const dangling = validateDocument(document)
    expect(dangling.ok).toBe(false)

    document.animations = { 'fade-in': motionPreset('fade-in') }
    frame.animations = [{ animationId: 'fade-in', trigger: 'load' }]
    expect(validateDocument(document).ok).toBe(true)
  })

  test('reads a document written before motion existed', () => {
    const { document } = documentWithFrame()
    const older = JSON.parse(JSON.stringify(document)) as CanvasDocument
    delete older.animations

    expect(() => parseCanvasDocument(older)).not.toThrow()
    expect(parseCanvasDocument(older).animations).toBeUndefined()
  })

  test('an engine transaction defines motion and inverts cleanly', () => {
    const { document, frame } = documentWithFrame()
    const engine = new CanvasEngine(document)
    const fade = motionPreset('fade-in')

    engine.apply({
      id: 'tx-motion',
      label: 'Add motion',
      operations: [
        { type: 'animation.upsert', animation: fade },
        {
          type: 'node.patch',
          id: frame.id,
          patch: {
            animations: [{ animationId: fade.id, trigger: 'load' }],
            transition: hoverPreset('lift').transition,
            visualStates: { hover: hoverPreset('lift').state },
          },
        },
      ],
    })

    expect(engine.document.animations?.['fade-in']?.name).toBe('Fade in')
    expect(engine.document.nodes[frame.id]?.visualStates?.hover?.transform).toEqual({
      y: -2,
      scale: 1.01,
    })

    engine.undo()
    expect(engine.document.animations?.['fade-in']).toBeUndefined()
    expect(engine.document.nodes[frame.id]?.visualStates).toBeUndefined()
  })

  test('setting one visual state leaves the others alone', () => {
    const { document, frame } = documentWithFrame()
    const engine = new CanvasEngine(document)
    engine.apply({
      id: 'tx-hover',
      label: 'Hover',
      operations: [
        {
          type: 'node.patch',
          id: frame.id,
          patch: { visualStates: { hover: { transform: { scale: 1.04 } } } },
        },
      ],
    })
    engine.apply({
      id: 'tx-focus',
      label: 'Focus',
      operations: [
        {
          type: 'node.patch',
          id: frame.id,
          patch: { visualStates: { focus: { style: { opacity: 0.9 } } } },
        },
      ],
    })

    const states = engine.document.nodes[frame.id]?.visualStates
    expect(states?.hover?.transform).toEqual({ scale: 1.04 })
    expect(states?.focus?.style?.opacity).toBe(0.9)
  })
})

describe('motion stylesheet', () => {
  test('pointer states become real rules, and self-starting motion rides the node', () => {
    const { document, frame } = documentWithFrame()
    document.animations = { float: motionPreset('float') }
    frame.visualStates = { hover: hoverPreset('grow').state }
    frame.transition = { duration: 180, easing: 'ease-out' }
    frame.animations = [{ animationId: 'float', trigger: 'always' }]

    expect(nodeMotionDeclarations(document, frame)).toEqual([
      'transition:all 180ms ease-out',
      'animation:loora-motion-float 4000ms ease-in-out 0ms infinite normal none',
    ])

    const sheet = motionStyleSheet(document, [frame], () => '.card')
    expect(sheet).toContain('@keyframes loora-motion-float')
    expect(sheet).toContain('.card:hover{transform:scale(1.04)}')
    // Somebody who asked not to be moved is not moved.
    expect(sheet).toContain('@media (prefers-reduced-motion: reduce)')
    expect(sheet).toContain('animation:none!important')
  })

  test('a hover-triggered animation waits for the pointer', () => {
    const { document, frame } = documentWithFrame()
    document.animations = { pulse: motionPreset('pulse') }
    frame.animations = [{ animationId: 'pulse', trigger: 'hover' }]

    expect(nodeMotionDeclarations(document, frame)).toEqual([])
    expect(motionStyleSheet(document, [frame], () => '.card')).toContain(
      '.card:hover{animation:loora-motion-pulse',
    )
  })
})

describe('exported motion', () => {
  test('the download carries the same rules the canvas showed', () => {
    const { document, frame } = documentWithFrame()
    document.animations = { 'fade-in-up': motionPreset('fade-in-up') }
    frame.visualStates = { hover: hoverPreset('lift').state }
    frame.transition = { duration: 180, easing: 'ease-out' }
    frame.animations = [{ animationId: 'fade-in-up', trigger: 'in-view', delay: 80 }]

    const { css } = compileCanvas(document)

    expect(css).toContain('@keyframes loora-motion-fade-in-up')
    expect(css).toContain('transition:all 180ms ease-out')
    expect(css).toContain('animation:loora-motion-fade-in-up 500ms ease-out 80ms 1 normal backwards')
    expect(css).toContain(':hover{')
    expect(css).toContain('box-shadow:0px 8px 24px -4px rgba(0,0,0,0.18)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  test('a document with no motion exports no motion', () => {
    const { document } = documentWithFrame()

    const { css } = compileCanvas(document)

    expect(css).not.toContain('@keyframes')
    expect(css).not.toContain('prefers-reduced-motion')
  })
})
