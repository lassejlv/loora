import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  TOUR_STORAGE_KEY,
  clearTourSeen,
  editorTourSteps,
  hasSeenTour,
  markTourSeen,
} from './tour'

const options = {
  isMobile: false,
  openLayers: () => {},
  openDesign: () => {},
}

afterEach(() => {
  window.localStorage.clear()
})

describe('tour seen flag', () => {
  test('is unseen until marked, and clears again', () => {
    expect(hasSeenTour()).toBe(false)
    markTourSeen()
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1')
    expect(hasSeenTour()).toBe(true)
    clearTourSeen()
    expect(hasSeenTour()).toBe(false)
  })

  test('treats an unreadable store as seen rather than looping the tour', () => {
    // `Storage` is not a global in the JSDOM preload; reach its prototype
    // through the store itself.
    const storage = Object.getPrototypeOf(window.localStorage) as Storage
    const getItem = vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    try {
      expect(hasSeenTour()).toBe(true)
    } finally {
      getItem.mockRestore()
    }
  })
})

describe('editorTourSteps', () => {
  test('covers the editor in order and ends on the agent step', () => {
    const steps = editorTourSteps(options)
    expect(steps.map((step) => step.id)).toEqual([
      'canvas',
      'tools',
      'layers',
      'design',
      'branches',
      'share',
      'agent',
    ])
    expect(steps.at(-1)?.link?.href).toBe('/app/integrations')
    // The first step is a welcome, so it deliberately spotlights nothing.
    expect(steps[0]?.target).toBeUndefined()
  })

  test('drops the docked panels on mobile, where they do not exist', () => {
    const steps = editorTourSteps({ ...options, isMobile: true })
    const ids = steps.map((step) => step.id)
    expect(ids).not.toContain('layers')
    expect(ids).not.toContain('design')
    expect(ids).toContain('tools')
  })

  test('only the branch step is dropped when its anchor is missing', () => {
    const steps = editorTourSteps(options)
    expect(steps.filter((step) => step.required).map((step) => step.id)).toEqual([
      'branches',
    ])
  })

  test('every targeted step names an anchor the editor renders', () => {
    const anchors = new Set(['tools', 'layers', 'design', 'branches', 'share'])
    for (const step of editorTourSteps(options)) {
      if (!step.target) continue
      expect(anchors.has(step.target)).toBe(true)
    }
  })

  test('panel steps reveal what they point at', () => {
    const opened: string[] = []
    const steps = editorTourSteps({
      isMobile: false,
      openLayers: () => opened.push('layers'),
      openDesign: () => opened.push('design'),
    })
    steps.find((step) => step.id === 'layers')?.ensure?.()
    steps.find((step) => step.id === 'design')?.ensure?.()
    expect(opened).toEqual(['layers', 'design'])
  })
})
