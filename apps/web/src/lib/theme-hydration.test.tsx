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
  it('restores dark mode before hydration without a warning', async () => {
    const markup = renderToString(
      <RootDocument>
        <main>Loora</main>
      </RootDocument>,
    )
    // document.write swaps in a brand new <html>, and Testing Library's
    // `screen` captured the original <body> when it was imported. Keep the
    // original element so it can go back afterwards, or every suite that runs
    // after this one queries a detached body and finds nothing.
    const originalHtml = document.documentElement
    document.open()
    document.write(`<!doctype html>${markup}`)
    document.close()
    window.localStorage.setItem('loora:theme', 'dark')

    const originalConsoleError = console.error
    const errors: string[] = []
    let root: Root | undefined

    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    }

    try {
      document.documentElement.classList.add('dark')
      Function('localStorage', 'document', THEME_INIT_SCRIPT)(
        window.localStorage,
        document,
      )
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(window.localStorage.getItem('loora:theme')).toBe('dark')

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
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    } finally {
      root?.unmount()
      console.error = originalConsoleError
      window.localStorage.removeItem('loora:theme')
      document.replaceChild(originalHtml, document.documentElement)
      originalHtml.className = ''
      document.body.innerHTML = ''
    }
  })
})
