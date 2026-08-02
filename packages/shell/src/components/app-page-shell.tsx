import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { authClient } from '@loora/auth/client'
import {
  AppAccountMenu,
  AppNavigation,
  type AppSection,
} from './app-navigation'
import { AppSettingsDialog } from './settings-dialog'
import { StatusBadge } from './status-badge'
import { UpgradeToProButton } from '@loora/editor/upgrade-to-pro'
import { clearWelcomeSeen } from './welcome-dialog'

export function AppPageShell({
  active,
  title,
  description,
  children,
  wide = false,
}: {
  active: AppSection
  title: string
  description: string
  children: ReactNode
  /** Data-dense pages (admin tables) need more than the reading measure. */
  wide?: boolean
}) {
  const { data: session } = authClient.useSession()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const accountName = session?.user?.name ?? session?.user?.email ?? 'Account'

  const signOut = async () => {
    clearWelcomeSeen()
    await authClient.signOut()
  }

  return (
    <div className="flex h-screen min-h-0 bg-cx-canvas text-foreground">
      <aside className="hidden w-48 shrink-0 flex-col border-e border-line bg-surface md:flex">
        <Link to="/app" className="flex h-10 shrink-0 items-center gap-2 px-3">
          <img
            src="/logo192.png"
            alt=""
            width={16}
            height={16}
            className="size-4 shrink-0 rounded-sm"
          />
          <span className="text-xs font-semibold tracking-tight">loora</span>
        </Link>
        <AppNavigation active={active} onSettings={() => setSettingsOpen(true)} />
        <div className="mt-auto flex flex-col gap-2 border-t border-line p-2">
          <StatusBadge className="-mb-1" />
          <UpgradeToProButton fullWidth size="sm" />
          <AppAccountMenu
            name={accountName}
            onSettings={() => setSettingsOpen(true)}
            onSignOut={() => void signOut()}
          />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-line bg-surface px-3 md:px-4">
          <div className="md:hidden">
            <AppAccountMenu
              compact
              name={accountName}
              onSettings={() => setSettingsOpen(true)}
              onSignOut={() => void signOut()}
            />
          </div>
          <div className="min-w-0 py-2">
            <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </header>

        {/* Content sits flat on the canvas like the designs dashboard; the
            sections below bring their own surfaces where grouping helps. */}
        <section
          className={`mx-auto w-full p-4 md:p-6 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}
        >
          {children}
        </section>
      </main>

      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
