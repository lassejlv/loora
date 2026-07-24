import { act, type ComponentType, type ReactNode } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, mock } from 'bun:test'
import { THEME_INIT_SCRIPT } from './theme'

const routerModule = await import('@tanstack/react-router')
mock.module('@tanstack/react-router', () => ({
  ...routerModule,
  HeadContent: () => null,
  Scripts: () => null,
}))
mock.module('@databuddy/sdk/react', () => ({ Databuddy: () => null }))
mock.module('@tanstack/react-router-devtools', () => ({
  TanStackRouterDevtoolsPanel: () => null,
}))
mock.module('@tanstack/react-devtools', () => ({ TanStackDevtools: () => null }))
mock.module('nuqs/adapters/tanstack-router', () => ({
  NuqsAdapter: ({ children }: { children: ReactNode }) => children,
}))

const { Route } = await import('../routes/__root')
// shellComponent is absent from the public RouteOptions type but is what Start
// renders as the document shell.
const RootDocument = (
  Route.options as unknown as { shellComponent: ComponentType<{ children: ReactNode }> }
).shellComponent

describe('theme hydration', () => {
  it('does not warn when the theme script applies dark mode before hydration', async () => {
    const markup = renderToString(
      <RootDocument>
        <main>Loora</main>
      </RootDocument>,
    )
    document.open()
    document.write(`<!doctype html>${markup}`)
    document.close()
    window.localStorage.setItem('loora:theme', 'dark')

    const originalMatchMedia = globalThis.matchMedia
    const originalConsoleError = console.error
    const errors: string[] = []
    let root: Root | undefined

    globalThis.matchMedia = (() => ({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => true,
    })) as typeof matchMedia
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    }

    try {
      Function('localStorage', 'matchMedia', 'document', THEME_INIT_SCRIPT)(
        window.localStorage,
        globalThis.matchMedia,
        document,
      )
      expect(document.documentElement.classList.contains('dark')).toBe(true)

      await act(async () => {
        root = hydrateRoot(
          document,
          <RootDocument>
            <main>Loora</main>
          </RootDocument>,
        )
        await Promise.resolve()
      })

      expect(
        errors.some((message) =>
          message.includes("server rendered HTML didn't match the client properties"),
        ),
      ).toBe(false)
      // Suppressing the warning must not mean React strips the class back off —
      // that would repaint light on every dark load.
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    } finally {
      root?.unmount()
      console.error = originalConsoleError
      globalThis.matchMedia = originalMatchMedia
      window.localStorage.removeItem('loora:theme')
      document.documentElement.className = ''
    }
  })
})
