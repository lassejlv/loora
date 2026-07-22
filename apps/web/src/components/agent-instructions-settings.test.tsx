import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { AgentInstructionsSettings } from './agent-instructions-settings'

afterEach(() => cleanup())

describe('AgentInstructionsSettings', () => {
  test('shows protected instructions before the saved custom prompt', () => {
    render(
      <AgentInstructionsSettings
        savedPrompt="Use short headings."
        onSave={async () => undefined}
      />,
    )

    const builtIn = screen.getByRole('heading', { name: "Loora's built-in instructions" })
    const custom = screen.getByRole('heading', { name: 'Custom instructions' })
    expect(builtIn.compareDocumentPosition(custom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((screen.getByLabelText('Custom agent instructions') as HTMLTextAreaElement).value).toBe(
      'Use short headings.',
    )
    expect(screen.getByLabelText('Custom agent instructions').getAttribute('maxlength')).toBe('8000')

    fireEvent.change(screen.getByLabelText('Custom agent instructions'), {
      target: { value: 'a'.repeat(8_000) },
    })
    expect(screen.getByText('8,000/8,000')).toBeTruthy()
  })

  test('tracks dirty and saving states, trims the prompt, and confirms success', async () => {
    let finishSave: (() => void) | undefined
    const onSave = mock(
      () => new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    render(<AgentInstructionsSettings savedPrompt="Original" onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Custom agent instructions'), {
      target: { value: '  Prefer concise copy.  ' },
    })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    expect(onSave).toHaveBeenCalledWith('Prefer concise copy.')

    finishSave?.()
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect((screen.getByLabelText('Custom agent instructions') as HTMLTextAreaElement).value).toBe(
      'Prefer concise copy.',
    )
  })

  test('clears the draft without persisting until Save is pressed', async () => {
    const onSave = mock(async () => undefined)
    render(<AgentInstructionsSettings savedPrompt="Use blue." onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'Use default' }))
    expect((screen.getByLabelText('Custom agent instructions') as HTMLTextAreaElement).value).toBe('')
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''))
    expect(await screen.findByText('Saved')).toBeTruthy()
  })

  test('keeps success feedback when the saved preference prop updates', async () => {
    let rerender: ReturnType<typeof render>['rerender'] = () => undefined
    const onSave = mock(async (prompt: string) => {
      rerender(<AgentInstructionsSettings savedPrompt={prompt} onSave={onSave} />)
    })
    const rendered = render(<AgentInstructionsSettings savedPrompt="Old" onSave={onSave} />)
    rerender = rendered.rerender

    fireEvent.change(screen.getByLabelText('Custom agent instructions'), {
      target: { value: 'New' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved')).toBeTruthy()
  })

  test('keeps a failed draft and allows saving it again', async () => {
    const onSave = mock(async () => undefined)
    onSave.mockRejectedValueOnce(new Error('offline'))
    render(<AgentInstructionsSettings savedPrompt="" onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Custom agent instructions'), {
      target: { value: 'Keep this draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Could not save. Your changes are still here—try again.')).toBeTruthy()
    expect((screen.getByLabelText('Custom agent instructions') as HTMLTextAreaElement).value).toBe(
      'Keep this draft',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(onSave).toHaveBeenCalledTimes(2)
  })
})
