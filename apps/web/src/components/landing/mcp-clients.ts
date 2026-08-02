/**
 * One entry per MCP client, and the source of `/mcp` and every `/mcp/$client`
 * page.
 *
 * These pages exist because the answer genuinely differs per client: the file
 * is in a different place, the key is called something else, and half of them
 * cannot do OAuth against a remote server without a local bridge. A page that
 * only swapped the product name would not be worth having, so anything shared
 * between clients (the tool table, the first-run sequence) lives in the page
 * component, and everything below is the part that is actually per client.
 */

export const MCP_ENDPOINT = 'https://mcp.loora.design/mcp'

export type McpClientCategory = 'CLI' | 'Editor' | 'App' | 'Terminal'

export type McpClient = {
  slug: string
  /** Product name, spelled the way the vendor spells it. */
  name: string
  category: McpClientCategory
  /** One line, shown in the `/mcp` grid. */
  tagline: string
  /**
   * `<title>`, written per client rather than derived from `headline`.
   * A generated set whose titles differ only by a product name reads as
   * templated to a search engine, and it is templated — so each one names the
   * thing that is actually different about that client's setup.
   */
  title: string
  /** `<h1>` on the client page. */
  headline: string
  /** Meta description. Written to read as a search result, not as a slogan. */
  description: string
  /**
   * `native` clients run the OAuth 2.1 flow themselves. `bridge` clients only
   * speak stdio, so `mcp-remote` runs the flow for them.
   */
  auth: 'native' | 'bridge'
  /** Where the configuration lives, in prose. */
  configPath: string
  /** Label above the code block — a filename, or `terminal`. */
  configLabel: string
  config: string
  /** A second block for clients where a command and a file are both involved. */
  secondary?: { label: string; code: string }
  /** Two or three sentences that are true of this client and no other. */
  intro: string
  steps: readonly string[]
  /** Version requirements, scope rules, known rough edges. */
  notes: readonly string[]
  faq: readonly { question: string; answer: string }[]
  related: readonly string[]
}

export const MCP_CLIENTS: readonly McpClient[] = [
  {
    slug: 'claude-code',
    name: 'Claude Code',
    category: 'CLI',
    tagline: 'One command, then /mcp to sign in.',
    title: 'Connect Claude Code to a design canvas over MCP',
    headline: 'Use Loora as a design tool in Claude Code.',
    description:
      'Add the Loora MCP server to Claude Code with one command and edit a real design canvas from the terminal. Remote HTTP transport, OAuth sign-in, no API key.',
    auth: 'native',
    configPath:
      'Written by the CLI: `.mcp.json` in the project for `--scope project`, `~/.claude.json` for `--scope user`.',
    configLabel: 'terminal',
    config: `claude mcp add --transport http loora ${MCP_ENDPOINT}`,
    secondary: {
      label: '.mcp.json (project scope, checked in)',
      code: `{
  "mcpServers": {
    "loora": {
      "type": "http",
      "url": "${MCP_ENDPOINT}"
    }
  }
}`,
    },
    intro:
      'Claude Code has first-class support for remote MCP servers over streamable HTTP, including the OAuth handshake, so nothing has to be bridged and no token is pasted anywhere. The default scope is local to the project you run the command in; `--scope user` makes the server available everywhere, and `--scope project` writes a checked-in `.mcp.json` your teammates pick up on their next run.',
    steps: [
      'Run the command above in the repository you want the design attached to.',
      'Run /mcp inside Claude Code, pick loora, and choose Authenticate.',
      'A browser opens on loora.design; approve the connection and return to the terminal.',
      'Run /mcp again — loora should read connected, with its tools listed underneath.',
      'Ask for listDesigns to confirm the tools reach your account.',
    ],
    notes: [
      'Add --scope user to register the server once for every project on the machine.',
      '--scope project writes .mcp.json into the repository, so a teammate is prompted to trust it rather than to configure it.',
      'Tokens are stored by Claude Code, not by Loora; claude mcp remove loora drops both the entry and the grant.',
      'The design guide skill is worth adding alongside the server — the tools say what an agent can do, not how to design.',
    ],
    faq: [
      {
        question: 'Do I need an API key to use Loora with Claude Code?',
        answer:
          'No. The Loora MCP server authenticates with OAuth 2.1 and PKCE. Running /mcp and choosing Authenticate opens a browser, you approve the connection with your normal Loora login, and Claude Code stores the resulting token itself.',
      },
      {
        question: 'Can Claude Code edit a design I have open in the browser?',
        answer:
          'Yes. The MCP server writes through the same validated transaction path the editor uses, and the canvas is pushed over realtime, so an edit made from the terminal appears in an open tab without a reload.',
      },
      {
        question: 'How do I share the Loora server with my team?',
        answer:
          'Use claude mcp add --scope project, which writes .mcp.json into the repository. Everyone still signs in as themselves — the file carries the endpoint, never a credential.',
      },
    ],
    related: ['codex', 'claude', 'cursor'],
  },
  {
    slug: 'claude',
    name: 'Claude app',
    category: 'App',
    tagline: 'A custom connector in Settings.',
    title: 'Add Loora to the Claude app as a custom connector',
    headline: 'Add Loora to the Claude app as a connector.',
    description:
      'Connect the Claude desktop or web app to Loora as a custom MCP connector. Paste one URL, sign in once, and design on a real canvas from a chat.',
    auth: 'native',
    configPath: 'Stored in your Claude account — the same connector follows you to the web app.',
    configLabel: 'endpoint',
    config: MCP_ENDPOINT,
    intro:
      'The Claude desktop and web apps take remote MCP servers as custom connectors, which means there is no file to edit and nothing to install: the endpoint above is the entire configuration. Because the connector is stored on your Claude account rather than on the machine, adding it in the desktop app also adds it on claude.ai.',
    steps: [
      'Open Settings → Connectors → Add custom connector.',
      'Paste the endpoint above and give it the name Loora.',
      'Save, then click Connect and approve the connection when the browser opens.',
      'Start a chat and ask Claude to list your Loora designs.',
    ],
    notes: [
      'Custom connectors require a paid Claude plan; the endpoint itself is the same one every other client uses.',
      'Turn individual tools off from the connector panel if you want a read-only session — leaving only the read and view tools on is a good way to hand a design over for review.',
      'The chat has no canvas of its own: ask for viewCanvas or getScreenshot and Claude renders an image of the real document inline.',
    ],
    faq: [
      {
        question: 'Does the Claude web app work, or only the desktop app?',
        answer:
          'Both. A custom connector is stored on your Claude account, so adding it in one place makes it available in the other. The transport is remote streamable HTTP, so nothing needs to run on your machine.',
      },
      {
        question: 'Can Claude see what the design looks like?',
        answer:
          'Yes. viewCanvas, viewPage, and viewNode render the real document to an image, and getScreenshot captures a page or a single node, so the model can look at its own work rather than reasoning about coordinates alone.',
      },
      {
        question: 'Is my design data shared with other Claude users?',
        answer:
          'No. Tools run under the Loora account you signed in with and are scoped to that account. There is no shared or public tool access.',
      },
    ],
    related: ['claude-code', 'cursor', 'vscode'],
  },
  {
    slug: 'codex',
    name: 'Codex',
    category: 'CLI',
    tagline: 'codex mcp add, then codex mcp login.',
    title: 'Connect Codex to a design canvas over MCP',
    headline: 'Use Loora as a design canvas in Codex.',
    description:
      'Add the Loora MCP server to the Codex CLI. Two commands, an OAuth login in the browser, and Codex can read and edit structured design files.',
    auth: 'native',
    configPath: '`~/.codex/config.toml`, under a `[mcp_servers.loora]` table.',
    configLabel: 'terminal',
    config: `codex mcp add loora --url ${MCP_ENDPOINT}\ncodex mcp login loora`,
    secondary: {
      label: '~/.codex/config.toml',
      code: `[mcp_servers.loora]
url = "${MCP_ENDPOINT}"`,
    },
    intro:
      'Codex keeps MCP servers in TOML rather than JSON, and it separates registering a server from authenticating against it: `codex mcp add` writes the entry, `codex mcp login` runs the OAuth flow. Doing them as two steps means a failed login never leaves you with a half-written config to clean up.',
    steps: [
      'Run codex mcp add loora --url … to write the entry into ~/.codex/config.toml.',
      'Run codex mcp login loora; the browser opens for the OAuth handshake.',
      'Approve the connection on loora.design and close the tab.',
      'Run codex mcp list to check that loora is present and authenticated.',
      'Ask Codex for getDesignContext on a design before it starts editing.',
    ],
    notes: [
      'The entry is a TOML table, not a JSON object — hand-editing it means [mcp_servers.loora] with url = "…" underneath.',
      'codex mcp login is a separate step from codex mcp add; adding the server alone leaves every call returning 401.',
      'codex mcp logout loora drops the token without removing the server, which is the quickest way to re-run a failed handshake.',
    ],
    faq: [
      {
        question: 'Where does Codex store the Loora MCP server?',
        answer:
          'In ~/.codex/config.toml, as a [mcp_servers.loora] table with a url key. codex mcp add writes it for you; editing the file by hand does the same thing.',
      },
      {
        question: 'Why does Codex return 401 from every Loora tool?',
        answer:
          'The server is registered but not authenticated. Run codex mcp login loora and complete the browser handshake. If it was working before, the token expired — codex mcp logout loora followed by a fresh login clears it.',
      },
      {
        question: 'Can Codex export the design as code?',
        answer:
          'Yes. exportCode returns HTML and CSS, React/TSX, plain JSX, Tailwind utilities, or the raw JSON document. The export is one-way: edited code never comes back into the canvas.',
      },
    ],
    related: ['claude-code', 'cursor', 'opencode'],
  },
  {
    slug: 'cursor',
    name: 'Cursor',
    category: 'Editor',
    tagline: 'A url entry in ~/.cursor/mcp.json.',
    title: 'Cursor MCP setup for a real design canvas',
    headline: 'Connect Cursor to a Loora design over MCP.',
    description:
      'Add Loora to Cursor as a remote MCP server. One JSON entry in ~/.cursor/mcp.json, a login from the MCP settings panel, and Cursor can edit a real design canvas.',
    auth: 'native',
    configPath:
      '`~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` inside one repository.',
    configLabel: '~/.cursor/mcp.json',
    config: `{
  "mcpServers": {
    "loora": {
      "url": "${MCP_ENDPOINT}"
    }
  }
}`,
    intro:
      'Cursor reads MCP servers from two places, and the narrower one wins: `.cursor/mcp.json` in a repository applies to that project, `~/.cursor/mcp.json` applies everywhere. A remote server needs nothing but a `url` — the `command` and `args` shape in most examples is for local stdio servers and does not apply here.',
    steps: [
      'Create ~/.cursor/mcp.json with the block above, or add loora to the mcpServers object already there.',
      'Open Settings → Cursor Settings → MCP and find loora in the list.',
      'Click Login and approve the connection in the browser.',
      'Wait for the status dot to turn green; the Loora tools then appear in the agent’s tool list.',
      'In Agent mode, ask it to list your designs.',
    ],
    notes: [
      'Use url, not command — command is for stdio servers you run locally, and Loora is remote.',
      'A project-level .cursor/mcp.json overrides the global file for that repository, which is useful when one repo should reach one design account.',
      'Cursor caps how many tools it sends to the model at once; if Loora’s tools stop appearing, disable a server you are not using in the MCP panel.',
      'The toggle in the MCP panel disables a server without deleting it — quicker than editing JSON when you want a quiet session.',
    ],
    faq: [
      {
        question: 'Can Cursor design UI instead of just writing components?',
        answer:
          'With Loora connected it edits a structured design document — pages, frames, text, tokens, components — and you see the result on a canvas rather than in a preview of generated code. Export to React or HTML afterwards if you want the code.',
      },
      {
        question: 'Why is the Loora server showing a red dot in Cursor?',
        answer:
          'Almost always the login step. Open the MCP panel and click Login on the loora row. If the browser handshake completes but the dot stays red, reload the Cursor window — it re-reads mcp.json on reload.',
      },
      {
        question: 'Project config or global config?',
        answer:
          'Global ~/.cursor/mcp.json is the right default, since a design account is not per repository. Use .cursor/mcp.json inside a repo when that repo should be pinned to one specific setup.',
      },
    ],
    related: ['vscode', 'windsurf', 'cline'],
  },
  {
    slug: 'opencode',
    name: 'opencode',
    category: 'CLI',
    tagline: 'A remote entry in opencode.json.',
    title: 'Add Loora to opencode as a remote MCP server',
    headline: 'Add Loora to opencode as a remote MCP server.',
    description:
      'Configure the Loora MCP server in opencode.json. Remote type, one URL, OAuth on the first tool call — then opencode can build on a real design canvas.',
    auth: 'native',
    configPath: '`opencode.json` at the project root, or `~/.config/opencode/opencode.json`.',
    configLabel: 'opencode.json',
    config: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "loora": {
      "type": "remote",
      "url": "${MCP_ENDPOINT}",
      "enabled": true
    }
  }
}`,
    intro:
      'opencode splits MCP servers by transport explicitly: `"type": "local"` for a process it spawns, `"type": "remote"` for a URL it calls. Loora is the second, so the entry is three keys and no command. The schema reference at the top is worth keeping — it is what gives you completion and validation while editing the file.',
    steps: [
      'Add the mcp block above to opencode.json, or merge loora into the one already there.',
      'Restart opencode so it re-reads the configuration.',
      'Make any Loora tool call; the first one triggers the OAuth flow in your browser.',
      'Approve the connection and the call completes on its own.',
    ],
    notes: [
      '"type": "remote" is required — omitting it makes opencode treat the entry as a local process and fail to spawn it.',
      'Setting "enabled": false keeps the entry but stops the tools from loading, which is the cheapest way to shrink a context window.',
      'A project-level opencode.json takes precedence over the one in ~/.config/opencode.',
    ],
    faq: [
      {
        question: 'Does opencode support remote MCP servers?',
        answer:
          'Yes, through "type": "remote" with a url. That is the shape Loora needs; there is nothing to install locally and no process for opencode to manage.',
      },
      {
        question: 'When does opencode ask me to sign in?',
        answer:
          'On the first tool call after the server is enabled, not at startup. The browser opens, you approve, and the call that triggered the flow finishes normally.',
      },
      {
        question: 'Can I keep the server configured but switched off?',
        answer:
          'Set "enabled": false. The entry stays in opencode.json and no tools are loaded into the session.',
      },
    ],
    related: ['codex', 'claude-code', 'goose'],
  },
  {
    slug: 'vscode',
    name: 'VS Code',
    category: 'Editor',
    tagline: 'An http server in .vscode/mcp.json.',
    title: 'VS Code MCP setup for Copilot agent mode',
    headline: 'Use Loora from GitHub Copilot agent mode in VS Code.',
    description:
      'Add Loora to VS Code as an MCP server for Copilot agent mode. One .vscode/mcp.json entry with type http, then design on a real canvas from the editor.',
    auth: 'native',
    configPath: '`.vscode/mcp.json` in the workspace, or the user-level `mcp.json` via the command palette.',
    configLabel: '.vscode/mcp.json',
    config: `{
  "servers": {
    "loora": {
      "type": "http",
      "url": "${MCP_ENDPOINT}"
    }
  }
}`,
    intro:
      'VS Code uses `servers`, not `mcpServers`, and it wants the transport named: `"type": "http"` for a streamable HTTP server like Loora. It is the one configuration key most commonly copied wrong, because almost every other client in this list spells the outer object differently.',
    steps: [
      'Run MCP: Add Server from the command palette, or create .vscode/mcp.json with the block above.',
      'Choose whether the server belongs to this workspace or to your user profile.',
      'Open the Chat view, switch the mode selector to Agent, and open the tools picker.',
      'Click Start on the loora server and approve the sign-in when the browser opens.',
      'Confirm the Loora tools are checked in the tools picker before you prompt.',
    ],
    notes: [
      'MCP support in agent mode needs a current VS Code — if there is no Agent entry in the chat mode selector, update first.',
      'The outer key is servers. A block starting with mcpServers is Cursor or Claude syntax and VS Code will ignore it.',
      'A workspace .vscode/mcp.json is checked in with the repository; it carries the endpoint only, never a token.',
      'The tools picker has a per-tool checkbox, so you can leave the destructive tools such as deleteNodes and deleteDesign unchecked.',
    ],
    faq: [
      {
        question: 'Why does VS Code not see my MCP server?',
        answer:
          'The most common cause is the outer key. VS Code expects "servers", while Cursor and Claude expect "mcpServers". The second is the transport: a remote server needs "type": "http".',
      },
      {
        question: 'Does this work with Copilot, or do I need another extension?',
        answer:
          'It works with Copilot Chat in agent mode. Switch the chat mode selector to Agent and the MCP tools appear in the tools picker.',
      },
      {
        question: 'Can I stop the agent from deleting things?',
        answer:
          'Uncheck deleteNodes, deleteDesign, and closeBranch in the tools picker. On the Loora side every write is a logged transaction, so anything that does land can be rolled back from version history.',
      },
    ],
    related: ['cursor', 'cline', 'windsurf'],
  },
  {
    slug: 'windsurf',
    name: 'Windsurf',
    category: 'Editor',
    tagline: 'A serverUrl entry for Cascade.',
    title: 'Windsurf MCP setup — connect Cascade to a design canvas',
    headline: 'Connect Windsurf Cascade to Loora over MCP.',
    description:
      'Add the Loora MCP server to Windsurf. One serverUrl entry in mcp_config.json, then Cascade can read and edit a structured design canvas.',
    auth: 'native',
    configPath: '`~/.codeium/windsurf/mcp_config.json`.',
    configLabel: '~/.codeium/windsurf/mcp_config.json',
    config: `{
  "mcpServers": {
    "loora": {
      "serverUrl": "${MCP_ENDPOINT}"
    }
  }
}`,
    intro:
      'Windsurf names the remote-server key `serverUrl` rather than `url`, which is the single difference between a working entry and a silently ignored one. Cascade reads the file on refresh rather than on save, so the panel button matters as much as the edit.',
    steps: [
      'Open Cascade, then the Plugins or MCP panel, and choose Configure to open mcp_config.json.',
      'Add the loora entry above and save the file.',
      'Click Refresh in the MCP panel so Cascade re-reads the configuration.',
      'Complete the sign-in when the browser opens, then confirm the Loora tools are listed.',
    ],
    notes: [
      'serverUrl, not url — a url key in Windsurf is read as a local server definition and dropped.',
      'Cascade does not hot-reload the file; Refresh in the MCP panel is what picks up an edit.',
      'Windsurf shows a tool count per server, which is the fastest confirmation that the handshake actually completed.',
    ],
    faq: [
      {
        question: 'Why is my Windsurf MCP entry ignored?',
        answer:
          'Check the key name. Windsurf uses serverUrl for a remote server. A url key — correct in Cursor — is not read here, and the entry is skipped without an error.',
      },
      {
        question: 'Do I have to restart Windsurf?',
        answer:
          'No. Clicking Refresh in the MCP panel re-reads mcp_config.json. A full restart works too but is rarely necessary.',
      },
      {
        question: 'What can Cascade actually change in a design?',
        answer:
          'Everything the editor can: pages, frames, text, shapes, images, components, instances, design tokens, and motion. Each change is a validated transaction, so it is inspectable and undoable.',
      },
    ],
    related: ['cursor', 'vscode', 'cline'],
  },
  {
    slug: 'cline',
    name: 'Cline',
    category: 'Editor',
    tagline: 'Added from the Remote Servers tab.',
    title: 'Add Loora to Cline as a remote MCP server',
    headline: 'Add Loora to Cline as a remote MCP server.',
    description:
      'Connect Cline to Loora from the MCP Servers panel. Paste one URL under Remote Servers and Cline can edit a real design document from VS Code.',
    auth: 'native',
    configPath:
      '`cline_mcp_settings.json`, in the extension’s global storage — the panel is the supported way to edit it.',
    configLabel: 'Remote Servers → Server URL',
    config: MCP_ENDPOINT,
    secondary: {
      label: 'cline_mcp_settings.json',
      code: `{
  "mcpServers": {
    "loora": {
      "type": "streamableHttp",
      "url": "${MCP_ENDPOINT}",
      "disabled": false
    }
  }
}`,
    },
    intro:
      'Cline is configured from a panel rather than from a file you keep in a repository: the MCP Servers icon opens a Remote Servers tab where a name and a URL is the whole form. The underlying file exists, but it lives in VS Code’s extension storage, so the path differs per operating system and the panel is the sane way in.',
    steps: [
      'Click the MCP Servers icon in the Cline sidebar.',
      'Open the Remote Servers tab and choose Add server.',
      'Enter loora as the name and the endpoint above as the URL, then save.',
      'Approve the sign-in when the browser opens.',
      'Check that the server row shows green with its tools expanded underneath.',
    ],
    notes: [
      'Cline asks before each tool call by default. Auto-approve the read tools — readNode, readTree, searchNodes — and leave the writes prompting until you trust the flow.',
      'If you edit cline_mcp_settings.json by hand, the transport key is "type": "streamableHttp".',
      'The per-server toggle in the panel disables Loora without removing it.',
    ],
    faq: [
      {
        question: 'Where is Cline’s MCP settings file?',
        answer:
          'In the extension’s global storage directory, which differs per platform. Use the MCP Servers panel instead of the path — the Remote Servers tab writes the same file.',
      },
      {
        question: 'Can I stop Cline asking before every Loora call?',
        answer:
          'Yes, per tool. Auto-approving the read and view tools makes exploration fluid while writes still prompt. Nothing is lost either way: every write is a logged transaction with history behind it.',
      },
      {
        question: 'Does Cline support streamable HTTP MCP servers?',
        answer:
          'Yes. Add it under Remote Servers, or set "type": "streamableHttp" with the URL if you are editing the settings file directly.',
      },
    ],
    related: ['vscode', 'cursor', 'windsurf'],
  },
  {
    slug: 'gemini-cli',
    name: 'Gemini CLI',
    category: 'CLI',
    tagline: 'An httpUrl entry in settings.json.',
    title: 'Gemini CLI MCP setup — httpUrl, not url',
    headline: 'Connect Gemini CLI to Loora over MCP.',
    description:
      'Add Loora to Gemini CLI with an httpUrl entry in ~/.gemini/settings.json, then design on a structured canvas from the terminal.',
    auth: 'native',
    configPath: '`~/.gemini/settings.json`, or `.gemini/settings.json` in a project.',
    configLabel: '~/.gemini/settings.json',
    config: `{
  "mcpServers": {
    "loora": {
      "httpUrl": "${MCP_ENDPOINT}"
    }
  }
}`,
    intro:
      'Gemini CLI distinguishes the two remote transports by key name: `httpUrl` for streamable HTTP, `url` for the older server-sent-events transport. Loora is streamable HTTP, so `httpUrl` is the one you want — `url` will attempt an SSE handshake and time out.',
    steps: [
      'Add the mcpServers block above to ~/.gemini/settings.json.',
      'Start Gemini CLI and run /mcp to list configured servers.',
      'Authenticate loora when prompted and approve in the browser.',
      'Run /mcp once more to confirm the tools are loaded.',
    ],
    notes: [
      'httpUrl is streamable HTTP; url is SSE. Using the wrong one fails as a connection timeout rather than as a config error.',
      'A project-level .gemini/settings.json merges over the home-directory file.',
      'trust: true on the entry skips the per-call confirmation — worth it only once you are used to what the write tools do.',
    ],
    faq: [
      {
        question: 'httpUrl or url in Gemini CLI?',
        answer:
          'httpUrl. It selects the streamable HTTP transport, which is what the Loora MCP server speaks. The url key selects SSE and will not connect.',
      },
      {
        question: 'How do I check the server is connected?',
        answer:
          'Run /mcp inside Gemini CLI. It lists every configured server with its status and the tools it exposes.',
      },
      {
        question: 'Can I scope the server to one project?',
        answer:
          'Yes. Put the same block in .gemini/settings.json inside the project; it merges over your home-directory settings.',
      },
    ],
    related: ['claude-code', 'codex', 'goose'],
  },
  {
    slug: 'goose',
    name: 'Goose',
    category: 'CLI',
    tagline: 'A streamable_http extension.',
    title: 'Goose MCP setup — a streamable HTTP extension',
    headline: 'Add Loora to Goose as a remote extension.',
    description:
      'Configure Loora as a streamable HTTP extension in Goose. Run goose configure, add the remote extension, and Goose can build on a real design canvas.',
    auth: 'native',
    configPath: '`~/.config/goose/config.yaml`, under `extensions`.',
    configLabel: 'terminal',
    config: 'goose configure',
    secondary: {
      label: '~/.config/goose/config.yaml',
      code: `extensions:
  loora:
    enabled: true
    type: streamable_http
    uri: ${MCP_ENDPOINT}
    timeout: 300`,
    },
    intro:
      'Goose calls MCP servers extensions and configures them in YAML rather than JSON. The interactive `goose configure` flow writes the same block shown here, which is worth knowing because the key names — `type: streamable_http` and `uri` rather than `url` — are hard to guess.',
    steps: [
      'Run goose configure and choose Add Extension.',
      'Pick Remote Extension (Streaming HTTP) as the type.',
      'Name it loora and paste the endpoint as the URI.',
      'Accept the default timeout and finish the flow.',
      'Start a session and complete the browser sign-in on the first tool call.',
    ],
    notes: [
      'The key is uri, not url, and the type is streamable_http with an underscore.',
      'Raise timeout for long runs: an agent inserting a full page of nodes can outlive a short default.',
      'enabled: false keeps the extension configured while dropping its tools from the session.',
    ],
    faq: [
      {
        question: 'How do I add a remote MCP server to Goose?',
        answer:
          'goose configure → Add Extension → Remote Extension (Streaming HTTP), then paste the URL. It writes an entry with type: streamable_http and a uri key into ~/.config/goose/config.yaml.',
      },
      {
        question: 'Why does Goose time out mid-build?',
        answer:
          'The extension timeout. A large insertNodes call takes longer than a conservative default; raise timeout on the loora extension.',
      },
      {
        question: 'Can I run Goose against a branch instead of the live design?',
        answer:
          'Yes. Ask it for createBranch first. Work stays on the branch until you apply it, and Main is untouched in the meantime.',
      },
    ],
    related: ['opencode', 'gemini-cli', 'codex'],
  },
  {
    slug: 'zed',
    name: 'Zed',
    category: 'Editor',
    tagline: 'Through the mcp-remote bridge.',
    title: 'Zed MCP setup through the mcp-remote bridge',
    headline: 'Use Loora in Zed through an MCP context server.',
    description:
      'Add Loora to Zed as a context server. Zed spawns a local mcp-remote bridge, which handles the OAuth flow and speaks to the remote Loora endpoint.',
    auth: 'bridge',
    configPath: '`settings.json`, under `context_servers`.',
    configLabel: 'Zed settings.json',
    config: `{
  "context_servers": {
    "loora": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_ENDPOINT}"],
      "env": {}
    }
  }
}`,
    intro:
      'Zed’s context servers are processes it spawns and talks to over stdio, so a remote HTTP server needs a bridge in between. `mcp-remote` is that bridge: Zed runs it as a local command, it opens the OAuth flow in your browser on first use, and it caches the token under `~/.mcp-auth` so later sessions start silently.',
    steps: [
      'Open the command palette and run zed: open settings.',
      'Add the context_servers block above.',
      'Save; Zed spawns the bridge and a browser tab opens for sign-in.',
      'Approve the connection, then check the Agent Panel for the Loora tools.',
    ],
    notes: [
      'The bridge needs Node on your PATH — npx is what Zed actually executes.',
      'The first run is slower because npx downloads mcp-remote; later launches reuse the cached package.',
      'Tokens live in ~/.mcp-auth. Deleting that directory forces a clean re-authentication if the handshake gets stuck.',
    ],
    faq: [
      {
        question: 'Does Zed support remote MCP servers directly?',
        answer:
          'Zed’s context servers are spawned as local processes over stdio, so a remote HTTP endpoint goes through the mcp-remote bridge. Zed runs the bridge; the bridge talks to Loora.',
      },
      {
        question: 'What is mcp-remote?',
        answer:
          'A small stdio-to-HTTP proxy for MCP. It presents a remote server to a stdio-only client, runs the OAuth flow in a browser, and caches the token under ~/.mcp-auth.',
      },
      {
        question: 'The browser never opens — what now?',
        answer:
          'Usually a stale token or a half-finished grant. Remove ~/.mcp-auth and restart Zed so the bridge starts a fresh handshake.',
      },
    ],
    related: ['cursor', 'vscode', 'warp'],
  },
  {
    slug: 'warp',
    name: 'Warp',
    category: 'Terminal',
    tagline: 'Added from Settings → AI → MCP.',
    title: 'Warp MCP setup for a design canvas',
    headline: 'Add Loora to Warp as an MCP server.',
    description:
      'Connect Warp’s agent to Loora over MCP. Add the server as JSON in Settings → AI → MCP Servers and design on a real canvas from the terminal.',
    auth: 'native',
    configPath: 'Stored by Warp; managed from Settings → AI → MCP Servers.',
    configLabel: 'Warp → Add MCP server (JSON)',
    config: `{
  "loora": {
    "url": "${MCP_ENDPOINT}"
  }
}`,
    intro:
      'Warp’s MCP form takes a JSON fragment keyed by server name, without the `mcpServers` wrapper the file-based clients use — pasting a wrapped block is the usual reason an entry does not appear. Servers can be set to start with Warp or started by hand from the same panel.',
    steps: [
      'Open Settings → AI → MCP Servers and choose Add.',
      'Pick the JSON option and paste the fragment above.',
      'Save, then Start the server from the list.',
      'Approve the sign-in when the browser opens.',
      'Ask the Warp agent to list your Loora designs.',
    ],
    notes: [
      'No mcpServers wrapper — Warp’s form is keyed by the server name directly.',
      'Set the server to start with Warp if you use it daily; otherwise start it per session from the panel.',
      'The panel shows the server’s log, which is where a failed handshake actually reports itself.',
    ],
    faq: [
      {
        question: 'Why did my pasted MCP JSON not work in Warp?',
        answer:
          'Warp expects the server object keyed by name, not wrapped in mcpServers. Paste the inner fragment only.',
      },
      {
        question: 'Does the server stay running between sessions?',
        answer:
          'Only if you enable start with Warp on the entry. Otherwise start it from Settings → AI → MCP Servers when you need it.',
      },
      {
        question: 'Where do I see why a connection failed?',
        answer:
          'The MCP panel exposes a per-server log. An expired grant shows up as a 401 there; restart the server to trigger a fresh sign-in.',
      },
    ],
    related: ['claude-code', 'codex', 'zed'],
  },
] as const

export function findMcpClient(slug: string) {
  return MCP_CLIENTS.find((client) => client.slug === slug)
}

/** Ordered for the hub grid: the clients most people arrive with, first. */
export const MCP_CLIENT_CATEGORIES: readonly McpClientCategory[] = ['CLI', 'Editor', 'App', 'Terminal']

/**
 * The tool vocabulary, grouped. Shared by `/mcp` and every client page — it is
 * reference material, and saying it differently per page would only make it
 * less useful.
 */
export const MCP_TOOL_GROUPS = [
  {
    group: 'Read',
    tools: 'listDesigns, getDesignContext, readNode, readTree, searchNodes, listAssets, listVersions',
  },
  { group: 'Write', tools: 'createPage, insertNodes, patchNodes, moveNodes, deleteNodes' },
  { group: 'Reuse', tools: 'createComponent, createInstance, setTokens' },
  { group: 'Motion', tools: 'setAnimations, animateNodes' },
  { group: 'Look', tools: 'viewCanvas, viewPage, viewNode, getScreenshot' },
  {
    group: 'Branches',
    tools: 'listBranches, createBranch, proposeBranch, compareBranch, applyBranch, reopenBranch, closeBranch',
  },
  { group: 'Designs', tools: 'createDesign, renameDesign, deleteDesign, exportCode' },
] as const
