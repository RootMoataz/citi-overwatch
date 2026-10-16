// The public demo admin's session: a countdown to the server-set end, per-session flags (the welcome dialog seen, a
// page's demo notice hidden) and the colours of the demo pill and notices. The server enforces the end (backend
// auth/service.py); this only shows it.
import { alpha, lighten } from '@mui/material/styles'
import { useCallback, useEffect, useState } from 'react'
import { isPublicDemo } from './permissions.js'

/**
 * The demo pill's and notices' colours: a tint of the warning colour (error under 1:00) with text in a shade that reads
 * at 4.5:1 or more on it: the darker tone on a solid cream in light mode, the lighter one on a see-through tint in dark.
 */
export function demoTone(theme, { urgent = false } = {}) {
  const palette = urgent ? theme.palette.error : theme.palette.warning
  if (theme.palette.mode === 'dark') {
    return { text: palette.light, fill: alpha(palette.main, 0.16), hover: alpha(palette.main, 0.26), edge: alpha(palette.main, 0.45) }
  }
  return { text: palette.dark, fill: lighten(palette.main, 0.9), hover: lighten(palette.main, 0.8), edge: alpha(palette.main, 0.35) }
}

/** "4:32" for 272 seconds; never negative. */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Whole seconds until `iso`, ticking once a second (0 once it has passed). */
export function useSecondsLeft(iso) {
  const end = iso ? new Date(iso).getTime() : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (end == null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [end])
  return end == null ? null : Math.max(0, Math.ceil((end - now) / 1000))
}

// Flags live for the browser tab and are keyed by the session's end, so a new demo session starts fresh.
function readFlag(key) {
  try { return window.sessionStorage.getItem(key) === '1' } catch { return false }
}
function writeFlag(key, on) {
  try {
    if (on) window.sessionStorage.setItem(key, '1')
    else window.sessionStorage.removeItem(key)
  } catch { /* the in-memory state still works */ }
}

/** A flag for this demo session that survives a reload of the tab: [value, set(value)]. */
export function useSessionFlag(name, user) {
  const key = `acme-scout:${name}:${user?.session_expires_at ?? user?.id ?? ''}`
  const [flags, setFlags] = useState({})
  const value = flags[key] ?? readFlag(key)
  const set = useCallback((on) => { writeFlag(key, on); setFlags((f) => ({ ...f, [key]: on })) }, [key])
  return [value, set]
}

/** Everything the header needs for a public demo session; `active` is false for everyone else. */
export function useDemoNotice(user) {
  const active = isPublicDemo(user)
  const secondsLeft = useSecondsLeft(active ? user.session_expires_at : null)
  const [welcomed, setWelcomed] = useSessionFlag('demo-welcomed', user)
  return {
    active,
    secondsLeft,
    clock: secondsLeft == null ? null : formatClock(secondsLeft),
    welcomeOpen: active && !welcomed,
    closeWelcome: () => setWelcomed(true),
  }
}
