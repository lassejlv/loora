import { describe, expect, test } from 'vitest'
import { assetIdFromSrc, assetKey, assetRouteUrl } from './asset-url'

const ID = `a${'0123456789abcdef'.repeat(2)}`

describe('assetIdFromSrc', () => {
  test('reads the id back from the API route', () => {
    expect(assetIdFromSrc(assetRouteUrl(ID))).toBe(ID)
    expect(assetIdFromSrc(`https://loora.design/api/asset/${ID}`)).toBe(ID)
  })

  test('reads the id back from a public bucket URL', () => {
    const url = `https://assets.loora.design/${assetKey('user_1', ID)}`
    expect(assetIdFromSrc(url)).toBe(ID)
  })

  test('ignores images that are not ours', () => {
    expect(assetIdFromSrc('https://example.com/assets/a/b.png')).toBeNull()
    expect(assetIdFromSrc('https://example.com/photo.png')).toBeNull()
    expect(assetIdFromSrc('data:image/png;base64,AAA=')).toBeNull()
    expect(assetIdFromSrc('')).toBeNull()
  })
})
