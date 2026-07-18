import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { SidebarProvider } from '#/components/ui/sidebar'
import type { CanvasActions, Shape } from '#/lib/canvas'

const orpc = {
  chat: {
    list: mock(),
    create: mock(),
    get: mock(),
    save: mock(),
  },
  history: { commit: mock() },
}

mock.module('#/lib/orpc-client', () => ({ orpc }))
mock.module('#/lib/history', () => ({ commitIfChanged: mock() }))
mock.module('#/lib/snapshot', () => ({ snapshotCanvas: mock().mockResolvedValue(null) }))

const { AgentPanel } = await import('./agent-panel')
const originalFetch = globalThis.fetch

function stream(...chunks: object[]) {
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('AgentPanel empty response recovery', () => {
  beforeEach(() => {
    orpc.chat.list.mockResolvedValue([{ id: 'chat:test', title: 'New chat', updatedAt: 1 }])
    orpc.chat.get.mockResolvedValue({ messages: [] })
    orpc.chat.save.mockResolvedValue({})
    orpc.history.commit.mockResolvedValue({})

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: mock(() => ({
        matches: false,
        addEventListener: mock(),
        removeEventListener: mock(),
      })),
    })
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  })

  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
    mock.restore()
  })

  it('retries once via regenerate when a successful stream contains no assistant output', async () => {
    const chatFetch = mock()
      .mockResolvedValueOnce(stream({ type: 'start' }))
      .mockResolvedValueOnce(
        stream(
          { type: 'start' },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'Done.' },
          { type: 'text-end', id: 'answer' },
          { type: 'finish' },
        ),
      )
    globalThis.fetch = chatFetch as unknown as typeof fetch

    const shapesRef = { current: [] as Shape[] }
    const actions: CanvasActions = {
      createShape: mock(),
      createShapes: mock(),
      updateShape: mock(),
      deleteShape: mock(),
    }

    render(
      <SidebarProvider>
        <AgentPanel actions={actions} shapesRef={shapesRef} docId="test" />
      </SidebarProvider>,
    )

    const input = await screen.findByPlaceholderText('Describe a change…')
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'Make a portfolio website' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Done.')).toBeTruthy()

    const secondBody = JSON.parse((chatFetch.mock.calls[1]?.[1] as RequestInit)?.body as string)
    // regenerate must drop the empty assistant turn instead of resubmitting it
    expect(secondBody.trigger).toBe('regenerate-message')
  })

  it('retries when the server aborts mid-stream (looks like an empty success)', async () => {
    const chatFetch = mock()
      .mockResolvedValueOnce(
        stream({ type: 'start' }, { type: 'abort', reason: 'TimeoutError: The operation timed out.' }),
      )
      .mockResolvedValueOnce(
        stream(
          { type: 'start' },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'Built.' },
          { type: 'text-end', id: 'answer' },
          { type: 'finish' },
        ),
      )
    globalThis.fetch = chatFetch as unknown as typeof fetch

    const shapesRef = { current: [] as Shape[] }
    const actions: CanvasActions = {
      createShape: mock(),
      createShapes: mock(),
      updateShape: mock(),
      deleteShape: mock(),
    }

    render(
      <SidebarProvider>
        <AgentPanel actions={actions} shapesRef={shapesRef} docId="test" />
      </SidebarProvider>,
    )

    const input = await screen.findByPlaceholderText('Describe a change…')
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'Make a portfolio website' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Built.')).toBeTruthy()
  })
})
