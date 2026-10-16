import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { SessionContext } from './sessionContext.js'

const statusFor = (user) => (user ? (user.must_change_password ? 'restricted' : 'ready') : 'anon')

/** Holds the signed-in user. The access token lives only in memory; the refresh cookie restores it.
 * A public demo session (user.is_public_demo) ends at user.session_expires_at: the server refuses it from then on,
 * and the app signs out at that moment and says why (`ended: 'demo'`, shown on the sign-in page).
 * `signedOut` marks a deliberate sign-out (RequireAuth then keeps no return path); `lastUserId` is who was signed
 * in when the session last ended, so a deep link is honoured only for that same person. Both live in memory. */
export default function SessionProvider({ children }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState({ user: null, status: 'loading', ended: null, signedOut: false, lastUserId: null })

  useEffect(() => {
    let alive = true
    api.onSessionExpired((err) => {
      if (!alive) return
      queryClient.clear()
      setState((s) => ({ user: null, status: 'anon', ended: err?.code === 'DEMO_SESSION_EXPIRED' ? 'demo' : null,
        signedOut: false, lastUserId: s.user?.id ?? s.lastUserId }))
    })
    const off = api.onSessionRefreshed((user) => alive && setState({ user, status: statusFor(user), ended: null }))
    // A failed restore keeps the reason the expiry handler just recorded.
    api.refresh().catch(() => alive && setState((s) => ({ ...s, user: null, status: 'anon' })))
    return () => { alive = false; off() }
  }, [queryClient])

  const login = useCallback(async (username, password) => {
    const data = await api.post('/auth/login', { username, password })
    api.setToken(data.access_token)
    setState((s) => ({ ...s, user: data.user, status: statusFor(data.user), ended: null, signedOut: false }))
    return data.user
  }, [])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const data = await api.post('/auth/change-password',
      { current_password: currentPassword, new_password: newPassword })
    api.setToken(data.access_token)
    setState({ user: data.user, status: statusFor(data.user), ended: null })
    return data.user
  }, [])

  const logout = useCallback(async (ended = null) => {
    try { await api.post('/auth/logout') } catch { /* signing out locally is enough */ }
    api.setToken(null)
    queryClient.clear()
    setState((s) => ({ user: null, status: 'anon', ended, signedOut: true, lastUserId: s.user?.id ?? s.lastUserId }))
  }, [queryClient])

  // The demo's hard stop: sign out when the server-set end arrives, whatever the person is doing.
  const demoEnds = state.user?.is_public_demo ? state.user.session_expires_at : null
  useEffect(() => {
    if (!demoEnds) return undefined
    const timer = setTimeout(() => logout('demo'), Math.max(0, new Date(demoEnds).getTime() - Date.now()))
    return () => clearTimeout(timer)
  }, [demoEnds, logout])

  const setUser = useCallback((user) => setState((s) => ({ ...s, user: { ...s.user, ...user } })), [])

  const value = useMemo(() => ({ ...state, login, logout: () => logout(), changePassword, setUser }),
    [state, login, logout, changePassword, setUser])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
