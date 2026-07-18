// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '#/components/ui/sidebar'
import type { CanvasActions, Shape } from '#/lib/canvas'

const orpc = vi.hoisted(() => ({
  chat: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    save: vi.fn(),
  },
  history: { commit: vi.fn() },
}))

vi.mock('#/lib/orpc-client', () => ({ orpc }))
vi.mock('#/lib/history', () => ({ commitIfChanged: vi.fn() }))
vi.mock('#/lib/snapshot', () => ({ snapshotCanvas: vi.fn().mockResolvedValue(null) }))

import { AgentPanel } from './agent-panel'

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
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
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
    vi.restoreAllMocks()
  })

  it('retries once via regenerate when a successful stream contains no assistant output', async () => {
    const chatFetch = vi
      .spyOn(globalThis, 'fetch')
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

    const shapesRef = { current: [] as Shape[] }
    const actions: CanvasActions = {
      createShape: vi.fn(),
      createShapes: vi.fn(),
      updateShape: vi.fn(),
      deleteShape: vi.fn(),
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
    const chatFetch = vi
      .spyOn(globalThis, 'fetch')
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

    const shapesRef = { current: [] as Shape[] }
    const actions: CanvasActions = {
      createShape: vi.fn(),
      createShapes: vi.fn(),
      updateShape: vi.fn(),
      deleteShape: vi.fn(),
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
