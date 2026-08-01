import { useState } from 'react'
import { useQueryStates } from 'nuqs'
import { LogOutIcon } from '@loora/ui/icons'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@loora/ui/alert-dialog'
import { Button } from '@loora/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@loora/ui/tabs'
import { authClient } from '@loora/auth/client'
import { orpc } from '@loora/rpc/client'
import { PanelShell } from '@loora/ui/panel-shell'
import { ShortcutsSettings } from './shortcuts-settings'
import { clearWelcomeSeen } from './welcome-dialog'
import { AppearanceSettings } from './appearance-settings'
import { editorSearchParams, type SettingsTab } from '../lib/url-state'
import type { ShortcutConfig } from '@loora/editor/lib/shortcuts'

function DeleteAccountSection() {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function deleteAccount() {
    setDeleting(true)
    setError(null)
    try {
      await orpc.auth.deleteAccount()
      clearWelcomeSeen()
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account.')
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanently delete your account, designs, and assets.
        </p>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" size="sm" disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete account'}
              </Button>
            }
          />
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes your account and all designs, assets, and connected
                integrations. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" size="sm">Cancel</Button>} />
              <AlertDialogClose
                render={
                  <Button variant="destructive" size="sm" onClick={() => void deleteAccount()}>
                    Delete account
                  </Button>
                }
              />
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
    </div>
  )
}

export function SettingsPanel({
  onClose,
  shortcutConfig,
  onShortcutConfigChange,
}: {
  onClose?: () => void
  shortcutConfig: ShortcutConfig
  onShortcutConfigChange: (next: ShortcutConfig) => void
}) {
  const { data: session } = authClient.useSession()
  const [{ settings }, setUrlState] = useQueryStates(editorSearchParams, {
    history: 'replace',
  })
  const tab: SettingsTab = settings ?? 'account'

  async function signOut() {
    clearWelcomeSeen()
    await authClient.signOut()
  }

  return (
    <PanelShell title="Settings" onClose={onClose} bodyClassName="p-4" className="bg-transparent">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          void setUrlState({ settings: value as SettingsTab })
        }}
        className="flex flex-col gap-4"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTab value="account">Account</TabsTab>
          <TabsTab value="shortcuts">Shortcuts</TabsTab>
        </TabsList>

        <TabsPanel value="account" className="flex flex-col gap-4">
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
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOutIcon data-slot="icon" />
              Sign out
            </Button>
          </div>
          <AppearanceSettings className="border-t pt-4" />
          <DeleteAccountSection />
        </TabsPanel>

        <TabsPanel value="shortcuts">
          <ShortcutsSettings
            config={shortcutConfig}
            onChange={onShortcutConfigChange}
          />
        </TabsPanel>
      </Tabs>
    </PanelShell>
  )
}
