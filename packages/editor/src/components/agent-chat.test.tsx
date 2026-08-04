import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const status = vi.fn()
const thread = vi.fn()
const newThread = vi.fn()
const disconnect = vi.fn()
const openExternal = vi.fn()

const sendMessage = vi.fn()
const stop = vi.fn()
const addToolApprovalResponse = vi.fn()
const chatState = {
  messages: [] as unknown[],
  status: 'ready' as string,
  error: undefined as Error | undefined,
  sendMessage,
  stop,
  addToolApprovalResponse,
}

vi.mock('@loora/rpc/client', () => ({
  orpc: { assistant: { status, thread, newThread, disconnect } },
}))
vi.mock('@loora/platform', () => ({
  apiUrl: (path: string) => path,
  appUrl: (path: string) => `https://loora.design${path}`,
  openExternal,
}))
vi.mock('@ai-sdk/react', () => ({ useChat: () => chatState }))

const { act, cleanup, fireEvent, render, within } = await import(
  '@testing-library/react'
)
const { AgentChat, resetAgentAvailability, useAgentAvailable } = await import(
  './agent-chat'
)

async function open(node: Parameters<typeof render>[0]) {
  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(node)
  })
  return within(view.container)
}

const connected = {
  enabled: true,
  configured: true,
  connection: { email: 'someone@example.com', planType: 'plus' },
  model: 'gpt-5.6-terra',
}

describe('AgentChat', () => {
  beforeEach(() => {
    chatState.messages = []
    chatState.status = 'ready'
    chatState.error = undefined
    sendMessage.mockReset()
    stop.mockReset()
    addToolApprovalResponse.mockReset()
    openExternal.mockReset()
    // The status read is cached per page, so each test starts from nothing.
    resetAgentAvailability()
    status.mockReset().mockResolvedValue(connected)
    thread.mockReset().mockResolvedValue({ threadId: 'athread_1', messages: [] })
    newThread.mockReset().mockResolvedValue({ threadId: 'athread_2', messages: [] })
    disconnect.mockReset().mockResolvedValue({ connected: false })
  })
  afterEach(cleanup)

  test('renders nothing until it is opened', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open={false} onOpenChange={() => {}} />,
    )
    expect(view.queryByLabelText('Ask the agent')).toBeNull()
  })

  test('opens on the thread this document is already on', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId="b1" open onOpenChange={() => {}} />,
    )
    expect(thread).toHaveBeenCalledWith({ designId: 'd1', draftId: 'b1' })
    expect(view.getByLabelText('Ask the agent')).toBeTruthy()
  })

  test('sends what was typed and clears the field', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent') as HTMLTextAreaElement

    fireEvent.change(field, { target: { value: 'add a pricing page' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(sendMessage).toHaveBeenCalledWith({ text: 'add a pricing page' })
    expect(field.value).toBe('')
  })

  test('shift+enter is a newline, not a run', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: 'first line' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('/login-with-chatgpt opens the connect flow and comes back here', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/login-with-chatgpt' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledTimes(1)
    const url = openExternal.mock.calls[0]?.[0] as string
    expect(url).toContain('/api/chatgpt/connect?returnTo=')
  })

  test('refuses to run before ChatGPT is connected, and says how', async () => {
    status.mockResolvedValue({ ...connected, connection: null })
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: 'add a hero' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(view.getByText(/\/login-with-chatgpt/)).toBeTruthy()
  })

  test('/new starts a fresh thread', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/new' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(newThread).toHaveBeenCalledWith({ designId: 'd1', draftId: null })
  })

  test('names the tool the agent is on while it runs', async () => {
    chatState.status = 'streaming'
    chatState.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-insertNodes',
            toolCallId: 'c1',
            state: 'input-available',
            input: {},
          },
        ],
      },
    ]
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    expect(view.getByText('Adding elements…')).toBeTruthy()
    await act(async () => {
      fireEvent.click(view.getByLabelText('Stop the agent'))
    })
    expect(stop).toHaveBeenCalled()
  })

  test('asks before deleting, and passes the answer back', async () => {
    chatState.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-deleteNodes',
            toolCallId: 'c1',
            state: 'approval-requested',
            input: { nodeIds: ['n1', 'n2'] },
            approval: { id: 'approval_1' },
          },
        ],
      },
    ]
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    expect(view.getByText(/2 layers/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Delete' }))
    })
    expect(addToolApprovalResponse).toHaveBeenCalledWith({
      id: 'approval_1',
      approved: true,
    })
  })

  test('declining a delete keeps the layers', async () => {
    chatState.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-deleteNodes',
            toolCallId: 'c1',
            state: 'approval-requested',
            input: { nodeIds: ['n1'] },
            approval: { id: 'approval_1' },
          },
        ],
      },
    ]
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Keep them' }))
    })
    expect(addToolApprovalResponse.mock.calls[0]?.[0]).toMatchObject({
      id: 'approval_1',
      approved: false,
    })
  })

  test('shows the plain sentence behind a refused run', async () => {
    chatState.error = new Error(
      JSON.stringify({
        error: 'The agent works on designs you own.',
        code: 'ACCESS_DENIED',
      }),
    )
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    expect(view.getByText('The agent works on designs you own.')).toBeTruthy()
  })

  test('offers a reconnect when the connection is what broke', async () => {
    chatState.error = new Error(
      JSON.stringify({
        error: 'The ChatGPT connection expired.',
        code: 'CHATGPT_RECONNECT_REQUIRED',
      }),
    )
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Connect ChatGPT' }))
    })
    expect(openExternal).toHaveBeenCalled()
  })

  test('typing a slash offers the commands, with the first one ready', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/' } })

    const options = view.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('/login-with-chatgpt'),
      expect.stringContaining('/logout-chatgpt'),
      expect.stringContaining('/new'),
    ])
    expect(options[0].getAttribute('aria-selected')).toBe('true')
  })

  test('hides a command that would do nothing', async () => {
    status.mockResolvedValue({ ...connected, connection: null })
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: '/' },
    })

    const names = view.getAllByRole('option').map((option) => option.textContent)
    expect(names.some((name) => name?.includes('/logout-chatgpt'))).toBe(false)
  })

  test('narrows as you type', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: '/log' },
    })

    expect(view.getAllByRole('option')).toHaveLength(2)
  })

  test('arrows move the selection and enter runs it', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/' } })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(
      view.getAllByRole('option')[1].getAttribute('aria-selected'),
    ).toBe('true')

    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(disconnect).toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('arrow up from the top wraps to the bottom', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/' } })
    fireEvent.keyDown(field, { key: 'ArrowUp' })

    const options = view.getAllByRole('option')
    expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true')
  })

  test('tab completes without running', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent') as HTMLTextAreaElement

    fireEvent.change(field, { target: { value: '/lo' } })
    fireEvent.keyDown(field, { key: 'Tab' })

    expect(field.value).toBe('/login-with-chatgpt')
    expect(openExternal).not.toHaveBeenCalled()
  })

  test('clicking a command runs it', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: '/' },
    })

    await act(async () => {
      fireEvent.click(view.getAllByRole('option')[2])
    })
    expect(newThread).toHaveBeenCalled()
  })

  test('escape closes the menu before it closes the box', async () => {
    const onOpenChange = vi.fn()
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={onOpenChange} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(view.queryAllByRole('option')).toHaveLength(0)
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('a slash that matches nothing is not sent as a prompt', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/nope' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(view.getByText(/Unknown command \/nope/)).toBeTruthy()
  })

  test('escape closes it', async () => {
    const onOpenChange = vi.fn()
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={onOpenChange} />,
    )
    fireEvent.keyDown(view.getByLabelText('Ask the agent'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('useAgentAvailable', () => {
  function Probe() {
    return <span data-testid="flag">{String(useAgentAvailable())}</span>
  }

  beforeEach(() => {
    resetAgentAvailability()
    status.mockReset()
  })
  afterEach(cleanup)

  test('is false until the flag says otherwise', async () => {
    status.mockResolvedValue({ ...connected, enabled: false })
    const view = await open(<Probe />)
    expect(view.getByTestId('flag').textContent).toBe('false')
  })

  test('is true for an account inside the flag', async () => {
    status.mockResolvedValue(connected)
    const view = await open(<Probe />)
    expect(view.getByTestId('flag').textContent).toBe('true')
  })

  test('a failed status read leaves the agent hidden', async () => {
    status.mockRejectedValue(new Error('down'))
    const view = await open(<Probe />)
    expect(view.getByTestId('flag').textContent).toBe('false')
  })

  test('reads the status once per page, however many mount', async () => {
    status.mockResolvedValue(connected)
    await open(
      <>
        <Probe />
        <Probe />
        <Probe />
      </>,
    )
    expect(status).toHaveBeenCalledTimes(1)
  })
})
