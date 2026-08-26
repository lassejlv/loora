import type { MouseEvent } from 'react'
import { appUrl, isDesktop, openExternal } from '@loora/platform'
import { TriangleAlertIcon } from '@loora/ui/icons'
import { cn } from '@loora/ui/utils'

export const SHUTDOWN_PATH = '/shutdown'
export const SHUTDOWN_ON = '1 September 2026'

/**
 * Site-wide notice that Loora ends on 1 September 2026. Mounted at the top of
 * both clients so it cannot be missed behind editor chrome.
 */
export function ShutdownBanner({ className }: { className?: string }) {
  const href = isDesktop() ? appUrl(SHUTDOWN_PATH) : SHUTDOWN_PATH

  const onDetailsClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isDesktop()) return
    event.preventDefault()
    openExternal(href)
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex shrink-0 items-center justify-center gap-2 border-b border-red-950 bg-red-700 px-3 py-2 text-center text-xs font-medium text-white',
        className,
      )}
    >
      <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <p>
        Loora is ending on {SHUTDOWN_ON}. All user and customer data will be
        deleted after that date. The project stays open source.{' '}
        <a
          href={href}
          onClick={onDetailsClick}
          className="whitespace-nowrap underline underline-offset-2 hover:text-white"
        >
          Read the notice
        </a>
      </p>
    </div>
  )
}
