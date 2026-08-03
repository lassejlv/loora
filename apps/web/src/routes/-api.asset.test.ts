import { describe, expect, test } from 'vitest'
import { handleAssetRequest } from './api.asset.$id'

describe('asset API route', () => {
  test('rejects an unauthenticated request without redirecting off-origin', async () => {
    const response = await handleAssetRequest(
      new Request('https://loora.design/api/asset/asset-id'),
      'asset-id',
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
  })
})
