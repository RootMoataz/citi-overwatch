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

describe('signing in clears the typing kept for anyone else (SEC-1)', () => {
  const ELI = ['overwatch.timesheet.unsaved.u-emp.2026-10-05', 'overwatch.timesheet.unsaved.u-emp.2026-10-12']
  const MORGAN = 'overwatch.timesheet.unsaved.u-mgr.2026-10-12'

  function Switcher() {
    const { status, user, login } = useSession()
    return (
      <>
        <p>{`Status: ${status}${user ? ` as ${user.id}` : ''}`}</p>
        <button type="button" onClick={() => login('employee.demo', 'secret')}>Sign in as Eli</button>
        <button type="button" onClick={() => login('manager.demo', 'secret')}>Sign in as Morgan</button>
      </>
    )
  }
  const signsInAs = http.post(`${API}/auth/login`, async ({ request }) => {
    const { username } = await request.json()
    return HttpResponse.json({ access_token: 'tok', user: username === 'manager.demo' ? users.manager : users.employee })
  })
  const renderSwitcher = () => renderWithProviders(<SessionProvider><Switcher /></SessionProvider>)
  function keepEachOnesTyping() {
    ;[...ELI, MORGAN].forEach((k) => sessionStorage.setItem(k, typing))
    sessionStorage.setItem(DEMO_FLAG, '1')
  }

  test("someone else signing in on the tab removes the timed-out person's typing and keeps their own", async () => {
    keepEachOnesTyping()
    server.use(refreshRefused(), signsInAs)
    renderSwitcher()
    await screen.findByText('Status: anon')
    // A lapsed session (REFRESH_INVALID, also how a demo end can look) keeps it for the same person's next sign-in.
    expect(unsavedKeys()).toEqual([...ELI, MORGAN].sort())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in as Morgan' }))
    expect(await screen.findByText('Status: ready as u-mgr')).toBeInTheDocument()
    expect(unsavedKeys()).toEqual([MORGAN])
    expect(sessionStorage.getItem(DEMO_FLAG)).toBe('1')
  })

  const restoresAs = (user) => http.post(`${API}/auth/refresh`, () => HttpResponse.json({ access_token: 'tok', user }))

  test("a reload that restores someone else's session (the refresh cookie) removes the previous person's typing", async () => {
    keepEachOnesTyping()
    server.use(restoresAs(users.manager))
    renderSwitcher()
    expect(await screen.findByText('Status: ready as u-mgr')).toBeInTheDocument()
    expect(unsavedKeys()).toEqual([MORGAN])
    expect(sessionStorage.getItem(DEMO_FLAG)).toBe('1')
  })

  test('a reload that restores the same person keeps their typing, so My timesheet restores it', async () => {
    keepEachOnesTyping()
    server.use(restoresAs(users.employee))
    renderSwitcher()
    expect(await screen.findByText('Status: ready as u-emp')).toBeInTheDocument()
    expect(unsavedKeys()).toEqual(ELI)
    expect(JSON.parse(sessionStorage.getItem(ELI[1]))).toEqual({ drafts: { 'm1|2026-10-13': '9' }, notes: {} })
  })

  test('the same person signing back in keeps their typing, so My timesheet restores it', async () => {
    keepEachOnesTyping()
    server.use(refreshRefused(), signsInAs)
    renderSwitcher()
    await screen.findByText('Status: anon')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in as Eli' }))
    expect(await screen.findByText('Status: ready as u-emp')).toBeInTheDocument()
    expect(unsavedKeys()).toEqual(ELI)
    expect(JSON.parse(sessionStorage.getItem(ELI[1]))).toEqual({ drafts: { 'm1|2026-10-13': '9' }, notes: {} })
  })
})
