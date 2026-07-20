import { useState } from 'react'
import {
  LoginWithChatGPT,
  openLoginWithChatGPTConsentPopup,
} from '@opencoredev/loginwithchatgpt-react'
import {
  BotIcon,
  CheckIcon,
  CopyIcon,
  LoaderCircleIcon,
  LogOutIcon,
} from '#/components/icons'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'

export function ChatGPTAccount() {
  const [showConsent, setShowConsent] = useState(false)

  return (
    <LoginWithChatGPT basePath="/api/chatgpt">
      {(state) => {
        const startLogin = () => {
          const popup = openLoginWithChatGPTConsentPopup({
            appName: 'Loora',
            login: state.login,
          })
          if (!popup) setShowConsent(true)
        }

        if (state.status === 'loading') {
          return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Checking ChatGPT connection…
            </div>
          )
        }

        if (state.isAuthenticated) {
          return (
            <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                  <CheckIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">ChatGPT connected</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {state.user?.email ?? state.user?.name ?? 'Your ChatGPT account'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-fit" onClick={() => state.logout()}>
                <LogOutIcon data-slot="icon" />
                Disconnect
              </Button>
            </div>
          )
        }

        if (state.isPending) {
          return (
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Finish connecting on OpenAI</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter this one-time code on the verification page.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm tracking-widest">
                  {state.userCode}
                </code>
                <Button variant="outline" size="icon-sm" aria-label="Copy code" onClick={() => state.copyCode()}>
                  <CopyIcon data-slot="icon" />
                </Button>
              </div>
              <Button variant="outline" size="sm" className="w-fit" onClick={state.reopen}>
                <ExternalLinkIcon data-slot="icon" />
                Open verification page
              </Button>
            </div>
          )
        }

        if (showConsent) {
          return (
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Authorize Loora to use ChatGPT?</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                  <li>
                    Loora can send AI requests on your ChatGPT plan until you disconnect, and heavy use can exhaust its limits.
                  </li>
                  <li>Your prompts and files pass through Loora before reaching OpenAI.</li>
                  <li>Loora never sees your ChatGPT password.</li>
                  <li>Disconnecting deletes the ChatGPT session stored by Loora.</li>
                </ul>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={state.isConnecting}
                  onClick={() => {
                    setShowConsent(false)
                    void state.login()
                  }}
                >
                  Continue
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowConsent(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )
        }

        return (
          <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-foreground text-background">
                <BotIcon className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Use your ChatGPT plan</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Connect ChatGPT to use GPT-5.6 Sol in Loora. No OpenAI API key is needed.
                </p>
              </div>
            </div>
            <Button size="sm" className="w-fit" disabled={state.isConnecting} onClick={startLogin}>
              {state.isConnecting ? <LoaderCircleIcon className="animate-spin" data-slot="icon" /> : null}
              {state.isConnecting ? 'Connecting…' : 'Connect ChatGPT'}
            </Button>
            {state.error ? <p className="text-xs text-destructive-foreground">{state.error}</p> : null}
          </div>
        )
      }}
    </LoginWithChatGPT>
  )
}
