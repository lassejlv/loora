import { describe, expect, it } from 'vitest'
import { canvasTransactionPruneBefore } from './canvas-transactions'

describe('Canvas transaction retention', () => {
  it('prunes only when a retained-history window is crossed', () => {
    expect(canvasTransactionPruneBefore(499, 500)).toBeNull()
    expect(canvasTransactionPruneBefore(500, 501)).toBeNull()
    expect(canvasTransactionPruneBefore(548, 550)).toBe(50)
    expect(canvasTransactionPruneBefore(599, 601)).toBe(101)
  })
})
