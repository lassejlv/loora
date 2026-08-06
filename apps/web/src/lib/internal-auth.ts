import { timingSafeEqual } from 'node:crypto'

export function hasValidBearerToken(request: Request, configuredToken: string | undefined) {
  const configured = configuredToken?.trim()
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!configured) return false

  const expected = Buffer.from(configured)
  const actual = Buffer.from(supplied)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
