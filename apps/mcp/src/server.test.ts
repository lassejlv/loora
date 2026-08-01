import { afterEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import rustToolManifest from '../../../crates/mcp-server/src/tools.json'
import {
  createCanvasDocument,
  createPageNode,
  createTextNode,
  defaultLayout,
} from '@loora/canvas/model'
import {
  appUrl,
  createLooraServer,
  createLooraToolExecutor,
  exportCanvasCode,
} from './server'
import type { McpUsageController } from './server'

const originalAppUrl = process.env.LOORA_APP_URL

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.LOORA_APP_URL
  else process.env.LOORA_APP_URL = originalAppUrl
})

function documentFixture() {
  const document = createCanvasDocument('MCP fixture', 'doc-test')
  const page = createPageNode('Home', {
    id: 'page-home',
    layout: defaultLayout(800, 600),
    viewport: { width: 800, minHeight: 600 },
  })
  const text = createTextNode('Hello MCP', {
    id: 'text-title',
    parentId: page.id,
    layout: defaultLayout(320, 48, { x: 32, y: 32 }),
  })
  document.nodes[page.id] = page
  document.nodes[text.id] = text
  return document
}

function usageController(): McpUsageController {
  const snapshot = {
    metric: 'mcp_tool_calls' as const,
    plan: 'free' as const,
    included: 200,
    used: 12,
    remaining: 188,
    periodStart: '2026-07-27T00:00:00.000Z',
    resetsAt: '2026-08-03T00:00:00.000Z',
  }
  return {
    current: async () => snapshot,
    reserve: async () => snapshot,
  }
}

describe('MCP agent workflow', () => {
  test('executes the same registered handlers through the internal API boundary', async () => {
    const execute = createLooraToolExecutor('user-test', usageController(), 'free')
    const result = await execute('getUsage', {}) as {
      content: Array<{ type: string; text: string }>
    }
    expect(result.content[0]?.type).toBe('text')
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      metric: 'mcp_tool_calls',
      used: 12,
      remaining: 188,
    })
  })

  test('returns canonical Main and branch editor URLs', () => {
    process.env.LOORA_APP_URL = 'https://loora.test/'

    expect(appUrl('design one')).toBe(
      'https://loora.test/design/design%20one',
    )
    expect(
      appUrl('design one', 'branch one', { node: 'text-title' }),
    ).toBe(
      'https://loora.test/design/design%20one/b/branch%20one?node=text-title',
    )
  })

  test('exports the first Page as Tailwind, JSX, or standalone HTML', () => {
    const document = documentFixture()
    const page = document.nodes['page-home']
    if (page?.type !== 'page') throw new Error('Fixture Page is missing')
    page.states = {
      active: {
        id: 'active',
        name: 'Active',
        type: 'boolean',
        initial: false,
      },
    }
    document.nodes['text-title']!.interactions = [
      {
        trigger: 'click',
        actions: [{ type: 'toggle-state', stateId: 'active' }],
      },
    ]

    const tailwind = exportCanvasCode(document, {
      format: 'tailwind',
      width: 800,
    })
    const jsx = exportCanvasCode(document, {
      format: 'jsx',
      pageId: 'page-home',
      width: 800,
    })
    const html = exportCanvasCode(document, {
      format: 'html',
      ref: { nodeId: 'text-title', instancePath: [] },
      width: 800,
    })

    expect(tailwind.pageId).toBe('page-home')
    expect(tailwind.code).toContain('className=')
    expect(tailwind.code).toContain('[font-size:16px]')
    expect(tailwind.code).toContain('useLooraRuntime(rootRef)')
    expect(jsx.code).toContain('style={{')
    expect(html.code).toStartWith('<!doctype html>')
    expect(html.nodeId).toBe('text-title')
    expect(() =>
      exportCanvasCode(document, {
        format: 'tailwind',
        pageId: 'page-home',
        ref: { nodeId: 'text-title', instancePath: [] },
        width: 800,
      }),
    ).toThrow('Choose either pageId or ref')
  })

  test('advertises context, code export, and a real screenshot tool', async () => {
    let reservations = 0
    const usage = usageController()
    const server = createLooraServer('user-test', {
      current: usage.current,
      reserve: async () => {
        reservations += 1
        return usage.reserve()
      },
    }, 'free')
    const client = new Client({ name: 'loora-test', version: '1.0.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const tools = await client.listTools()
      const names = new Set(tools.tools.map((tool) => tool.name))
      expect(names.has('getDesignContext')).toBe(true)
      expect(names.has('exportCode')).toBe(true)
      expect(names.has('getScreenshot')).toBe(true)
      expect(names.has('getUsage')).toBe(true)
      const createPage = tools.tools.find(
        (tool) => tool.name === 'createPage',
      )
      expect(createPage?.description).toContain('typed local state')
      expect(JSON.stringify(createPage?.inputSchema)).toContain(
        'toggle-state',
      )
      expect(JSON.stringify(createPage?.inputSchema)).toContain(
        'set-theme',
      )
      const setTokens = tools.tools.find(
        (tool) => tool.name === 'setTokens',
      )
      expect(JSON.stringify(setTokens?.inputSchema)).toContain('themes')
      expect(setTokens?.description).toContain('named visual themes')
      expect(
        tools.tools.find((tool) => tool.name === 'getScreenshot')
          ?.annotations?.readOnlyHint,
      ).toBe(true)
      const usageResult = await client.callTool({
        name: 'getUsage',
        arguments: {},
      })
      expect(usageResult.isError).not.toBe(true)
      if (!Array.isArray(usageResult.content)) {
        throw new Error('Expected getUsage to return content')
      }
      const usageContent = usageResult.content[0]
      if (usageContent?.type !== 'text') {
        throw new Error('Expected getUsage to return text')
      }
      expect(JSON.parse(usageContent.text).remaining).toBe(188)
      expect(usageResult._meta?.['loora/usage']).toEqual(
        await usage.current(),
      )
      expect(reservations).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('keeps the tool manifest compact via shared schema definitions', async () => {
    const usage = usageController()
    const server = createLooraServer('user-test', usage, 'free')
    const client = new Client({ name: 'loora-test', version: '1.0.0' })
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const { tools } = await client.listTools()
      expect(tools as unknown).toEqual(rustToolManifest)
      expect(tools.length).toBeGreaterThanOrEqual(30)
      // The raw zod conversion inlined every shared shape into every tool
      // (~156KB total, patchNodes alone 43KB). The custom tools/list handler
      // hoists registered shapes into named definitions instead.
      const patchNodes = tools.find((tool) => tool.name === 'patchNodes')
      const schema = patchNodes?.inputSchema as {
        definitions?: Record<string, unknown>
      }
      expect(schema.definitions?.CanvasStylePatch).toBeDefined()
      expect(schema.definitions?.CanvasNodePatch).toBeDefined()
      expect(JSON.stringify(patchNodes).length).toBeLessThan(20_000)
      expect(JSON.stringify(tools).length).toBeLessThan(100_000)
      // Conversion still keeps the vocabulary the agents rely on.
      const insertNodes = tools.find((tool) => tool.name === 'insertNodes')
      const insertText = JSON.stringify(insertNodes?.inputSchema)
      expect(insertText).toContain('CanvasNodeDescriptor')
      expect(insertText).toContain('linear-gradient')
    } finally {
      await client.close()
      await server.close()
    }
  })
})
