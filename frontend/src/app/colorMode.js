// Light, dark or follow the operating system ("system", the default). The choice is kept per browser.
import { createContext, useContext, useSyncExternalStore } from 'react'

export const COLOR_MODE_KEY = 'overwatch.colorMode'
export const PREFERENCES = ['light', 'dark', 'system']
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The stored choice, or "system" when there is none or storage is blocked (private windows, strict settings). */
export function readPreference() {
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_KEY)
    return PREFERENCES.includes(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function storePreference(preference) {
  try {
    window.localStorage.setItem(COLOR_MODE_KEY, preference)
  } catch {
    // Storage blocked: the choice still applies until the page is closed.
  }
}

const darkQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null)

function subscribe(onChange) {
  const query = darkQuery()
  query?.addEventListener?.('change', onChange)
  return () => query?.removeEventListener?.('change', onChange)
}

/** True while the operating system asks for dark; updates live when it changes. */
export function useSystemDark() {
  return useSyncExternalStore(subscribe, () => Boolean(darkQuery()?.matches), () => false)
}

export const resolveMode = (preference, systemDark) =>
  (preference === 'system' ? (systemDark ? 'dark' : 'light') : preference)

/** {preference: 'light'|'dark'|'system', mode: 'light'|'dark', setPreference} */
export const ColorModeContext = createContext({ preference: 'system', mode: 'light', setPreference() {} })

export const useColorMode = () => useContext(ColorModeContext)
