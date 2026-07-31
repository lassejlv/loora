import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const get = mock()
const invite = mock()
const setLinkAccess = mock()
const revoke = mock()
const setRole = mock()
const leave = mock()

const client = { get, invite, setLinkAccess, revoke, setRole, leave }

const { act, cleanup, fireEvent, render, within } = await import(
  '@testing-library/react'
)

/**
 * Flushes the load effect before asserting. `waitFor` polls on a real timer,
 * which turns into a race as soon as the suite shares a process with heavier
 * files; acting on the render settles it deterministically instead.
 */
async function open(node: Parameters<typeof render>[0]) {
  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(node)
  })
  // Queried through the render container rather than `screen`: sibling suites
  // mock modules process-wide and can leave document.body in a state where a
  // body-rooted query finds nothing.
  return within(view.container)
}
const { ShareDialogContent } = await import('./share-dialog')

const ownerState = {
  role: 'owner' as const,
  source: 'owner' as const,
  linkAccess: 'restricted' as const,
  owner: {
    id: 'u1',
    name: 'Lasse',
    email: 'lasse@example.com',
    image: null,
  },
  collaborators: [
    {
      id: 'share-1',
      email: 'ada@example.com',
      role: 'view' as const,
      name: 'Ada',
      image: null,
      userId: 'u2',
      acceptedAt: 1,
      createdAt: 1,
    },
  ],
}

describe('ShareDialog', () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue(ownerState)
    invite.mockReset().mockResolvedValue({ email: 'new@example.com', role: 'edit' })
    setLinkAccess.mockReset().mockResolvedValue({ linkAccess: 'view' })
    revoke.mockReset().mockResolvedValue({ revoked: true })
    setRole.mockReset().mockResolvedValue({ id: 'share-1', role: 'edit' })
    leave.mockReset().mockResolvedValue({ left: true })
  })
  afterEach(cleanup)

  test('invites a collaborator at the chosen access level', async () => {
    const view = await open(
      <ShareDialogContent designId="doc_1" onOpenChange={() => {}} client={client} />,
    )
    const field = view.getByLabelText('Email address')

    fireEvent.change(field, { target: { value: 'new@example.com' } })
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Invite' }))
    })

    expect(invite).toHaveBeenCalled()
    expect(invite.mock.calls[0]?.[0]).toEqual({
      designId: 'doc_1',
      email: 'new@example.com',
      role: 'edit',
    })
  })

  test('shows who already has access and how they got it', async () => {
    const view = await open(
      <ShareDialogContent designId="doc_1" onOpenChange={() => {}} client={client} />,
    )

    expect(view.getByText('Ada')).toBeTruthy()
    expect(view.getByText('Owner')).toBeTruthy()
    expect(
      view.getByText(
        'People you have not invited will not be able to open this link.',
      ),
    ).toBeTruthy()
  })

  test('opens the link up to anyone when the owner says so', async () => {
    const view = await open(
      <ShareDialogContent designId="doc_1" onOpenChange={() => {}} client={client} />,
    )
    const select = view.getByLabelText('Link access')

    await act(async () => {
      fireEvent.change(select, { target: { value: 'edit' } })
    })

    expect(setLinkAccess).toHaveBeenCalled()
    expect(setLinkAccess.mock.calls[0]?.[0]).toEqual({
      designId: 'doc_1',
      linkAccess: 'edit',
    })
  })

  test('offers a guest a way out instead of controls they cannot use', async () => {
    get.mockResolvedValue({
      ...ownerState,
      role: 'view' as const,
      source: 'share' as const,
      collaborators: [],
    })
    const view = await open(
      <ShareDialogContent designId="doc_1" onOpenChange={() => {}} client={client} />,
    )

    expect(view.getByText('Leave this design')).toBeTruthy()
    expect(view.queryByLabelText('Email address')).toBeNull()
    expect(view.queryByLabelText('Link access')).toBeNull()
  })
})
