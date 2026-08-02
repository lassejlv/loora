import { describe, expect, it } from 'vitest'
import {
  HTML_IMPORT_SANDBOX_BASE_CSS,
  TAILWIND_PREFLIGHT_CSS,
  TAILWIND_PREFLIGHT_VERSION,
} from './import'

describe('HTML import sandbox CSS', () => {
  it('embeds official Tailwind Preflight for Paper snapshot measurement', () => {
    expect(TAILWIND_PREFLIGHT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(TAILWIND_PREFLIGHT_CSS).toContain('border: 0 solid')
    expect(TAILWIND_PREFLIGHT_CSS).not.toContain('--theme(')
    expect(HTML_IMPORT_SANDBOX_BASE_CSS).toContain(TAILWIND_PREFLIGHT_CSS)
    expect(HTML_IMPORT_SANDBOX_BASE_CSS).toContain(
      'x-paper-html{display:inline-block}',
    )
  })
})
