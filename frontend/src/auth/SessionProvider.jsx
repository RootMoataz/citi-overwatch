import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { SessionContext } from './sessionContext.js'

const statusFor = (user) => (user ? (user.must_change_password ? 'restricted' : 'ready') : 'anon')

/** Holds the signed-in user. The access token lives only in memory; the refresh cookie restores it. */
export default function SessionProvider({ children }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState({ user: null, status: 'loading' })

  useEffect(() => {
    let alive = true
    api.onSessionExpired(() => {
      if (!alive) return
      queryClient.clear()
      setState({ user: null, status: 'anon' })
    })
    const off = api.onSessionRefreshed((user) => alive && setState({ user, status: statusFor(user) }))
    api.refresh().catch(() => alive && setState({ user: null, status: 'anon' }))
    return () => { alive = false; off() }
  }, [queryClient])

  const login = useCallback(async (username, password) => {
    const data = await api.post('/auth/login', { username, password })
    api.setToken(data.access_token)
    setState({ user: data.user, status: statusFor(data.user) })
    return data.user
  }, [])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const data = await api.post('/auth/change-password',
      { current_password: currentPassword, new_password: newPassword })
    api.setToken(data.access_token)
    setState({ user: data.user, status: statusFor(data.user) })
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* signing out locally is enough */ }
    api.setToken(null)
    queryClient.clear()
    setState({ user: null, status: 'anon' })
  }, [queryClient])

  const setUser = useCallback((user) => setState((s) => ({ ...s, user: { ...s.user, ...user } })), [])

  const value = useMemo(() => ({ ...state, login, logout, changePassword, setUser }),
    [state, login, logout, changePassword, setUser])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
