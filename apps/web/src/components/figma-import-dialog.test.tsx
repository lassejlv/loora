import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const status = mock()
const importFile = mock()

mock.module('#/lib/orpc-client', () => ({
  orpc: { figma: { status, import: importFile } },
}))

const { FigmaImportDialog } = await import('./figma-import-dialog')

describe('FigmaImportDialog', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    status.mockReset().mockResolvedValue({ enabled: true, connected: true, account: {} })
    importFile.mockReset().mockResolvedValue({
      design: { id: 'd1', name: 'Landing', shapes: [], updatedAt: Date.now() },
      summary: { pages: 1, frames: 2, fallbacks: 1, missingFonts: [] },
    })
  })

  afterEach(() => cleanup())

  test('imports a pasted link and reports the result', async () => {
    const onImported = mock()
    render(
      <FigmaImportDialog open onOpenChange={() => undefined} onImported={onImported} />,
    )
    await waitFor(() => expect(status).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Figma link'), {
      target: { value: 'https://www.figma.com/design/abcdef123/Landing' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import file' }))

    await waitFor(() =>
      expect(importFile).toHaveBeenCalledWith({
        url: 'https://www.figma.com/design/abcdef123/Landing',
      }),
    )
    expect(onImported).toHaveBeenCalled()
    expect(await screen.findByText('Imported “Landing”')).toBeTruthy()
    expect(screen.getByText(/2 frames across 1 page/)).toBeTruthy()
  })
})
