import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { configureRuntime } from '@loora/platform'
import { ShutdownBanner } from './shutdown-banner'

const openExternal = vi.fn()

afterEach(() => {
  cleanup()
  openExternal.mockReset()
  configureRuntime({ platform: 'web', openExternal: (url) => window.location.assign(url) })
})

describe('ShutdownBanner', () => {
  test('alerts that the service ends and data will be deleted', () => {
    render(<ShutdownBanner />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/ending on 1 September 2026/i)
    expect(alert.textContent).toMatch(/all user and customer data will be deleted/i)
    expect(alert.textContent).toMatch(/the project stays open source/i)
    expect(screen.getByRole('link', { name: 'Read the notice' }).getAttribute('href')).toBe(
      '/shutdown',
    )
  })

  test('opens the public notice in a browser from the desktop app', () => {
    configureRuntime({
      platform: 'desktop',
      appOrigin: 'https://loora.design',
      openExternal,
    })
    render(<ShutdownBanner />)
    const link = screen.getByRole('link', { name: 'Read the notice' })
    expect(link.getAttribute('href')).toBe('https://loora.design/shutdown')
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith('https://loora.design/shutdown')
  })
})
