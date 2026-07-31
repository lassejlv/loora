import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const list = mock()
const upload = mock()
const remove = mock()

mock.module('@loora/rpc/client', () => ({
  orpc: { asset: { list, upload, delete: remove } },
}))

const { AssetsPanel } = await import('./assets-panel')

const HOUR = 3_600_000

function imageFile(name: string, bytes: number, type = 'image/png') {
  const file = new File([new Uint8Array(1)], name, { type })
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

/**
 * Queries stay scoped to this render: other suites in the same process rewrite
 * the shared document, and `screen` reads whichever body is current.
 */
function setup(usage?: Record<string, number>) {
  const onInsert = mock()
  const view = render(<AssetsPanel onInsert={onInsert} usage={usage} />)
  return { view, onInsert }
}

describe('AssetsPanel', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue([
      { id: 'a1', name: 'hero.png', mediaType: 'image/png', size: 2_048, at: Date.now() },
      {
        id: 'a2',
        name: 'logo.svg',
        mediaType: 'image/svg+xml',
        size: 512,
        at: Date.now() - 5 * HOUR,
      },
    ])
    upload.mockReset().mockImplementation(async (input: { name: string }) => ({
      id: 'a3',
      name: input.name,
      mediaType: 'image/png',
      size: 1_024,
    }))
    remove.mockReset().mockResolvedValue({ deleted: true })
  })

  afterEach(() => cleanup())

  test('lists assets with their size and places one on click', async () => {
    const { view, onInsert } = setup()

    const place = await view.findByTitle('Place hero.png')
    expect(view.getByText('2 KB')).toBeTruthy()
    fireEvent.click(place)
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect((onInsert.mock.calls[0]![0] as { id: string }).id).toBe('a1')
  })

  test('filters by name and sorts on demand', async () => {
    const { view } = setup()
    await view.findByTitle('Place hero.png')

    fireEvent.change(view.getByLabelText('Search assets'), {
      target: { value: 'logo' },
    })
    expect(view.queryByTitle('Place hero.png')).toBeNull()
    expect(view.getByTitle('Place logo.svg')).toBeTruthy()

    fireEvent.change(view.getByLabelText('Search assets'), { target: { value: '' } })
    fireEvent.change(view.getByLabelText('Sort assets'), { target: { value: 'size' } })
    const names = view
      .getAllByTitle(/^Place /)
      .map((button) => button.getAttribute('title'))
    expect(names).toEqual(['Place hero.png', 'Place logo.svg'])
  })

  test('uploads files dropped onto the panel', async () => {
    const { view } = setup()
    await view.findByTitle('Place hero.png')

    const panel = view.container.firstElementChild!
    fireEvent.drop(panel, {
      dataTransfer: { files: [imageFile('shot.png', 4_096)], types: ['Files'] },
    })

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect((upload.mock.calls[0]![0] as { name: string }).name).toBe('shot.png')
    expect(await view.findByTitle('Place shot.png')).toBeTruthy()
  })

  test('refuses oversized files and non-images before uploading them', async () => {
    const { view } = setup()
    await view.findByTitle('Place hero.png')

    const panel = view.container.firstElementChild!
    fireEvent.drop(panel, {
      dataTransfer: {
        files: [
          imageFile('huge.png', 6 * 1024 * 1024),
          imageFile('notes.txt', 10, 'text/plain'),
        ],
        types: ['Files'],
      },
    })

    expect(await view.findByText(/huge\.png is 6\.0 MB/)).toBeTruthy()
    expect(view.getByText('notes.txt is not an image')).toBeTruthy()
    expect(upload).not.toHaveBeenCalled()
  })

  test('warns how many nodes a delete would break', async () => {
    const { view } = setup({ a1: 3 })
    fireEvent.click(await view.findByLabelText('Delete hero.png'))

    expect(
      await view.findByText(/placed in 3 nodes\. Those will render as broken images\./),
    ).toBeTruthy()
  })

  test('keeps the asset until the delete is confirmed', async () => {
    const { view } = setup()
    fireEvent.click(await view.findByLabelText('Delete hero.png'))
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: 'a1' }))
    expect(view.queryByTitle('Place hero.png')).toBeNull()
  })

  test('puts a failed delete back in the list', async () => {
    remove.mockRejectedValue(new Error('offline'))
    const { view } = setup()
    fireEvent.click(await view.findByLabelText('Delete hero.png'))
    fireEvent.click(view.getByRole('button', { name: 'Delete' }))

    expect(await view.findByText('hero.png could not be deleted.')).toBeTruthy()
    expect(view.getByTitle('Place hero.png')).toBeTruthy()
  })
})
