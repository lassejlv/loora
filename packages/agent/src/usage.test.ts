import { describe, expect, it } from 'bun:test'
import { costMicroUsd } from './usage'

describe('agent usage pricing', () => {
  it('uses the standard Gemini 3.1 Pro rate through 200k input tokens', () => {
    expect(costMicroUsd('gemini-3-1-pro', 200_000, 1_000)).toBe(412_000)
  })

  it('uses the Gemini 3.1 Pro long-context rate above 200k input tokens', () => {
    expect(costMicroUsd('gemini-3-1-pro', 200_001, 1_000)).toBe(818_004)
  })

  it('uses the flat Gemini 3.1 Flash Lite rate', () => {
    expect(costMicroUsd('gemini-3-1-flash-lite', 100_000, 10_000)).toBe(40_000)
  })
})
