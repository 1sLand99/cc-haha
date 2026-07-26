import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('uiStore theme handling', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
  })

  it('defaults new installs to the pure white theme', async () => {
    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('hydrates and applies the pure white theme as a light color scheme', async () => {
    window.localStorage.setItem('cc-haha-theme', 'white')

    const { initializeTheme, useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().theme).toBe('white')
    initializeTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('white')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('cycles through all six palettes and wraps back to pure white', async () => {
    const { useUIStore } = await import('./uiStore')

    const cycle = ['paper', 'warm-classic', 'celadon', 'dark', 'ink-blue', 'white']
    for (const expected of cycle) {
      useUIStore.getState().toggleTheme()
      expect(useUIStore.getState().theme).toBe(expected)
    }
  })

  it('reports a dark color scheme for both ink palettes, not just the one named dark', async () => {
    // `ink-blue` is a dark ground under a name that does not contain "dark".
    // Testing `theme === 'dark'` leaves native scrollbars and form controls in
    // their light variant against a near-black page.
    const { useUIStore } = await import('./uiStore')

    useUIStore.getState().setTheme('ink-blue')
    expect(document.documentElement.getAttribute('data-theme')).toBe('ink-blue')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    useUIStore.getState().setTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    useUIStore.getState().setTheme('celadon')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('uiStore settings tab persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('hydrates the last selected Settings tab after the renderer store is recreated', async () => {
    const first = await import('./uiStore')

    first.useUIStore.getState().setActiveSettingsTab('general')

    expect(window.localStorage.getItem('cc-haha-active-settings-tab')).toBe('general')

    vi.resetModules()
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().activeSettingsTab).toBe('general')
  })

  it('persists the pets Settings tab', async () => {
    const first = await import('./uiStore')

    first.useUIStore.getState().setActiveSettingsTab('pets')

    expect(window.localStorage.getItem('cc-haha-active-settings-tab')).toBe('pets')

    vi.resetModules()
    const recreated = await import('./uiStore')

    expect(recreated.useUIStore.getState().activeSettingsTab).toBe('pets')
  })

  it('ignores an invalid persisted Settings tab', async () => {
    window.localStorage.setItem('cc-haha-active-settings-tab', 'not-a-settings-tab')

    const { useUIStore } = await import('./uiStore')

    expect(useUIStore.getState().activeSettingsTab).toBe('providers')
  })
})
