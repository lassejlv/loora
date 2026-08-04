import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const status = vi.fn()
const thread = vi.fn()
const newThread = vi.fn()
const fetchRequest = vi.fn()
const preferences = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => preferences.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => preferences.set(key, value)),
  clear: vi.fn(() => preferences.clear()),
}

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
  orpc: { assistant: { status, thread, newThread } },
}))
vi.mock('@loora/platform', () => ({
  apiUrl: (path: string) => path,
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
    fetchRequest.mockReset().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchRequest)
    vi.stubGlobal('localStorage', localStorageMock)
    window.history.replaceState({}, '', '/')
    localStorageMock.clear()
    localStorageMock.getItem.mockClear()
    localStorageMock.setItem.mockClear()
    // The status read is cached per page, so each test starts from nothing.
    resetAgentAvailability()
    status.mockReset().mockResolvedValue(connected)
    thread.mockReset().mockResolvedValue({ threadId: 'athread_1', messages: [] })
    newThread.mockReset().mockResolvedValue({ threadId: 'athread_2', messages: [] })
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

  test('/login-with-chatgpt opens the ChatGPT integration', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/login-with-chatgpt' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/app/integrations')
    expect(window.location.search).toBe('?integration=chatgpt')
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
    const statusLine = view.getByText('Adding elements…')
    expect(statusLine.classList.contains('cx-shimmer')).toBe(true)
    await act(async () => {
      fireEvent.click(view.getByLabelText('Stop the agent'))
    })
    expect(stop).toHaveBeenCalled()
  })

  test('reveals earlier messages in a bounded hover transcript', async () => {
    chatState.messages = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'Build a settings screen' }],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I added the account settings.' }],
      },
      {
        id: 'm3',
        role: 'assistant',
        parts: [{ type: 'text', text: 'The billing section is ready.' }],
      },
    ]
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )

    const history = view.getByLabelText('Conversation history')
    expect(history.textContent).toContain('Build a settings screen')
    expect(history.textContent).toContain('I added the account settings.')
    expect(history.textContent).not.toContain('The billing section is ready.')
    expect(history.className).toContain('max-h-56')
    expect(history.className).toContain('overflow-y-auto')
    expect(history.parentElement?.parentElement?.className).toContain(
      'group-hover/agent:opacity-100',
    )
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
    expect(window.location.pathname).toBe('/app/integrations')
  })

  test('typing a slash offers the commands, with the first one ready', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/' } })

    const options = view.getAllByRole('option')
    // Soft label first, command name underneath.
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringMatching(/Connect ChatGPT.*\/login-with-chatgpt/s),
      expect.stringMatching(/Disconnect ChatGPT.*\/logout-chatgpt/s),
      expect.stringMatching(/Choose model.*\/model/s),
      expect.stringMatching(/Reasoning effort.*\/effort/s),
      expect.stringMatching(/New thread.*\/new/s),
    ])
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(view.getByText('navigate')).toBeTruthy()
    expect(view.getByText('close')).toBeTruthy()
  })

  test('an unmatched slash shows an empty state instead of vanishing', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: '/nope' },
    })
    expect(view.getByText('No matching command.')).toBeTruthy()
    expect(view.queryAllByRole('option')).toHaveLength(0)
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

  test('soft-filters slash rows by their human label', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: '/connect' },
    })

    const options = view.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toMatch(/Connect ChatGPT.*\/login-with-chatgpt/s)
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
    expect(fetchRequest).toHaveBeenCalledWith('/api/chatgpt/logout', {
      method: 'POST',
      credentials: 'include',
    })
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
    expect(window.location.pathname).toBe('/')
  })

  test('clicking a command runs it', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: '/' },
    })

    await act(async () => {
      fireEvent.click(view.getAllByRole('option')[4])
    })
    expect(newThread).toHaveBeenCalled()
  })

  test('/model selects and remembers an old ChatGPT model', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/model ' } })
    expect(view.getAllByRole('option')).toHaveLength(3)
    await act(async () => {
      fireEvent.click(view.getByRole('option', { name: /GPT-5.6 Sol/ }))
    })

    expect(view.getByText('Model set to GPT-5.6 Sol.')).toBeTruthy()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'loora:chatgpt-model',
      'gpt-5.6-sol',
    )
  })

  test('/effort selects and remembers the old reasoning efforts', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: '/effort ' } })
    expect(view.getAllByRole('option')).toHaveLength(5)
    await act(async () => {
      fireEvent.click(view.getByRole('option', { name: /Max/ }))
    })

    expect(view.getByText('Reasoning effort set to Max.')).toBeTruthy()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'loora:reasoning-effort',
      'max',
    )
  })

  test('the whole card can be dragged without a permanent handle', async () => {
    const view = await open(
      <AgentChat designId="d1" draftId={null} open onOpenChange={() => {}} />,
    )
    const field = view.getByLabelText('Ask the agent')
    const box = field.closest('.cx-agent-box') as HTMLElement
    const before = box.style.transform

    expect(view.queryByRole('button', { name: 'Move agent chat' })).toBeNull()

    Object.assign(box, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    fireEvent.pointerDown(box, {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(box, {
      pointerId: 1,
      isPrimary: true,
      clientX: 84,
      clientY: 84,
    })

    expect(box.style.transform).not.toBe(before)
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

  test('@ offers layers by name and completes the one picked', async () => {
    const view = await open(
      <AgentChat
        designId="d1"
        draftId={null}
        open
        onOpenChange={() => {}}
        nodes={() => [
          { id: 'n1', name: 'Hero section', type: 'frame', path: 'Home' },
          {
            id: 'n2',
            name: 'Heading',
            type: 'text',
            path: 'Home / Hero section',
          },
          { id: 'n3', name: 'Footer', type: 'frame' },
        ]}
      />,
    )
    const field = view.getByLabelText('Ask the agent') as HTMLTextAreaElement

    fireEvent.change(field, { target: { value: 'make @he' } })
    const options = view.getAllByRole('option')
    // Prefix rank: Hero section before Heading; ancestry path disambiguates.
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringMatching(/Hero section.*Home · frame/s),
      expect.stringMatching(/Heading.*Home \/ Hero section · text/s),
    ])
    expect(view.getByText('insert')).toBeTruthy()

    await act(async () => {
      fireEvent.click(options[0])
    })
    expect(field.value).toBe('make @Hero section ')
    // Removable chip strip + mirror highlight over the transparent field.
    expect(view.getByRole('button', { name: 'Remove Hero section' })).toBeTruthy()
    expect(view.getByText('@Hero section')).toBeTruthy()

    fireEvent.change(field, { target: { value: 'make @Hero section blue' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(sendMessage).toHaveBeenCalledWith({ text: 'make @Hero section blue' })
  })

  test('a mention chip can be removed without clearing the rest of the draft', async () => {
    const view = await open(
      <AgentChat
        designId="d1"
        draftId={null}
        open
        onOpenChange={() => {}}
        nodes={() => [{ id: 'n1', name: 'Hero', type: 'frame', path: 'Home' }]}
      />,
    )
    const field = view.getByLabelText('Ask the agent') as HTMLTextAreaElement

    fireEvent.change(field, { target: { value: '@' } })
    await act(async () => {
      fireEvent.click(view.getAllByRole('option')[0])
    })
    expect(field.value).toBe('@Hero ')

    fireEvent.change(field, { target: { value: 'restyle @Hero carefully' } })
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Remove Hero' }))
    })
    expect(field.value).toBe('restyle carefully')
    expect(view.queryByRole('button', { name: 'Remove Hero' })).toBeNull()
  })

  test('@ rows show a shortened deep ancestry path', async () => {
    const view = await open(
      <AgentChat
        designId="d1"
        draftId={null}
        open
        onOpenChange={() => {}}
        nodes={() => [
          {
            id: 'n1',
            name: 'Button',
            type: 'frame',
            path: 'Home / … / Card',
          },
        ]}
      />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: '@' },
    })
    expect(view.getByRole('option').textContent).toMatch(
      /Button.*Home \/ … \/ Card · frame/s,
    )
  })

  test('an unmatched @ shows an empty state', async () => {
    const view = await open(
      <AgentChat
        designId="d1"
        draftId={null}
        open
        onOpenChange={() => {}}
        nodes={() => [{ id: 'n1', name: 'Hero', type: 'frame' }]}
      />,
    )
    fireEvent.change(view.getByLabelText('Ask the agent'), {
      target: { value: 'make @zzz' },
    })
    expect(view.getByText('No layers match.')).toBeTruthy()
  })

  test('a retracted @name does not reopen the menu on plain text', async () => {
    const view = await open(
      <AgentChat
        designId="d1"
        draftId={null}
        open
        onOpenChange={() => {}}
        nodes={() => [{ id: 'n1', name: 'Hero', type: 'frame' }]}
      />,
    )
    const field = view.getByLabelText('Ask the agent')

    fireEvent.change(field, { target: { value: 'make it blue' } })
    expect(view.queryAllByRole('option')).toHaveLength(0)
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
