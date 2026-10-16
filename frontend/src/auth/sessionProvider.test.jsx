// Signing out clears the unsaved timesheet typing kept in this tab (spec §5.2 "Unsaved typing"); a lapsed session doesn't.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { api } from '../api/client.js'
import { API, HttpResponse, http, server } from '../test/server.js'
import { renderWithProviders, users } from '../test/render.jsx'
import SessionProvider from './SessionProvider.jsx'
import { useSession } from './sessionContext.js'

const UNSAVED = ['overwatch.timesheet.unsaved.u-emp.2026-10-12', 'overwatch.timesheet.unsaved.u-emp.2026-10-05']
const DEMO_FLAG = 'acme-scout:demo-welcomed:x'
const typing = JSON.stringify({ drafts: { 'm1|2026-10-13': '9' }, notes: {} })

function Consumer() {
  const { status, login, logout } = useSession()
  return (
    <>
      <p>Status: {status}</p>
      <button type="button" onClick={() => login('demo.employee', 'demo')}>Sign in</button>
      <button type="button" onClick={logout}>Sign out</button>
    </>
  )
}
const renderSession = () => renderWithProviders(<SessionProvider><Consumer /></SessionProvider>)
const refreshRefused = (code = 'REFRESH_INVALID') => http.post(`${API}/auth/refresh`, () =>
  HttpResponse.json({ error: { code, message: 'Your session has ended.' } }, { status: 401 }))
const loggedOut = (calls) => http.post(`${API}/auth/logout`, () => {
  calls.push('logout')
  return new HttpResponse(null, { status: 204 })
})
const unsavedKeys = () => Object.keys(sessionStorage).filter((k) => k.startsWith('overwatch.timesheet.unsaved.')).sort()

function keepTyping() {
  UNSAVED.forEach((k) => sessionStorage.setItem(k, typing))
  sessionStorage.setItem(DEMO_FLAG, '1')
}

afterEach(() => { api.setToken(null) })

describe('SessionProvider and unsaved timesheet typing', () => {
  test('logout() from a consumer removes both unsaved keys and nothing else', async () => {
    const calls = []
    keepTyping()
    server.use(refreshRefused(), loggedOut(calls))
    renderSession()
    expect(await screen.findByText('Status: anon')).toBeInTheDocument()
    // The refused refresh is a lapsed session, not a sign-out: the typing stays for the same person's next sign-in.
    expect(unsavedKeys()).toEqual([...UNSAVED].sort())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(calls).toEqual(['logout']))
    await waitFor(() => expect(unsavedKeys()).toEqual([]))
    expect(sessionStorage.getItem(DEMO_FLAG)).toBe('1')
  })

  test("a sign-out the server can't answer still clears it", async () => {
    keepTyping()
    server.use(refreshRefused(), http.post(`${API}/auth/logout`, () => HttpResponse.error()))
    renderSession()
    await screen.findByText('Status: anon')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(unsavedKeys()).toEqual([]))
  })

  test("the demo's end signs out through logout and clears it", async () => {
    const calls = []
    keepTyping()
    const demo = { ...users.employee, username: 'demo.employee', must_change_password: false, is_public_demo: true,
      session_expires_at: new Date(Date.now() - 1000).toISOString() }
    server.use(refreshRefused(), loggedOut(calls),
      http.post(`${API}/auth/login`, () => HttpResponse.json({ access_token: 'tok', user: demo })))
    renderSession()
    await screen.findByText('Status: anon')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(calls).toEqual(['logout']))
    await waitFor(() => expect(unsavedKeys()).toEqual([]))
    expect(sessionStorage.getItem(DEMO_FLAG)).toBe('1')
  })

  test('a refresh refused because the demo ended clears it too', async () => {
    keepTyping()
    server.use(refreshRefused('DEMO_SESSION_EXPIRED'))
    renderSession()
    await screen.findByText('Status: anon')
    await waitFor(() => expect(unsavedKeys()).toEqual([]))
    expect(sessionStorage.getItem(DEMO_FLAG)).toBe('1')
  })
})
