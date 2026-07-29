import { afterEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  createCanvasDocument,
  createPageNode,
  createTextNode,
  defaultLayout,
} from '@loora/canvas/model'
import {
  appUrl,
  createLooraServer,
  exportCanvasCode,
} from './server'
import { canvasAgentActivityNodeIds } from './designs'

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

describe('MCP agent workflow', () => {
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

  test('locates the nodes and parents an agent transaction is working on', () => {
    expect(
      canvasAgentActivityNodeIds([
        {
          id: 'tx-activity',
          label: 'MCP inserted nodes',
          operations: [
            {
              type: 'node.insert',
              node: createTextNode('New detail', {
                id: 'text-new',
                parentId: 'page-home',
              }),
            },
            {
              type: 'node.patch',
              id: 'text-title',
              patch: { text: 'Updated title' },
            },
            {
              type: 'token.upsert',
              token: {
                id: 'accent',
                name: 'Accent',
                type: 'color',
                value: '#3b82f6',
                modes: {},
              },
            },
          ],
        },
      ]),
    ).toEqual(['text-new', 'page-home', 'text-title'])
  })

  test('advertises context, code export, and a real screenshot tool', async () => {
    const server = createLooraServer('user-test')
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
      const createPage = tools.tools.find(
        (tool) => tool.name === 'createPage',
      )
      expect(createPage?.description).toContain('typed local state')
      expect(JSON.stringify(createPage?.inputSchema)).toContain(
        'toggle-state',
      )
      expect(
        tools.tools.find((tool) => tool.name === 'getScreenshot')
          ?.annotations?.readOnlyHint,
      ).toBe(true)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
