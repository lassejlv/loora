import {
  createStandardSchemaV1,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs'

export const SETTINGS_TABS = ['account', 'shortcuts'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const INTEGRATION_TABS = ['github', 'mcp', 'chatgpt'] as const
export type IntegrationTab = (typeof INTEGRATION_TABS)[number]

export const editorSearchParams = {
  d: parseAsString,
  draft: parseAsString,
  settings: parseAsStringLiteral(SETTINGS_TABS),
  layers: parseAsBoolean.withDefault(false),
  assets: parseAsBoolean.withDefault(false),
  history: parseAsBoolean.withDefault(false),
  code: parseAsBoolean.withDefault(false),
}

export const integrationsSearchParams = {
  integration: parseAsStringLiteral(INTEGRATION_TABS),
  github: parseAsString,
  chatgpt: parseAsString,
}

export const integrationsValidateSearch = createStandardSchemaV1(
  integrationsSearchParams,
  { partialOutput: true },
)

/**
 * `/design/$id` keys the open document from the path. The deep-link keys below
 * are read straight from `window.location` by the editor, so they are declared
 * here only to keep router navigations from dropping them.
 */
export const designSearchParams = {
  ...editorSearchParams,
  node: parseAsString,
  page: parseAsString,
  instancePath: parseAsString,
}

export const designValidateSearch = createStandardSchemaV1(designSearchParams, {
  partialOutput: true,
})

export const legacyDesignValidateSearch = createStandardSchemaV1(
  {
    ...designSearchParams,
    id: parseAsString,
  },
  {
    partialOutput: true,
  },
)
