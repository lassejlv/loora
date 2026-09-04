import { Validator } from '@cfworker/json-schema'
import toolsJson from './tools.json' with { type: 'json' }

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type McpTool = {
  name: string
  description?: string
  inputSchema?: JsonValue
  annotations?: Record<string, JsonValue>
}

const STRUCTURED_ARGUMENT_KEYS = [
  'activeThemeId',
  'animations',
  'changes',
  'children',
  'focus',
  'hover',
  'layout',
  'nodeIds',
  'nodes',
  'parent',
  'play',
  'presets',
  'press',
  'ref',
  'refs',
  'remove',
  'resolutions',
  'root',
  'states',
  'style',
  'themes',
  'tokens',
  'transition',
  'types',
] as const

const validationTools = toolsJson as unknown as McpTool[]

export const validationSchemas = new Map<string, JsonValue>(
  validationTools.flatMap((tool) =>
    tool.inputSchema ? [[tool.name, structuredClone(tool.inputSchema)] as const] : [],
  ),
)

export const advertisedTools: McpTool[] = structuredClone(validationTools)
for (const tool of advertisedTools) {
  if (tool.inputSchema) normalizeAdvertisedSchemas(tool.inputSchema)
}

const validators = new Map<string, Validator>()

export function toolNames() {
  return advertisedTools.map((tool) => tool.name)
}

/**
 * Codex models array `items` as one schema and drops tools that use Draft 7's
 * tuple form. Advertise the tuple's possible item shapes while validating calls
 * against the original schema retained in `validationSchemas`.
 */
export function normalizeAdvertisedSchemas(value: JsonValue) {
  if (Array.isArray(value)) {
    for (const entry of value) normalizeAdvertisedSchemas(entry)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as { [key: string]: JsonValue }
  for (const nested of Object.values(record)) normalizeAdvertisedSchemas(nested)
  const items = record.items
  if (!Array.isArray(items)) return
  const variants: JsonValue[] = []
  for (const item of items) {
    if (!variants.some((variant) => jsonEqual(variant, item))) variants.push(item)
  }
  record.items = { anyOf: variants }
}

export function containsTupleItems(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsTupleItems)
  if (!value || typeof value !== 'object') return false
  const record = value as { [key: string]: JsonValue }
  return Array.isArray(record.items) || Object.values(record).some(containsTupleItems)
}

export function normalizeJsonArguments(args: JsonValue) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return
  const record = args as { [key: string]: JsonValue }
  for (const key of STRUCTURED_ARGUMENT_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue
    try {
      record[key] = JSON.parse(trimmed) as JsonValue
    } catch {
      // Leave the original string; the schema validator will reject it.
    }
  }
}

export function validateToolArguments(name: string, args: JsonValue) {
  const schema = validationSchemas.get(name)
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null
  let validator = validators.get(name)
  if (!validator) {
    validator = new Validator(schema as Record<string, unknown>, '7', false)
    validators.set(name, validator)
  }
  const result = validator.validate(args)
  if (result.valid) return null
  const details = result.errors
    .map((error) => error.error)
    .filter(Boolean)
    .join('; ')
  return details || 'arguments did not match the tool schema'
}

function jsonEqual(left: JsonValue, right: JsonValue) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function schemaPointer(schema: JsonValue, pointer: string) {
  let current: JsonValue = schema
  for (const part of pointer.split('/').filter(Boolean)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isInteger(index) || current[index] === undefined) return undefined
      current = current[index]!
      continue
    }
    if (!current || typeof current !== 'object') return undefined
    current = (current as { [key: string]: JsonValue })[key]
    if (current === undefined) return undefined
  }
  return current
}
