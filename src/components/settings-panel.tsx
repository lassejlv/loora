import { LogOutIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'

export function SettingsPanel() {
  const { data: session } = authClient.useSession()

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      <div className="flex max-w-md flex-col gap-6">
        <div>
          <h2 className="text-sm font-semibold">Account</h2>
          <p className="mt-1 text-xs text-muted-foreground">Signed in to loora.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-cx-accent/10 text-sm font-semibold text-cx-accent">
            {(session?.user.name ?? session?.user.email ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{session?.user.name ?? '—'}</p>
            <p className="truncate text-xs text-muted-foreground">{session?.user.email}</p>
          </div>
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={() => authClient.signOut()}>
            <LogOutIcon data-slot="icon" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}
