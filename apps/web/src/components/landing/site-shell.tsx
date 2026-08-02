import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { LIGHT, PaletteContext, usePalette } from '#/components/landing/palette'

export function NavSep() {
  return <span className="select-none text-muted-foreground/40">|</span>
}

/**
 * Canvas is an anchor on the landing page, so it never carries an active state;
 * the rest are routes of their own.
 */
const NAV = [
  { label: 'Canvas', to: '/', hash: 'canvas', marksActive: false },
  { label: 'Features', to: '/features', hash: undefined, marksActive: true },
  { label: 'MCP', to: '/mcp', hash: undefined, marksActive: true },
  { label: 'Learn', to: '/learn', hash: undefined, marksActive: true },
  { label: 'Pricing', to: '/pricing', hash: undefined, marksActive: true },
] as const

function SiteHeader() {
  const palette = usePalette()
  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex h-12 w-full max-w-[720px] items-center justify-between px-5">
        <div className="flex items-center gap-3 text-[13px]">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/logo192.png" alt="" width={18} height={18} className="size-[18px]" />
            loora
          </Link>
          <span className="hidden items-center gap-3 sm:flex">
            {NAV.map((item) => (
              <span key={item.label} className="flex items-center gap-3">
                <NavSep />
                <Link
                  to={item.to}
                  hash={item.hash}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  activeProps={item.marksActive ? { style: { color: palette.accent } } : {}}
                >
                  {item.label}
                </Link>
              </span>
            ))}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <Link
            to="/app"
            className="px-2.5 py-1 font-medium text-white"
            style={{ background: palette.accent }}
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-[720px] flex-wrap items-center gap-x-3 gap-y-2 px-5 py-6 text-[12px] text-muted-foreground">
        <span className="font-semibold text-foreground">loora</span>
        <NavSep />
        <Link to="/app" className="transition-colors hover:text-foreground">
          Get started
        </Link>
        <NavSep />
        <Link to="/features" className="transition-colors hover:text-foreground">
          Features
        </Link>
        <NavSep />
        <Link to="/mcp" className="transition-colors hover:text-foreground">
          MCP
        </Link>
        <NavSep />
        <Link to="/learn" className="transition-colors hover:text-foreground">
          Learn
        </Link>
        <NavSep />
        <Link to="/compare" className="transition-colors hover:text-foreground">
          Compare
        </Link>
        <NavSep />
        <Link to="/pricing" className="transition-colors hover:text-foreground">
          Pricing
        </Link>
        <NavSep />
        <a
          href="https://github.com/lassejlv/loora"
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-foreground"
        >
          GitHub
        </a>
        <NavSep />
        <a
          href="https://loora.instatus.com/"
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-foreground"
        >
          Status
        </a>
      </div>
    </footer>
  )
}

/**
 * Shared chrome for the public pages: palette, document scroll, nav, footer.
 *
 * The app shell locks body scroll for the canvas editor (`overflow: hidden` in
 * styles.css). Clearing the inline style is a no-op — the stylesheet still
 * wins. Force document scroll while a marketing route is mounted, then restore.
 */
export function LandingShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'auto'
    body.style.overflow = 'auto'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [])

  return (
    <PaletteContext.Provider value={LIGHT}>
      {/* The marketing pages are typeset in px and are not part of the app's
          Appearance scale; pin the local root so that preference cannot stretch
          them. */}
      <div
        style={{ fontSize: '16px' }}
        className="min-h-dvh bg-background font-mono text-[14px] leading-[1.7] text-foreground antialiased"
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:border focus:border-border focus:bg-card focus:px-2 focus:py-1 focus:text-[13px]"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-[720px] px-5 pb-20 pt-12 sm:pt-16">
          {children}
        </main>
        <SiteFooter />
      </div>
    </PaletteContext.Provider>
  )
}
