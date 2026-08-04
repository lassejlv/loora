import { useState } from 'react'
import {
  LoginWithChatGPT,
  openLoginWithChatGPTConsentPopup,
} from '@opencoredev/loginwithchatgpt-react'
import { apiUrl } from '@loora/platform'
import { resetAgentAvailability } from '@loora/editor/agent-chat'
import { Button } from '@loora/ui/button'
import { Spinner } from '@loora/ui/spinner'
import { CopyIcon, ExternalLinkIcon, UnplugIcon } from '@loora/ui/icons'
import { IntegrationCard, IntegrationStatus } from './integration-card'

export function ChatGptAccount() {
  const [showConsent, setShowConsent] = useState(false)

  return (
    <LoginWithChatGPT
      basePath={apiUrl('/api/chatgpt')}
      onAuthenticated={resetAgentAvailability}
    >
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
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await state.logout()
                  resetAgentAvailability()
                }}
              >
                <UnplugIcon />
                Disconnect
              </Button>
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
                    <CopyIcon />
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={state.reopen}
                >
                  <ExternalLinkIcon />
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
                <li>Loora can send AI requests on your ChatGPT plan until you disconnect.</li>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConsent(false)}
                >
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
            description="Connect your ChatGPT account to run the canvas agent on your own plan. No API key needed."
          >
            <Button
              size="sm"
              className="w-fit"
              disabled={state.isConnecting}
              onClick={startLogin}
            >
              {state.isConnecting ? <Spinner /> : null}
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
