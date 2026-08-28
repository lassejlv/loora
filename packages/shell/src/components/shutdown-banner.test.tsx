import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { configureRuntime } from '@loora/platform'
import {
  CLOUD_BANNER_DISMISSED_KEY,
  ShutdownBanner,
} from './shutdown-banner'

const openExternal = vi.fn()

afterEach(() => {
  cleanup()
  openExternal.mockReset()
  window.localStorage.clear()
  configureRuntime({ platform: 'web', openExternal: (url) => window.location.assign(url) })
})

describe('ShutdownBanner', () => {
  test('alerts that the cloud version continues', () => {
    render(<ShutdownBanner />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/loora will continue its cloud version/i)
    expect(alert.textContent).toMatch(/your files and accounts stay/i)
    expect(screen.getByRole('link', { name: 'Read more' }).getAttribute('href')).toBe(
      '/cloud',
    )
  })

  test('opens the public notice in a browser from the desktop app', () => {
    configureRuntime({
      platform: 'desktop',
      appOrigin: 'https://loora.design',
      openExternal,
    })
    render(<ShutdownBanner />)
    const link = screen.getByRole('link', { name: 'Read more' })
    expect(link.getAttribute('href')).toBe('https://loora.design/cloud')
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith('https://loora.design/cloud')
  })

  test('dismisses the alert and remembers it', async () => {
    render(<ShutdownBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(window.localStorage.getItem(CLOUD_BANNER_DISMISSED_KEY)).toBe('1')

    cleanup()
    render(<ShutdownBanner />)
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})
