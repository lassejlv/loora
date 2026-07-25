import { describe, expect, test } from 'bun:test'
import {
  checkReviewComment,
  PULL_REQUEST_AUTHOR_MAX,
  PULL_REQUEST_COMMENT_MAX,
  rewriteAssetUrls,
} from './pull-requests'

describe('rewriteAssetUrls', () => {
  test('points element asset references at the review-scoped route', () => {
    const shapes = [{ id: 'a', code: '<img src="/api/asset/img1"><img src="/api/asset/img2">' }]
    expect(rewriteAssetUrls(shapes, 'tok-1')[0].code).toBe(
      '<img src="/api/pr/tok-1/asset/img1"><img src="/api/pr/tok-1/asset/img2">',
    )
  })

  test('escapes the token so a crafted id cannot break out of the path', () => {
    const rewritten = rewriteAssetUrls([{ code: '/api/asset/x' }], 'a/../b')
    expect(rewritten[0].code).toBe('/api/pr/a%2F..%2Fb/asset/x')
  })

  test('leaves code without assets untouched', () => {
    const shapes = [{ id: 'a', code: '<p>hi</p>' }]
    expect(rewriteAssetUrls(shapes, 'tok')).toEqual(shapes)
  })
})

describe('checkReviewComment', () => {
  test('trims and accepts a normal comment', () => {
    expect(checkReviewComment({ authorName: '  Mia ', body: ' spacing feels tight ' })).toEqual({
      ok: true,
      authorName: 'Mia',
      body: 'spacing feels tight',
    })
  })

  test('rejects an empty body or name', () => {
    expect(checkReviewComment({ authorName: 'Mia', body: '   ' }).ok).toBe(false)
    expect(checkReviewComment({ authorName: '  ', body: 'hi' }).ok).toBe(false)
  })

  test('caps the author name instead of rejecting it', () => {
    const checked = checkReviewComment({ authorName: 'n'.repeat(200), body: 'hi' })
    expect(checked.ok).toBe(true)
    expect(checked.ok && checked.authorName.length).toBe(PULL_REQUEST_AUTHOR_MAX)
  })

  test('rejects a body past the limit', () => {
    const checked = checkReviewComment({
      authorName: 'Mia',
      body: 'x'.repeat(PULL_REQUEST_COMMENT_MAX + 1),
    })
    expect(checked).toMatchObject({ ok: false, status: 400 })
  })
})
