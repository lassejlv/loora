import {
  createStandardSchemaV1,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs'

export const SETTINGS_TABS = ['account', 'integrations', 'billing', 'shortcuts', 'admin'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const INTEGRATION_TABS = ['github', 'figma', 'mcp'] as const
export type IntegrationTab = (typeof INTEGRATION_TABS)[number]

const INTEGRATION_SETTINGS = new Set<string>(INTEGRATION_TABS)

export const editorSearchParams = {
  d: parseAsString,
  draft: parseAsString,
  settings: parseAsStringLiteral(SETTINGS_TABS),
  integration: parseAsStringLiteral(INTEGRATION_TABS),
  layers: parseAsBoolean.withDefault(false),
  assets: parseAsBoolean.withDefault(false),
  history: parseAsBoolean.withDefault(false),
  code: parseAsBoolean.withDefault(false),
}

export const editorValidateSearch = createStandardSchemaV1(editorSearchParams, {
  partialOutput: true,
})

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

export type EditorSearchParams = {
  d: string | null
  draft: string | null
  settings: SettingsTab | null
  integration: IntegrationTab | null
  layers: boolean
  assets: boolean
  history: boolean
  code: boolean
}

/** One-shot bootstrap from raw URL + localStorage before / alongside nuqs defaults. */
export function bootstrapEditorSearch(activeId: string): Partial<{
  d: string
  settings: SettingsTab
  integration: IntegrationTab
  layers: boolean
}> {
  if (typeof window === 'undefined') return {}
  const raw = new URLSearchParams(window.location.search)
  const patch: Partial<{
    d: string
    settings: SettingsTab
    integration: IntegrationTab
    layers: boolean
  }> = {}

  const settingsRaw = raw.get('settings')
  if (settingsRaw && INTEGRATION_SETTINGS.has(settingsRaw)) {
    patch.settings = 'integrations'
    patch.integration = settingsRaw as IntegrationTab
  } else if (settingsRaw === 'integrations') {
    patch.settings = 'integrations'
    const integrationRaw = raw.get('integration')
    if (integrationRaw && INTEGRATION_SETTINGS.has(integrationRaw)) {
      patch.integration = integrationRaw as IntegrationTab
    }
  } else if (settingsRaw && (SETTINGS_TABS as readonly string[]).includes(settingsRaw)) {
    patch.settings = settingsRaw as SettingsTab
  }

  if (!raw.get('d') && activeId) patch.d = activeId

  if (raw.get('layers') === null && window.localStorage.getItem('loora:layers') === '1') {
    patch.layers = true
  }

  return patch
}

export function readUrlDesignId(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('d')
}
