import { useQueryStates } from 'nuqs'
import { GitHubAccount } from './github-account'
import { McpSessions } from './mcp-sessions'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@loora/ui/tabs'
import {
  integrationsSearchParams,
  type IntegrationTab,
} from '../lib/url-state'

export function IntegrationsSettings() {
  const [{ integration }, setSearch] = useQueryStates(integrationsSearchParams, {
    history: 'replace',
  })
  const active: IntegrationTab = integration ?? 'mcp'

  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        void setSearch({ integration: value as IntegrationTab })
      }}
      className="flex flex-col gap-5"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTab value="mcp">MCP</TabsTab>
        <TabsTab value="github">GitHub</TabsTab>
      </TabsList>
      <TabsPanel value="mcp" id="integration-mcp">
        <McpSessions />
      </TabsPanel>
      <TabsPanel value="github" id="integration-github">
        <GitHubAccount />
      </TabsPanel>
    </Tabs>
  )
}
