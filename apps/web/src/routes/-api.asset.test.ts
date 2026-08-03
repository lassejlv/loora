import { describe, expect, test } from 'vitest'
import { apiAssetUrl } from './api.asset.$id'

describe('asset API compatibility route', () => {
  test('sends production asset requests to the API service', () => {
    expect(
      apiAssetUrl(
        new Request('https://loora.design/api/asset/asset-id'),
        'asset-id',
      ).toString(),
    ).toBe('https://api.loora.design/api/asset/asset-id')
  })

  test('sends local asset requests to the local API service', () => {
    expect(
      apiAssetUrl(
        new Request('http://localhost:3000/api/asset/asset-id'),
        'asset-id',
      ).toString(),
    ).toBe('http://localhost:3001/api/asset/asset-id')
  })
})
