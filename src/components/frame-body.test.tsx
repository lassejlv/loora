import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { FrameBody } from './frame-body'

afterEach(cleanup)

function renderEditable(onChange = mock()) {
  const view = render(
    <FrameBody
      html={'<section><h1 style="color:#111111">Hello</h1></section>'}
      editable
      onChange={onChange}
    />,
  )
  const host = view.container.firstElementChild as HTMLElement
  const root = host.shadowRoot!
  const heading = root.querySelector('h1') as HTMLElement
  return { heading, onChange, root }
}

describe('FrameBody HTML editing', () => {
  it('selects and moves a real HTML element, then saves clean HTML', () => {
    const { heading, onChange, root } = renderEditable()

    fireEvent.pointerDown(heading, { clientX: 10, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 35, clientY: 50 })
    fireEvent.pointerUp(window)

    expect(heading.dataset.looraSelected).toBe('')
    expect(heading.style.translate).toBe('25px 30px')
    expect(root.querySelector('div[data-loora-editor]')?.hasAttribute('data-visible')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    const saved = onChange.mock.calls[0][0] as string
    expect(saved).toContain('translate: 25px 30px')
    expect(saved).not.toContain('data-loora-selected')
    expect(saved).not.toContain('data-loora-editor')
  })

  it('edits text and applies colors from the contextual toolbar', () => {
    const { heading, onChange, root } = renderEditable()
    fireEvent.pointerDown(heading, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)

    fireEvent.doubleClick(heading)
    expect(heading.contentEditable).toBe('true')
    heading.textContent = 'Changed'
    fireEvent.blur(heading)

    const textColor = root.querySelector('[data-loora-color]') as HTMLInputElement
    fireEvent.input(textColor, { target: { value: '#2440e6' } })
    fireEvent.change(textColor, { target: { value: '#2440e6' } })

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[0][0]).toContain('Changed')
    expect(onChange.mock.calls[1][0]).toContain('color: rgb(36, 64, 230)')
  })
})
