import { describe, expect, it } from 'bun:test'
import { applyCodeEdits, applyElementPatches, reorderElements, type CanvasElement } from './canvas'

const element = (id: string, x = 0): CanvasElement => ({
  id,
  name: id,
  x,
  y: 0,
  w: 100,
  h: 100,
  code: '<div />',
})

describe('applyElementPatches', () => {
  it('applies a batch in one array pass and preserves untouched object identity', () => {
    const a = element('a')
    const b = element('b')
    const c = element('c')
    const out = applyElementPatches(
      [a, b, c],
      new Map([
        ['a', { x: 10 }],
        ['c', { x: 30, name: 'changed' }],
      ]),
    )

    expect(out.map(({ id, x }) => ({ id, x }))).toEqual([
      { id: 'a', x: 10 },
      { id: 'b', x: 0 },
      { id: 'c', x: 30 },
    ])
    expect(out[1]).toBe(b)
    expect(out[0]).not.toBe(a)
  })

  it('returns the original array for an empty batch', () => {
    const elements = [element('a')]
    expect(applyElementPatches(elements, new Map())).toBe(elements)
  })
})

describe('applyCodeEdits', () => {
  it('applies edits in order', () => {
    const result = applyCodeEdits('<h1>Hello</h1><p>World</p>', [
      { oldCode: 'Hello', newCode: 'Hi' },
      { oldCode: '<p>World</p>', newCode: '<p>There</p>' },
    ])
    expect(result).toMatchObject({ ok: true, code: '<h1>Hi</h1><p>There</p>' })
  })

  it('echoes the replaced range with surrounding lines', () => {
    const code = ['line1', 'line2', 'line3', 'TARGET', 'line5', 'line6', 'line7'].join('\n')
    const result = applyCodeEdits(code, [{ oldCode: 'TARGET', newCode: 'CHANGED' }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contexts).toEqual(['line2\nline3\nCHANGED\nline5\nline6'])
    }
  })

  it('deletes with an empty newCode and sees prior edits', () => {
    const result = applyCodeEdits('abc', [
      { oldCode: 'b', newCode: 'bb' },
      { oldCode: 'bb', newCode: '' },
    ])
    expect(result).toMatchObject({ ok: true, code: 'ac' })
  })

  it('rejects a missing oldCode and points at readElement', () => {
    const result = applyCodeEdits('<div />', [{ oldCode: 'nope', newCode: 'x' }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('readElement')
  })

  it('rejects an ambiguous match unless replaceAll is set', () => {
    const ambiguous = applyCodeEdits('a a', [{ oldCode: 'a', newCode: 'b' }])
    expect(ambiguous.ok).toBe(false)
    if (!ambiguous.ok) expect(ambiguous.error).toContain('2 places')
    expect(applyCodeEdits('a a', [{ oldCode: 'a', newCode: 'b', replaceAll: true }])).toEqual({
      ok: true,
      code: 'b b',
      contexts: ['2× b b'],
    })
  })

  it('is atomic: a failing later edit reports its index and changes nothing', () => {
    const result = applyCodeEdits('abc', [
      { oldCode: 'a', newCode: 'x' },
      { oldCode: 'missing', newCode: 'y' },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('edit 2')
  })

  it('keeps replacement-pattern characters literal', () => {
    expect(applyCodeEdits('price', [{ oldCode: 'price', newCode: "$& $' $100" }])).toMatchObject({
      ok: true,
      code: "$& $' $100",
    })
  })

  it('rejects an empty oldCode', () => {
    expect(applyCodeEdits('abc', [{ oldCode: '', newCode: 'x' }]).ok).toBe(false)
  })
})

describe('reorderElements', () => {
  it('rebuilds exact order in linear time', () => {
    const elements = [element('a'), element('b'), element('c')]
    expect(reorderElements(elements, ['c', 'a', 'b']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores duplicate and unknown ids and preserves omitted relative order', () => {
    const elements = [element('a'), element('b'), element('c'), element('d')]
    expect(reorderElements(elements, ['c', 'missing', 'c', 'a']).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
  })
})
