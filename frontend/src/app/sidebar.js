// The desktop sidebar can shrink to icons. The choice is kept per browser; "[" toggles it from anywhere except
// while typing.
import { useCallback, useEffect, useState } from 'react'

export const SIDEBAR_KEY = 'overwatch.sidebarCollapsed'
export const SIDEBAR_SHORTCUT = '['

function readCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

function storeCollapsed(value) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, String(value))
  } catch {
    // Storage blocked: the choice still applies until the page is closed.
  }
}

const typing = (el) => Boolean(el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"]'))

/** [collapsed, toggle]. `enabled` false (phones) ignores the shortcut. */
export function useSidebarCollapsed(enabled = true) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = useCallback(() => {
    setCollapsed((was) => {
      storeCollapsed(!was)
      return !was
    })
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    const onKey = (e) => {
      if (e.key !== SIDEBAR_SHORTCUT || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      if (typing(e.target) || typing(document.activeElement)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, toggle])

  return [collapsed, toggle]
}
