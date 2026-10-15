// The public demo admin's session: a countdown to the server-set end, and per-session "seen" flags for the welcome
// dialog and the hidden banner. The server enforces the end (backend auth/service.py); this only shows it.
import { useCallback, useEffect, useState } from 'react'
import { isPublicDemo } from './permissions.js'

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
function useSessionFlag(name, user) {
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
  const [hidden, setHidden] = useSessionFlag('demo-banner-hidden', user)
  const [welcomed, setWelcomed] = useSessionFlag('demo-welcomed', user)
  return {
    active,
    clock: secondsLeft == null ? null : formatClock(secondsLeft),
    hidden,
    hide: () => setHidden(true),
    show: () => setHidden(false),
    welcomeOpen: active && !welcomed,
    closeWelcome: () => setWelcomed(true),
  }
}
