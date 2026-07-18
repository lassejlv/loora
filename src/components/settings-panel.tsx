import { useState } from 'react'
import { LogOutIcon, SparklesIcon, UserIcon } from 'lucide-react'
import { LoginWithChatGPT, useLoginWithChatGPT } from '@opencoredev/loginwithchatgpt-react'
import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/utils'

export type SettingsTab = 'account' | 'ai'

const TABS: { id: SettingsTab; label: string; icon: typeof UserIcon }[] = [
  { id: 'account', label: 'Account', icon: UserIcon },
  { id: 'ai', label: 'AI', icon: SparklesIcon },
]

export function SettingsPanel({ initialTab = 'account' }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const { data: session } = authClient.useSession()
  const chatgpt = useLoginWithChatGPT()

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-44 shrink-0 flex-col gap-0.5 border-r p-3">
        <p className="px-2 pt-1 pb-2 text-xs font-semibold text-muted-foreground">Settings</p>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === id
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {tab === 'account' && (
          <div className="flex max-w-md flex-col gap-6">
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
        )}

        {tab === 'ai' && (
          <div className="flex max-w-md flex-col gap-4">
            <div>
              <h3 className="text-sm font-medium">ChatGPT account</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect your ChatGPT subscription to run the agent on its models. Pick the model
                in the chat composer once connected.
              </p>
            </div>
            <LoginWithChatGPT consent={{ appName: 'loora' }} />
            {chatgpt.isAuthenticated && (
              <p className="text-xs text-muted-foreground">
                Connected as {chatgpt.user?.email ?? 'your ChatGPT account'}.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
