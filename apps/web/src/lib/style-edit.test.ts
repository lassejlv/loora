import { describe, expect, it } from 'bun:test'
import { BG_COLOR_RE, FONT_SIZE_RE, TEXT_COLOR_RE, getStyleToken, setStyleToken } from './style-edit'

describe('style token classifiers', () => {
  it('separates text colors from text sizes', () => {
    expect(TEXT_COLOR_RE.test('text-[#2440e6]')).toBe(true)
    expect(TEXT_COLOR_RE.test('text-red-500')).toBe(true)
    expect(TEXT_COLOR_RE.test('text-white')).toBe(true)
    expect(TEXT_COLOR_RE.test('text-white/80')).toBe(true)
    expect(TEXT_COLOR_RE.test('text-xl')).toBe(false)
    expect(TEXT_COLOR_RE.test('text-[14px]')).toBe(false)
    expect(TEXT_COLOR_RE.test('text-center')).toBe(false)
    expect(FONT_SIZE_RE.test('text-xl')).toBe(true)
    expect(FONT_SIZE_RE.test('text-red-500')).toBe(false)
  })

  it('keeps gradients out of background colors', () => {
    expect(BG_COLOR_RE.test('bg-[#f5c518]')).toBe(true)
    expect(BG_COLOR_RE.test('bg-blue-600')).toBe(true)
    expect(BG_COLOR_RE.test('bg-gradient-to-r')).toBe(false)
    expect(BG_COLOR_RE.test('bg-cover')).toBe(false)
  })
})

describe('setStyleToken', () => {
  it('swaps a token in place, preserving order', () => {
    expect(setStyleToken('p-4 bg-white rounded-lg', 'bgColor', 'bg-[#1a1917]')).toBe(
      'p-4 bg-[#1a1917] rounded-lg',
    )
  })

  it('appends when no token of that kind exists', () => {
    expect(setStyleToken('p-4 text-xl', 'textColor', 'text-[#e8442e]')).toBe(
      'p-4 text-xl text-[#e8442e]',
    )
  })

  it('removes every token of the kind when given null', () => {
    expect(setStyleToken('bg-white p-2 bg-red-500', 'bgColor', null)).toBe('p-2')
  })

  it('reads the current token', () => {
    expect(getStyleToken('p-4 text-xl text-white', 'textColor')).toBe('text-white')
    expect(getStyleToken('p-4 text-xl', 'textColor')).toBeNull()
  })
})
