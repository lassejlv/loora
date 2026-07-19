import { describe, expect, it } from 'bun:test'
import { composeComment } from '#/components/canvas'
import type { CanvasElement } from '#/lib/canvas'

describe('composeComment', () => {
  const element: CanvasElement = {
    id: 'el_1',
    name: 'Landing',
    x: 100,
    y: 50,
    w: 375,
    h: 812,
    code: '<main><button class="btn">Go</button></main>',
  }

  it('includes the comment, element identity, and pin position', () => {
    const message = composeComment('Make this button bigger', { element, px: 12, py: 87 })
    expect(message).toContain('Make this button bigger')
    expect(message).toContain('Canvas comment pinned to:')
    expect(message).toContain('Element "Landing" (id: el_1) at (100, 50), 375×812')
    expect(message).toContain('12% from the left, 87% from the top')
  })

  it('keeps the pin block after the comment text, separated by a divider', () => {
    const message = composeComment('Fix this', { element, px: 50, py: 50 })
    const [body, pin] = message.split('---')
    expect(body).toContain('Fix this')
    expect(pin).toContain('el_1')
  })
})
