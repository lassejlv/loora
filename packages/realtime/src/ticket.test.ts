import { describe, expect, test } from 'bun:test'
import {
  REALTIME_TICKET_TTL_MS,
  signRealtimeTicket,
  verifyRealtimeTicket,
  type RealtimeTicketClaims,
} from './ticket'

const SECRET = 'a-very-secret-value-for-tests-only'

function claims(overrides: Partial<RealtimeTicketClaims> = {}) {
  const issuedAt = 1_700_000_000_000
  return {
    v: 1,
    userId: 'user-1',
    sessionId: 'session-1',
    ownerUserId: 'owner-1',
    designId: 'design-1',
    draftId: null,
    role: 'owner',
    name: 'Ada',
    image: null,
    color: '#6c5ce7',
    issuedAt,
    expiresAt: issuedAt + REALTIME_TICKET_TTL_MS,
    ...overrides,
  } satisfies RealtimeTicketClaims
}

describe('realtime tickets', () => {
  test('round trips the claims the socket service needs', async () => {
    const payload = claims()
    const ticket = await signRealtimeTicket(payload, SECRET)

    expect(await verifyRealtimeTicket(ticket, SECRET, payload.issuedAt)).toEqual(
      payload,
    )
  })

  test('rejects a ticket signed with another secret', async () => {
    const payload = claims()
    const ticket = await signRealtimeTicket(payload, 'someone-elses-secret')

    expect(await verifyRealtimeTicket(ticket, SECRET, payload.issuedAt)).toBeNull()
  })

  test('rejects tampered claims', async () => {
    const payload = claims({ role: 'view' })
    const ticket = await signRealtimeTicket(payload, SECRET)
    const [body, signature] = ticket.split('.')
    const forged = btoa(JSON.stringify({ ...payload, role: 'owner' }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')

    expect(body).not.toBe(forged)
    expect(
      await verifyRealtimeTicket(`${forged}.${signature}`, SECRET, payload.issuedAt),
    ).toBeNull()
  })

  test('rejects an expired ticket', async () => {
    const payload = claims()
    const ticket = await signRealtimeTicket(payload, SECRET)

    expect(
      await verifyRealtimeTicket(ticket, SECRET, payload.expiresAt + 1),
    ).toBeNull()
  })

  test('rejects an expiry too far out to be one of ours', async () => {
    const payload = claims({ expiresAt: 1_700_000_000_000 + 60 * 60_000 })
    const ticket = await signRealtimeTicket(payload, SECRET)

    expect(
      await verifyRealtimeTicket(ticket, SECRET, payload.issuedAt),
    ).toBeNull()
  })

  test('rejects malformed input instead of throwing', async () => {
    expect(await verifyRealtimeTicket('', SECRET)).toBeNull()
    expect(await verifyRealtimeTicket('no-separator', SECRET)).toBeNull()
    expect(await verifyRealtimeTicket('.', SECRET)).toBeNull()
    expect(await verifyRealtimeTicket('a'.repeat(5_000), SECRET)).toBeNull()
  })
})
