import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { FigmaIcon } from 'lucide-react'
import { EditorCommandMenu } from './editor-command-menu'

describe('EditorCommandMenu', () => {
  afterEach(() => cleanup())

  test('runs a selected command and closes the menu', async () => {
    const run = mock()
    const onOpenChange = mock()
    render(
      <EditorCommandMenu
        open
        onOpenChange={onOpenChange}
        groups={[
          {
            label: 'Figma',
            commands: [
              {
                id: 'figma-current',
                label: 'Import Figma into current document',
                icon: FigmaIcon,
                run,
              },
            ],
          },
        ]}
      />,
    )
    await act(async () => {})

    fireEvent.click(screen.getByText('Import Figma into current document'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
