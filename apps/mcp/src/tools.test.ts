import { describe, expect, test } from 'vitest'
import {
  advertisedTools,
  containsTupleItems,
  normalizeJsonArguments,
  schemaPointer,
  toolNames,
  validationSchemas,
  type JsonValue,
} from './tools'

describe('MCP tool manifest', () => {
  test('embeds the complete TypeScript tool manifest', () => {
    const names = toolNames()
    expect(names).toHaveLength(33)
    expect(names[0]).toBe('getUsage')
    expect(names).toContain('getScreenshot')
    expect(names.at(-1)).toBe('listAssets')
  })

  test('advertises Codex-compatible arrays without weakening validation schemas', () => {
    const radiusItems =
      '/definitions/CanvasStylePatch/properties/radius/anyOf/1/items'
    const createPage = validationSchemas.get('createPage')
    expect(createPage).toBeDefined()
    expect(Array.isArray(schemaPointer(createPage as JsonValue, radiusItems))).toBe(
      true,
    )
    const advertised = advertisedTools.find((tool) => tool.name === 'createPage')
    const advertisedItems = schemaPointer(
      advertised?.inputSchema as JsonValue,
      radiusItems,
    )
    expect(
      advertisedItems &&
        typeof advertisedItems === 'object' &&
        !Array.isArray(advertisedItems) &&
        Array.isArray((advertisedItems as { anyOf?: unknown }).anyOf),
    ).toBe(true)
    expect(containsTupleItems(advertisedTools as unknown as JsonValue)).toBe(
      false,
    )
  })

  test('decodes structured arguments sent as JSON text', () => {
    const args: JsonValue = {
      designId: 'd1',
      nodes: '[{"type":"text","text":"Hello"}]',
      query: '[literal text]',
    }
    normalizeJsonArguments(args)
    expect(Array.isArray((args as { nodes: unknown }).nodes)).toBe(true)
    expect((args as { query: unknown }).query).toBe('[literal text]')
  })
})
