const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SERVER_TIMING_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/

export interface RequestTimingEntry {
  name: string
  durationMs: number
}

export function requestIdFromHeaders(headers: Headers) {
  const incoming = headers.get('x-request-id')?.trim()
  return incoming && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : globalThis.crypto.randomUUID()
}

export function elapsedMilliseconds(startedAt: number) {
  return Math.max(0, performance.now() - startedAt)
}

export function serverTimingHeader(entries: RequestTimingEntry[]) {
  return entries
    .filter(
      (entry) =>
        SERVER_TIMING_TOKEN_PATTERN.test(entry.name) &&
        Number.isFinite(entry.durationMs) &&
        entry.durationMs >= 0,
    )
    .map(
      (entry) =>
        `${entry.name};dur=${Math.round(entry.durationMs * 10) / 10}`,
    )
    .join(', ')
}

export function withRequestTimingHeaders(
  response: Response,
  requestId: string,
  entries: RequestTimingEntry[],
) {
  const headers = new Headers(response.headers)
  headers.set('X-Request-Id', requestId)
  const timing = serverTimingHeader(entries)
  if (timing) headers.set('Server-Timing', timing)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function logRequestTiming(input: {
  service: 'web' | 'mcp'
  requestId: string
  method: string
  path: string
  status: number
  durationMs: number
  phases?: Record<string, number>
}) {
  console.info(
    JSON.stringify({
      event: 'api.request',
      service: input.service,
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      status: input.status,
      durationMs: Math.round(input.durationMs * 10) / 10,
      phases: input.phases
        ? Object.fromEntries(
            Object.entries(input.phases).map(([name, duration]) => [
              name,
              Math.round(duration * 10) / 10,
            ]),
          )
        : undefined,
    }),
  )
}
