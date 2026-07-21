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

  it('sends the selected reasoning effort for ChatGPT models', async () => {
    localStorage.setItem('loora:model', 'gpt-5.6-sol')
    localStorage.setItem('loora:reasoning-effort', 'max')
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
    const effortButton = screen.getByTitle('Reasoning effort')
    expect(effortButton.textContent).toContain('Max')
    fireEvent.click(effortButton)
    const effortSlider = await screen.findByRole('slider', { name: 'Reasoning effort' })
    expect(effortSlider.getAttribute('aria-valuenow')).toBe('4')
    expect(screen.getByTestId('reasoning-effort-stops').children).toHaveLength(5)
    fireEvent.change(input, { target: { value: 'Review this design' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse((chatFetch.mock.calls[0]?.[1] as RequestInit)?.body as string)
    expect(body.model).toBe('gpt-5.6-sol')
    expect(body.reasoningEffort).toBe('max')
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

  it('shows progress while a tool is running and failure only after an error', () => {
    const running = {
      id: 'running-tool',
      role: 'assistant',
      parts: [{
        type: 'tool-readRepositoryFile',
        toolCallId: 'repository-read',
        state: 'input-available',
        input: { repository: 'acme/site', path: 'src/app.tsx' },
      }],
    } as UIMessage
    const failed = {
      id: 'failed-tool',
      role: 'assistant',
      parts: [{
        type: 'tool-readRepositoryFile',
        toolCallId: 'repository-read',
        state: 'output-error',
        input: { repository: 'acme/site', path: 'src/app.tsx' },
        errorText: 'Request failed',
      }],
    } as UIMessage
    const shapesRef = { current: [] as CanvasElement[] }
    const onAnswer = mock()
    const onResolveDelete = mock()

    const view = render(
      <ChatMessageRow
        message={running}
        isLast
        streaming
        shapesRef={shapesRef}
        onAnswer={onAnswer}
        onResolveDelete={onResolveDelete}
      />,
    )

    expect(screen.getByLabelText('Tool in progress')).toBeTruthy()
    expect(screen.queryByLabelText('Tool failed')).toBeNull()

    view.rerender(
      <ChatMessageRow
        message={failed}
        isLast
        streaming={false}
        shapesRef={shapesRef}
        onAnswer={onAnswer}
        onResolveDelete={onResolveDelete}
      />,
    )

    expect(screen.getByLabelText('Tool failed')).toBeTruthy()
    expect(screen.queryByLabelText('Tool in progress')).toBeNull()
  })

  it('shows ordered live sub-agent tasks with collapsible results and isolated failures', () => {
    const partial = {
      id: 'delegation',
      role: 'assistant',
      parts: [{
        type: 'tool-delegateTasks',
        toolCallId: 'delegate-1',
        state: 'output-available',
        preliminary: true,
        input: {
          tasks: [
            { name: 'Structure', task: 'Draft the structure' },
            { name: 'Visuals', task: 'Draft the visual direction' },
          ],
        },
        output: {
          workers: [
            {
              id: 'worker-1',
              name: 'Structure',
              task: 'Draft the structure',
              status: 'completed',
              result: 'Use a clear section hierarchy.',
            },
            {
              id: 'worker-2',
              name: 'Visuals',
              task: 'Draft the visual direction',
              status: 'running',
            },
          ],
        },
      }],
    } as UIMessage
    const failed = {
      ...partial,
      parts: [{
        ...(partial.parts[0] as object),
        preliminary: false,
        output: {
          workers: [
            {
              id: 'worker-1',
              name: 'Structure',
              task: 'Draft the structure',
              status: 'completed',
              result: 'Use a clear section hierarchy.',
            },
            {
              id: 'worker-2',
              name: 'Visuals',
              task: 'Draft the visual direction',
              status: 'failed',
              error: 'Timed out after 90 seconds.',
            },
          ],
        },
      }],
    } as UIMessage
    const shapesRef = { current: [] as CanvasElement[] }
    const props = {
      isLast: true,
      shapesRef,
      onAnswer: mock(),
      onResolveDelete: mock(),
    }

    const view = render(<ChatMessageRow {...props} message={partial} streaming />)

    expect(screen.getByText('Working in parallel')).toBeTruthy()
    expect(screen.getByText('1 of 2 complete')).toBeTruthy()
    expect(screen.getAllByLabelText('Sub-agent completed')).toHaveLength(1)
    expect(screen.getAllByLabelText('Sub-agent in progress')).toHaveLength(1)
    expect(screen.queryByText('Use a clear section hierarchy.')).toBeNull()
    fireEvent.click(screen.getByText('Structure'))
    expect(screen.getByText('Use a clear section hierarchy.')).toBeTruthy()

    view.rerender(<ChatMessageRow {...props} message={failed} streaming={false} />)
    expect(screen.getByText('1 completed · 1 failed')).toBeTruthy()
    expect(screen.getByLabelText('Sub-agent failed')).toBeTruthy()
    expect(screen.getByText('Timed out after 90 seconds.')).toBeTruthy()
  })

  it('marks an unfinished persisted delegation as cancelled', () => {
    const message = {
      id: 'cancelled-delegation',
      role: 'assistant',
      parts: [{
        type: 'tool-delegateTasks',
        toolCallId: 'delegate-cancelled',
        state: 'input-available',
        input: {
          tasks: [
            { name: 'Structure', task: 'Draft the structure' },
            { name: 'Visuals', task: 'Draft the visual direction' },
          ],
        },
      }],
    } as UIMessage

    render(
      <ChatMessageRow
        message={message}
        isLast
        streaming={false}
        shapesRef={{ current: [] as CanvasElement[] }}
        onAnswer={mock()}
        onResolveDelete={mock()}
      />,
    )

    expect(screen.getByText('Cancelled')).toBeTruthy()
    expect(screen.getAllByText('cancelled')).toHaveLength(2)
    expect(screen.queryByLabelText('Sub-agent in progress')).toBeNull()
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
