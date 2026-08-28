import { useEffect, useState, type MouseEvent } from 'react'
import { appUrl, isDesktop, openExternal } from '@loora/platform'
import { Button } from '@loora/ui/button'
import { InfoIcon, XIcon } from '@loora/ui/icons'
import { cn } from '@loora/ui/utils'

export const CLOUD_PATH = '/cloud'
export const CLOUD_BANNER_DISMISSED_KEY = 'loora:cloud-banner-dismissed'

function isBannerDismissed() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(CLOUD_BANNER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Site-wide notice that Loora's hosted product continues. Mounted at the top of
 * both clients so it cannot be missed behind editor chrome. Dismissed state
 * is remembered in localStorage.
 */
export function ShutdownBanner({ className }: { className?: string }) {
  const [dismissed, setDismissed] = useState(false)
  const href = isDesktop() ? appUrl(CLOUD_PATH) : CLOUD_PATH

  useEffect(() => {
    if (isBannerDismissed()) setDismissed(true)
  }, [])

  const onDetailsClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isDesktop()) return
    event.preventDefault()
    openExternal(href)
  }

  const onDismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(CLOUD_BANNER_DISMISSED_KEY, '1')
    } catch {
      // Private mode — the banner still closes for this session.
    }
  }

  if (dismissed) return null

  return (
    <div
      role="alert"
      className={cn(
        'relative flex shrink-0 items-center justify-center gap-2 border-b border-border bg-muted/80 px-3 py-2 pr-10 text-center text-xs font-medium text-foreground',
        className,
      )}
    >
      <InfoIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <p>
        Loora will continue its cloud version. Your files and accounts stay.{' '}
        <a
          href={href}
          onClick={onDetailsClick}
          className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
        >
          Read more
        </a>
      </p>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Dismiss"
        className="absolute right-1.5 top-1/2 -translate-y-1/2"
        onClick={onDismiss}
      >
        <XIcon />
      </Button>
    </div>
  )
}
