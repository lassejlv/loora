import { describe, expect, test } from 'bun:test'
import { CanvasEngine } from '@loora/canvas/engine'
import {
  createCanvasDocument,
  createFrameNode,
  createPageNode,
} from '@loora/canvas/model'
import {
  animateNodesInputSchema,
  animateNodesOperations,
  animationOperations,
  setAnimationsInputSchema,
} from './canvas-tools'

function documentWithCards(count = 3) {
  const document = createCanvasDocument('Motion', 'motion')
  const page = createPageNode('Page')
  document.nodes[page.id] = page
  const cards = Array.from({ length: count }, (_, index) => {
    const card = createFrameNode(`Card ${index + 1}`, { parentId: page.id })
    document.nodes[card.id] = card
    return card
  })
  return { document, cards }
}

describe('setAnimations', () => {
  test('takes a preset name and defines the whole thing', () => {
    const input = setAnimationsInputSchema.parse({ presets: ['fade-in-up'] })

    const operations = animationOperations(input)

    expect(operations).toHaveLength(1)
    expect(operations[0]).toMatchObject({
      type: 'animation.upsert',
      animation: { id: 'fade-in-up', duration: 500, fill: 'backwards' },
    })
  })

  test('an explicit definition wins over a preset of the same id', () => {
    const input = setAnimationsInputSchema.parse({
      presets: ['fade-in'],
      animations: [
        {
          id: 'fade-in',
          name: 'Slower fade',
          duration: 900,
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 },
          ],
        },
      ],
    })

    const [operation] = animationOperations(input)

    expect(operation).toMatchObject({
      type: 'animation.upsert',
      animation: { id: 'fade-in', name: 'Slower fade', duration: 900 },
    })
  })

  test('refuses a call that would do nothing', () => {
    expect(() => setAnimationsInputSchema.parse({})).toThrow()
  })
})

describe('animateNodes', () => {
  test('a hover preset brings its own transition', () => {
    const { document, cards } = documentWithCards(1)
    const input = animateNodesInputSchema.parse({
      refs: [{ nodeId: cards[0]!.id }],
      hover: 'lift',
    })

    const engine = new CanvasEngine(document)
    engine.apply({
      id: 'tx',
      label: 'Hover',
      operations: animateNodesOperations(input),
    })

    const card = engine.document.nodes[cards[0]!.id]
    expect(card?.visualStates?.hover?.transform).toEqual({ y: -2, scale: 1.01 })
    expect(card?.transition).toEqual({ duration: 180, easing: 'ease-out' })
  })

  test('a stagger spaces a list out in the order it was given', () => {
    const { document, cards } = documentWithCards(3)
    document.animations = {
      'fade-in-up': {
        id: 'fade-in-up',
        name: 'Fade in up',
        duration: 500,
        easing: 'ease-out',
        iterations: 1,
        direction: 'normal',
        fill: 'both',
        keyframes: [
          { offset: 0, opacity: 0, transform: { y: 16 } },
          { offset: 1, opacity: 1, transform: { y: 0 } },
        ],
      },
    }
    const input = animateNodesInputSchema.parse({
      refs: cards.map((card) => ({ nodeId: card.id })),
      play: [{ animationId: 'fade-in-up', trigger: 'in-view' }],
      stagger: 60,
    })

    const engine = new CanvasEngine(document)
    engine.apply({
      id: 'tx',
      label: 'Stagger',
      operations: animateNodesOperations(input),
    })

    expect(
      cards.map((card) => engine.document.nodes[card.id]?.animations?.[0]?.delay),
    ).toEqual([0, 60, 120])
  })

  test('clearing takes every kind of motion off at once', () => {
    const { document, cards } = documentWithCards(1)
    const engine = new CanvasEngine(document)
    engine.apply({
      id: 'tx-add',
      label: 'Hover',
      operations: animateNodesOperations(
        animateNodesInputSchema.parse({
          refs: [{ nodeId: cards[0]!.id }],
          hover: 'grow',
        }),
      ),
    })
    expect(engine.document.nodes[cards[0]!.id]?.visualStates).toBeDefined()

    engine.apply({
      id: 'tx-clear',
      label: 'Clear',
      operations: animateNodesOperations(
        animateNodesInputSchema.parse({
          refs: [{ nodeId: cards[0]!.id }],
          clear: true,
        }),
      ),
    })

    const card = engine.document.nodes[cards[0]!.id]
    expect(card?.visualStates).toBeUndefined()
    expect(card?.transition).toBeUndefined()
    expect(card?.animations).toBeUndefined()
  })

  test('refuses a call that would do nothing', () => {
    expect(() =>
      animateNodesInputSchema.parse({ refs: [{ nodeId: 'node-1' }] }),
    ).toThrow()
  })
})
