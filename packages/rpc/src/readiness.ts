export async function serviceReadinessResponse(
  service: 'web' | 'api' | 'mcp',
  checkDatabase: () => Promise<void>,
) {
  try {
    await checkDatabase()
    return Response.json(
      {
        service,
        status: 'ready',
        checks: { database: 'ready' },
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch {
    return Response.json(
      {
        service,
        status: 'unavailable',
        checks: { database: 'unavailable' },
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': '5',
        },
      },
    )
  }
}
