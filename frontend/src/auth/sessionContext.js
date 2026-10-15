import { createContext, useContext } from 'react'

export const SessionContext = createContext(null)

/** {user, status: 'loading'|'anon'|'restricted'|'ready', ended: null|'demo' (why the last session ended), login, logout,
 * changePassword, setUser} */
export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}
