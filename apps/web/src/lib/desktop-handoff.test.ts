import { describe, expect, test } from 'bun:test'
import {
  desktopCallbackUrl,
  parseDesktopHandoff,
  parseHandoffPort,
  parseHandoffState,
} from './desktop-handoff'

describe('desktop hand-off', () => {
  test('takes the ports a desktop app can actually listen on', () => {
    expect(parseHandoffPort('4300')).toBe(4300)
    expect(parseHandoffPort(65535)).toBe(65535)
    expect(parseHandoffPort('80')).toBeNull()
    expect(parseHandoffPort('70000')).toBeNull()
    expect(parseHandoffPort('4300.5')).toBeNull()
    expect(parseHandoffPort('nope')).toBeNull()
    expect(parseHandoffPort(undefined)).toBeNull()
  })

  test('takes only a state string shaped like the one the host generates', () => {
    expect(parseHandoffState('aB3-_aB3_aB3-aB3x')).toBe('aB3-_aB3_aB3-aB3x')
    expect(parseHandoffState('short')).toBeNull()
    expect(parseHandoffState('has spaces in it here')).toBeNull()
    expect(parseHandoffState('x'.repeat(65))).toBeNull()
    expect(parseHandoffState(42)).toBeNull()
  })

  test('reads both out of a search object', () => {
    expect(parseDesktopHandoff({ port: '4300', state: 'a'.repeat(32) })).toEqual({
      port: 4300,
      state: 'a'.repeat(32),
    })
    expect(parseDesktopHandoff({})).toEqual({ port: null, state: null })
  })

  test('sends the code to loopback, whatever else was in the query', () => {
    const url = desktopCallbackUrl({ port: 4300, state: 'a'.repeat(32), token: 'code' })

    expect(new URL(url).hostname).toBe('127.0.0.1')
    expect(new URL(url).port).toBe('4300')
    expect(new URL(url).searchParams.get('token')).toBe('code')
    expect(new URL(url).searchParams.get('state')).toBe('a'.repeat(32))
  })
})
