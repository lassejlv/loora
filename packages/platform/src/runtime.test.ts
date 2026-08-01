import { afterEach, describe, expect, test } from 'bun:test'
import {
  apiUrl,
  appUrl,
  configureRuntime,
  isDesktop,
  openExternal,
  platform,
} from './runtime'

// Every test that changes the runtime puts it back: the module holds one
// value for the whole process, exactly as it does in a running client.
afterEach(() => {
  configureRuntime({
    platform: 'web',
    apiOrigin: '',
    appOrigin: '',
    openExternal: (url) => window.location.assign(url),
  })
})

describe('platform runtime', () => {
  test('defaults to the document origin, which is what the web app wants', () => {
    expect(platform()).toBe('web')
    expect(isDesktop()).toBe(false)
    expect(apiUrl('/api/rpc')).toBe(`${location.origin}/api/rpc`)
    expect(appUrl('/design/d1')).toBe(`${location.origin}/design/d1`)
  })

  test('a desktop client keeps calling its own host but links to the public app', () => {
    configureRuntime({ platform: 'desktop', appOrigin: 'https://loora.design' })

    expect(isDesktop()).toBe(true)
    // The host proxies /api on to Loora, so the call itself stays local.
    expect(apiUrl('/api/rpc')).toBe(`${location.origin}/api/rpc`)
    expect(appUrl('/design/d1')).toBe('https://loora.design/design/d1')
  })

  test('a link out of the app goes wherever the platform sends it', () => {
    const opened: string[] = []
    configureRuntime({ openExternal: (url) => opened.push(url) })

    openExternal('https://polar.sh/checkout/abc')

    expect(opened).toEqual(['https://polar.sh/checkout/abc'])
  })

  test('an explicit API origin wins over the document', () => {
    configureRuntime({ apiOrigin: 'https://staging.loora.design' })

    expect(apiUrl('/api/ready')).toBe('https://staging.loora.design/api/ready')
    // appOrigin falls back to the document, not to the API origin: they are
    // different questions, and only one of them is about links.
    expect(appUrl('/app')).toBe(`${location.origin}/app`)
  })
})
