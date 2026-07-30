import { Link } from '@tanstack/react-router'
import {
  ClockIcon,
  CreditCardIcon,
  LinkIcon,
  LogOutIcon,
  SettingsIcon,
} from '#/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'

export type AppSection = 'recents' | 'billing' | 'integrations'

const navigation = [
  { section: 'recents', label: 'Recents', to: '/app', icon: ClockIcon },
  { section: 'billing', label: 'Billing', to: '/app/billing', icon: CreditCardIcon },
  { section: 'integrations', label: 'Integrations', to: '/app/integrations', icon: LinkIcon },
] as const

export function AppNavigation({
  active,
  onSettings,
}: {
  active: AppSection
  onSettings?: () => void
}) {
  return (
    <nav className="flex flex-col gap-px px-1.5">
      {navigation.map((item) => {
        const Icon = item.icon
        const selected = active === item.section
        return (
          <Link
            key={item.section}
            to={item.to}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors',
              // The hover tint is translucent zinc, so a selected item painted
              // in the same tint would be indistinguishable from a hovered one.
              // Selected reads as its own surface: a step up plus a hairline.
              selected
                ? 'bg-surface-2 font-medium text-foreground shadow-panel'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Link>
        )
      })}
      {onSettings ? (
        <button
          type="button"
          onClick={onSettings}
          className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-start text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <SettingsIcon className="size-3.5" />
          Settings
        </button>
      ) : null}
    </nav>
  )
}

export function AppAccountMenu({
  name,
  onSettings,
  onSignOut,
  compact = false,
}: {
  name: string
  onSettings?: () => void
  onSignOut: () => void
  compact?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className={cn(
            'flex items-center gap-2 rounded-md text-start hover:bg-secondary',
            compact ? 'p-1' : 'w-full px-1.5 py-1',
          )}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold">
            {name.slice(0, 1).toUpperCase()}
          </span>
          {compact ? null : (
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {navigation.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.section} asChild>
              <Link to={item.to}>
                <Icon data-slot="icon" />
                {item.label}
              </Link>
            </DropdownMenuItem>
          )
        })}
        {onSettings ? (
          <DropdownMenuItem onClick={onSettings}>
            <SettingsIcon data-slot="icon" />
            Settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOutIcon data-slot="icon" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
