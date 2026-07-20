import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Profiler } from 'react'
import type { UIMessage } from 'ai'
import { SidebarProvider } from '#/components/ui/sidebar'
import type { CanvasElement, ElementActions } from '#/lib/canvas'

const orpc = {
  chat: {
    list: mock(),
    create: mock(),
    get: mock(),
    save: mock(),
  },
  history: { commit: mock() },
  github: {
    status: mock(),
    repositories: mock(),
    refresh: mock(),
    binding: mock(),
    bind: mock(),
    clear: mock(),
    disconnect: mock(),
  },
}

mock.module('#/lib/orpc-client', () => ({ orpc }))
const snapshotCanvas = mock().mockResolvedValue('data:image/png;base64,test')
mock.module('#/lib/snapshot', () => ({ snapshotCanvas }))

const { AgentPanel, ChatMessageRow } = await import('./agent-panel')
const originalFetch = globalThis.fetch
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function stream(...chunks: object[]) {
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('AgentPanel empty response recovery', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: window.localStorage,
    })
    localStorage.clear()
    snapshotCanvas.mockClear()
    orpc.chat.list.mockResolvedValue([{
      id: 'chat:test',
      title: 'New chat',
      githubRepositoryId: null,
      githubRepositoryFullName: null,
      updatedAt: 1,
    }])
    orpc.chat.get.mockResolvedValue({ messages: [] })
    orpc.chat.save.mockResolvedValue({})
    orpc.history.commit.mockResolvedValue({})
    orpc.github.status.mockResolvedValue({
      enabled: false,
      connected: false,
      account: null,
      installations: [],
    })
    orpc.github.binding.mockResolvedValue(null)
    orpc.github.repositories.mockResolvedValue([])

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
    localStorage.clear()
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
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

    const shapesRef = { current: [] as CanvasElement[] }
    const actions: ElementActions = {
      createElement: mock(),
      createElements: mock(),
      updateElement: mock(),
      deleteElement: mock(),
      reorderElements: mock(),
      groupElements: mock(),
      ungroupElements: mock(),
    }

    render(
      <SidebarProvider>
        <AgentPanel actions={actions} shapesRef={shapesRef} docId="test" />
      </SidebarProvider>,
    )

    const input = await screen.findByPlaceholderText('Describe a change…')
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false))
    expect(screen.queryByText('No repository')).toBeNull()
    fireEvent.change(input, { target: { value: 'Make a portfolio website' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(2), { timeout: 4000 })
    expect(await screen.findByText('Done.')).toBeTruthy()

    const firstBody = JSON.parse((chatFetch.mock.calls[0]?.[1] as RequestInit)?.body as string)
    expect(firstBody.designId).toBe('test')
    expect(firstBody.chatId).toBe('chat:test')
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

    const shapesRef = { current: [] as CanvasElement[] }
    const actions: ElementActions = {
      createElement: mock(),
      createElements: mock(),
      updateElement: mock(),
      deleteElement: mock(),
      reorderElements: mock(),
      groupElements: mock(),
      ungroupElements: mock(),
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

    await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(2), { timeout: 4000 })
    expect(await screen.findByText('Built.')).toBeTruthy()
  })

  it('retries with a canvas-action reminder when the agent promises work without a tool call', async () => {
    const chatFetch = mock()
      .mockResolvedValueOnce(
        stream(
          { type: 'start' },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'Got it — let me build it.' },
          { type: 'text-end', id: 'answer' },
          { type: 'finish' },
        ),
      )
      .mockResolvedValueOnce(
        stream(
          { type: 'start' },
          {
            type: 'tool-input-start',
            toolCallId: 'create-portfolio',
            toolName: 'createElements',
          },
          {
            type: 'tool-input-available',
            toolCallId: 'create-portfolio',
            toolName: 'createElements',
            input: {
              elements: [
                {
                  name: 'Portfolio',
                  x: 0,
                  y: 0,
                  w: 1440,
                  h: 900,
                  code: '<main>Portfolio</main>',
                },
              ],
            },
          },
          { type: 'finish' },
        ),
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

    const shapesRef = { current: [] as CanvasElement[] }
    const actions: ElementActions = {
      createElement: mock(),
      createElements: mock().mockReturnValue([
        { id: 'portfolio', name: 'Portfolio', x: 0, y: 0, w: 1440, h: 900, code: '<main>Portfolio</main>' },
      ]),
      updateElement: mock(),
      deleteElement: mock(),
      reorderElements: mock(),
      groupElements: mock(),
      ungroupElements: mock(),
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

    await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(3), { timeout: 4000 })
    expect(await screen.findByText('Built.')).toBeTruthy()
    expect(actions.createElements).toHaveBeenCalledTimes(1)

    const secondBody = JSON.parse((chatFetch.mock.calls[1]?.[1] as RequestInit)?.body as string)
    expect(secondBody.trigger).toBe('regenerate-message')
    expect(secondBody.forceCanvasAction).toBe(true)
  })

  it('captures and sends canvas images with Mini', async () => {
    const chatFetch = mock().mockResolvedValue(
      stream(
        { type: 'start' },
        { type: 'text-start', id: 'answer' },
        { type: 'text-delta', id: 'answer', delta: 'Done.' },
        { type: 'text-end', id: 'answer' },
        { type: 'finish' },
      ),
    )
    globalThis.fetch = chatFetch as unknown as typeof fetch

    const shapesRef = {
      current: [
        { id: 'el-1', name: 'Box', x: 0, y: 0, w: 100, h: 100, code: '<div></div>' },
      ] as CanvasElement[],
    }
    const actions: ElementActions = {
      createElement: mock(),
      createElements: mock(),
      updateElement: mock(),
      deleteElement: mock(),
      reorderElements: mock(),
      groupElements: mock(),
      ungroupElements: mock(),
    }

    render(
      <SidebarProvider>
        <AgentPanel actions={actions} shapesRef={shapesRef} docId="test" />
      </SidebarProvider>,
    )

    const input = await screen.findByPlaceholderText('Describe a change…')
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'Update this rectangle' } })
    fireEvent.submit(input.closest('form')!)

    expect(await screen.findByText('Done.')).toBeTruthy()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    const requestBody = (chatFetch.mock.calls[0]?.[1] as RequestInit)?.body as string
    expect(requestBody).toContain('"type":"file"')
    expect(requestBody).toContain('"mediaType":"image/png"')
  })

  it('does not capture or send canvas images with Max', async () => {
    localStorage.setItem('loora:model', 'max')
    const chatFetch = mock().mockResolvedValue(
      stream(
        { type: 'start' },
        { type: 'text-start', id: 'answer' },
        { type: 'text-delta', id: 'answer', delta: 'Done.' },
        { type: 'text-end', id: 'answer' },
        { type: 'finish' },
      ),
    )
    globalThis.fetch = chatFetch as unknown as typeof fetch

    const shapesRef = {
      current: [
        { id: 'el-1', name: 'Box', x: 0, y: 0, w: 100, h: 100, code: '<div></div>' },
      ] as CanvasElement[],
    }
    const actions: ElementActions = {
      createElement: mock(),
      createElements: mock(),
      updateElement: mock(),
      deleteElement: mock(),
      reorderElements: mock(),
      groupElements: mock(),
      ungroupElements: mock(),
    }

    render(
      <SidebarProvider>
        <AgentPanel actions={actions} shapesRef={shapesRef} docId="test" />
      </SidebarProvider>,
    )

    const input = await screen.findByPlaceholderText('Describe a change…')
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'Update this rectangle' } })
    fireEvent.submit(input.closest('form')!)

    expect(await screen.findByText('Done.')).toBeTruthy()
    expect(snapshotCanvas).not.toHaveBeenCalled()
    const requestBody = (chatFetch.mock.calls[0]?.[1] as RequestInit)?.body as string
    expect(requestBody).not.toContain('"type":"file"')
  })

  it('does not rerender a historical row during streaming or canvas movement', () => {
    const historical = {
      id: 'historical',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Already finished.' }],
    } as UIMessage
    const active = {
      id: 'active',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Working…' }],
    } as UIMessage
    const shapesRef = { current: [] as CanvasElement[] }
    const onAnswer = mock()
    const onResolveDelete = mock()
    const historicalRenders = mock()
    const historicalDurations: number[] = []

    function Transcript({ streaming, dragTick }: { streaming: boolean; dragTick: number }) {
      return (
        <div data-drag-tick={dragTick}>
          <Profiler
            id="historical-row"
            onRender={(_id, _phase, actualDuration) => historicalDurations.push(actualDuration)}
          >
            <ChatMessageRow
              message={historical}
              isLast={false}
              streaming={false}
              shapesRef={shapesRef}
              onAnswer={onAnswer}
              onResolveDelete={onResolveDelete}
              onRenderMeasure={historicalRenders}
            />
          </Profiler>
          <ChatMessageRow
            message={active}
            isLast
            streaming={streaming}
            shapesRef={shapesRef}
            onAnswer={onAnswer}
            onResolveDelete={onResolveDelete}
          />
        </div>
      )
    }

    const view = render(<Transcript streaming={false} dragTick={0} />)
    const samplesAfterMount = historicalDurations.length
    expect(historicalRenders).toHaveBeenCalledTimes(1)
    view.rerender(<Transcript streaming dragTick={0} />)
    shapesRef.current = [
      { id: 'moving', name: 'Moving', x: 10, y: 10, w: 100, h: 100, code: '<div />' },
    ]
    view.rerender(<Transcript streaming dragTick={1} />)

    const updateSamples = historicalDurations.slice(samplesAfterMount)
    expect(historicalRenders).toHaveBeenCalledTimes(1)
    expect(updateSamples.every((duration) => Number.isFinite(duration))).toBe(true)
  })
})
