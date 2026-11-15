import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAction, isIosDevice, isStandalone, shouldShowInstallButton } from './install.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isIosDevice', () => {
  it('detects iPhone and iPad user agents', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })
    expect(isIosDevice()).toBe(true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 })
    expect(isIosDevice()).toBe(true)
  })

  it('detects an iPad posing as a Mac by its touch points', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })
    expect(isIosDevice()).toBe(true)
  })

  it('leaves Android and desktop browsers alone', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', platform: 'Linux armv8l', maxTouchPoints: 5 })
    expect(isIosDevice()).toBe(false)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })
    expect(isIosDevice()).toBe(false)
  })
})

describe('shouldShowInstallButton', () => {
  it('shows in a plain browser even with no captured prompt and no iOS', () => {
    expect(shouldShowInstallButton(false, false)).toBe(true)
  })

  it('hides when already standalone or just installed', () => {
    expect(shouldShowInstallButton(true, false)).toBe(false)
    expect(shouldShowInstallButton(false, true)).toBe(false)
  })
})

describe('installAction', () => {
  it('prefers the captured prompt, then the iOS hint, then the menu hint', () => {
    expect(installAction(true, true)).toBe('prompt')
    expect(installAction(true, false)).toBe('prompt')
    expect(installAction(false, true)).toBe('ios-hint')
    expect(installAction(false, false)).toBe('menu-hint')
  })
})

describe('isStandalone', () => {
  it('is false in a plain server-side context', () => {
    expect(isStandalone()).toBe(false)
  })

  it('honors the iOS navigator.standalone flag', () => {
    vi.stubGlobal('window', { navigator: { standalone: true }, matchMedia: () => ({ matches: false }) })
    expect(isStandalone()).toBe(true)
  })

  it('honors the standalone display mode', () => {
    vi.stubGlobal('window', { navigator: {}, matchMedia: (q: string) => ({ matches: q.includes('standalone') }) })
    expect(isStandalone()).toBe(true)
  })
})
