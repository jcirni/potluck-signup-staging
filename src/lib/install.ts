/** True when the app already runs installed (home screen / standalone window). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

/** Show the install button whenever the app is not already running installed. */
export function shouldShowInstallButton(standalone: boolean, justInstalled: boolean): boolean {
  return !standalone && !justInstalled
}

export type InstallAction = 'prompt' | 'ios-hint' | 'menu-hint'

/** Click behavior: captured prompt first, iOS Share hint next, browser-menu hint everywhere else. */
export function installAction(hasPrompt: boolean, ios: boolean): InstallAction {
  if (hasPrompt) return 'prompt'
  if (ios) return 'ios-hint'
  return 'menu-hint'
}

/** iOS Safari never fires beforeinstallprompt; it needs the Share-sheet hint instead. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iphone|ipad|ipod/i.test(navigator.userAgent ?? '')) return true
  // iPads in desktop mode pose as Macs; touch points give them away.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}
