import { useState } from 'react'
import {
  LoginWithChatGPT,
  openLoginWithChatGPTConsentPopup,
} from '@opencoredev/loginwithchatgpt-react'
import { CopyIcon, LoaderCircleIcon, LogOutIcon } from '#/components/icons'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { IntegrationCard, IntegrationStatus } from '#/components/integration-card'

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
            <IntegrationCard
              title="ChatGPT"
              status={<IntegrationStatus>Checking…</IntegrationStatus>}
              description="Loading connection status…"
            />
          )
        }

        if (state.isAuthenticated) {
          return (
            <IntegrationCard
              title="ChatGPT"
              status={<IntegrationStatus tone="success">Connected</IntegrationStatus>}
              description={state.user?.email ?? state.user?.name ?? 'Your ChatGPT account'}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => state.logout()}>
                  <LogOutIcon data-slot="icon" />
                  Disconnect
                </Button>
              </div>
            </IntegrationCard>
          )
        }

        if (state.isPending) {
          return (
            <IntegrationCard
              title="ChatGPT"
              status={<IntegrationStatus tone="warning">Verify</IntegrationStatus>}
              description="Enter this one-time code on the OpenAI verification page."
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm tracking-widest">
                    {state.userCode}
                  </code>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Copy code"
                    onClick={() => state.copyCode()}
                  >
                    <CopyIcon data-slot="icon" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" className="w-fit" onClick={state.reopen}>
                  <ExternalLinkIcon data-slot="icon" />
                  Open verification page
                </Button>
              </div>
            </IntegrationCard>
          )
        }

        if (showConsent) {
          return (
            <IntegrationCard
              title="ChatGPT"
              status={<IntegrationStatus>Authorize</IntegrationStatus>}
              description="Authorize Loora to use your ChatGPT plan."
            >
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                <li>
                  Loora can send AI requests on your ChatGPT plan until you disconnect, and heavy use
                  can exhaust its limits.
                </li>
                <li>Your prompts and files pass through Loora before reaching OpenAI.</li>
                <li>Loora never sees your ChatGPT password.</li>
                <li>Disconnecting deletes the ChatGPT session stored by Loora.</li>
              </ul>
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
            </IntegrationCard>
          )
        }

        return (
          <IntegrationCard
            title="ChatGPT"
            status={<IntegrationStatus>Not connected</IntegrationStatus>}
            description="Use GPT-5.6 Sol and other ChatGPT-backed models with your own plan. No OpenAI API key needed."
          >
            <Button size="sm" className="w-fit" disabled={state.isConnecting} onClick={startLogin}>
              {state.isConnecting ? (
                <LoaderCircleIcon className="animate-spin" data-slot="icon" />
              ) : null}
              {state.isConnecting ? 'Connecting…' : 'Connect ChatGPT'}
            </Button>
            {state.error ? (
              <p className="text-xs text-destructive-foreground">{state.error}</p>
            ) : null}
          </IntegrationCard>
        )
      }}
    </LoginWithChatGPT>
  )
}
