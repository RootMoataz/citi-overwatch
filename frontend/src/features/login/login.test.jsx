import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from '../../app/App.jsx'
import { api } from '../../api/client.js'
import { API, HttpResponse, delay, http, server } from '../../test/server.js'
import { renderWithProviders, users } from '../../test/render.jsx'

const noSession = () => http.post(`${API}/auth/refresh`, () =>
  HttpResponse.json({ error: { code: 'REFRESH_INVALID', message: 'ended' } }, { status: 401 }))

function loginReturns(user, { wait = 0 } = {}) {
  return http.post(`${API}/auth/login`, async () => {
    if (wait) await delay(wait)
    return HttpResponse.json({ access_token: 'tok', user })
  })
}

const dashboardStub = () => http.get(`${API}/dashboard`, () => HttpResponse.json({
  status_counts: { planned: 0, active: 0, on_hold: 0, completed: 0 }, projects: [], at_risk: [],
  milestones: { overdue: [], due_soon: [] }, over_allocated: [], budgets: [], pending_approvals: 0,
}))

async function signIn(user = userEvent.setup()) {
  await user.type(screen.getByLabelText(/username/i), 'eli')
  await user.type(screen.getByLabelText(/^password/i), 'Passw0rd!')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

afterEach(() => {
  api.setToken(null)
  vi.useRealTimers()
})

describe('login', () => {
  test('login shows field errors and disables submit while pending', async () => {
    server.use(noSession(), loginReturns({ ...users.employee, must_change_password: false }, { wait: 150 }),
      dashboardStub())
    renderWithProviders(<App />, { route: '/login' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /sign in/i }))
    expect(await screen.findByText('Enter your username')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    await signIn(user)
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    expect(await screen.findByRole('navigation', { name: /main/i })).toBeInTheDocument()
  })

  test('wrong credentials show a form message', async () => {
    server.use(noSession(), http.post(`${API}/auth/login`, () => HttpResponse.json(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username or password', request_id: 'r1' } },
      { status: 401 })))
    renderWithProviders(<App />, { route: '/login' })
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password')
  })

  test('expired temp password message shown', async () => {
    server.use(noSession(), http.post(`${API}/auth/login`, () => HttpResponse.json(
      { error: { code: 'TEMP_PASSWORD_EXPIRED', message: 'x' } }, { status: 401 })))
    renderWithProviders(<App />, { route: '/login' })
    await signIn()
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Temporary password expired — ask an admin to reset it.')
  })

  test('locked accounts say when to try again', async () => {
    server.use(noSession(), http.post(`${API}/auth/login`, () => HttpResponse.json(
      { error: { code: 'ACCOUNT_LOCKED', message: 'x', details: { until: '2026-10-13T20:15:00+00:00' } } },
      { status: 423 })))
    renderWithProviders(<App />, { route: '/login' })
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many failed attempts/i)
  })

  test('anonymous visitors are sent to the login page', async () => {
    server.use(noSession())
    renderWithProviders(<App />, { route: '/projects' })
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  test('an existing session skips the login page', async () => {
    server.use(http.post(`${API}/auth/refresh`, () =>
      HttpResponse.json({ access_token: 't', user: { ...users.manager, must_change_password: false } })), dashboardStub())
    renderWithProviders(<App />, { route: '/' })
    expect(await screen.findByRole('navigation', { name: /main/i })).toHaveTextContent('Timesheets')
  })
})

describe('login page brand and demo', () => {
  test('shows the ACME Scout brand and the slogan', async () => {
    server.use(noSession())
    renderWithProviders(<App />, { route: '/login' })
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /acme scout/i }).length).toBeGreaterThan(0)
    expect(screen.getByText(/before it slips/i)).toBeInTheDocument()
    expect(screen.getByText('ACME Scout · a project by Moataz Hikal')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/overwatch/i)
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password')
  })

  test('links to the source code on GitHub in a new tab', async () => {
    server.use(noSession())
    renderWithProviders(<App />, { route: '/login' })
    const source = await screen.findByRole('link', { name: /view the source on github/i })
    expect(source).toHaveAttribute('href', 'https://github.com/RootMoataz/citi-overwatch')
    expect(source).toHaveAttribute('target', '_blank')
    expect(source).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  test.each([
    ['Employee', 'employee.demo', users.employee],
    ['Manager', 'manager.demo', users.manager],
    ['Executive', 'executive.demo', users.executive],
    ['Admin', 'demo.admin', { ...users.employee, is_public_demo: true }],
  ])('the %s demo button signs in as %s', async (label, username, who) => {
    let sent = null
    server.use(noSession(), dashboardStub(),
      http.post(`${API}/auth/login`, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ access_token: 'tok', user: { ...who, must_change_password: false } })
      }))
    renderWithProviders(<App />, { route: '/login' })
    const demo = await screen.findByRole('group', { name: /try the demo/i })
    await userEvent.click(within(demo).getByRole('button', { name: label }))
    if (who.is_public_demo) await userEvent.click(await screen.findByRole('button', { name: /got it/i }))
    expect(await screen.findByRole('navigation', { name: /main/i })).toBeInTheDocument()
    expect(sent).toEqual({ username, password: 'Demo123!' })
  })

  test('the Admin demo button is the public demo admin, never the real admin', async () => {
    server.use(noSession())
    renderWithProviders(<App />, { route: '/login' })
    const demo = await screen.findByRole('group', { name: /try the demo/i })
    expect(within(demo).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Employee', 'Manager', 'Executive', 'Admin'])
    expect(demo).toHaveTextContent(/admin demo signs you out after 5 minutes/i)
  })

  // A public demo session the server ends 5 minutes after sign-in. The user is an employee-shaped account so the
  // home page needs nothing beyond the dashboard stub; what matters is is_public_demo and session_expires_at.
  const demoUser = (msLeft) => ({ ...users.employee, username: 'demo.admin', must_change_password: false,
    is_public_demo: true, session_expires_at: new Date(Date.now() + msLeft).toISOString() })

  test('when the demo session runs out the app signs out and says why', async () => {
    let loggedOut = false
    server.use(noSession(), dashboardStub(), loginReturns(demoUser(1500)),
      http.post(`${API}/auth/logout`, () => { loggedOut = true; return new HttpResponse(null, { status: 204 }) }))
    renderWithProviders(<App />, { route: '/login' })
    const demo = await screen.findByRole('group', { name: /try the demo/i })
    await userEvent.click(within(demo).getByRole('button', { name: 'Admin' }))
    expect(await screen.findByRole('dialog', { name: /public demo admin/i })).toBeInTheDocument()
    expect(await screen.findByText('Your 5-minute demo session has ended.', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(loggedOut).toBe(true)
  })

  test('a refresh the server refuses because the demo ended shows the same message', async () => {
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.json(
      { error: { code: 'DEMO_SESSION_EXPIRED', message: 'Your 5-minute demo session has ended.' } }, { status: 401 })))
    renderWithProviders(<App />, { route: '/' })
    expect(await screen.findByText('Your 5-minute demo session has ended.')).toBeInTheDocument()
  })

  test('the message goes away on the next sign-in', async () => {
    server.use(noSession(), dashboardStub(), loginReturns(demoUser(1500)),
      http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })))
    renderWithProviders(<App />, { route: '/login' })
    await userEvent.click(within(await screen.findByRole('group', { name: /try the demo/i }))
      .getByRole('button', { name: 'Admin' }))
    await screen.findByText('Your 5-minute demo session has ended.', {}, { timeout: 4000 })
    server.use(loginReturns({ ...users.employee, must_change_password: false }))
    await userEvent.click(within(screen.getByRole('group', { name: /try the demo/i })).getByRole('button', { name: 'Employee' }))
    expect(await screen.findByRole('navigation', { name: /main/i })).toBeInTheDocument()
    expect(screen.queryByText('Your 5-minute demo session has ended.')).not.toBeInTheDocument()
  })

  test('a failed demo sign-in shows the error', async () => {
    server.use(noSession(), http.post(`${API}/auth/login`, () => HttpResponse.json(
      { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }, { status: 401 })))
    renderWithProviders(<App />, { route: '/login' })
    const demo = await screen.findByRole('group', { name: /try the demo/i })
    await userEvent.click(within(demo).getByRole('button', { name: 'Manager' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password')
  })
})

// Where the next sign-in lands. The app opens signed in as `first` on `route`; `leave` ends that session; then
// `second` signs in on the login page. Whatever page the sign-in ends on is printed by this probe.
describe('where sign-in lands', () => {
  const ready = (u) => ({ ...u, must_change_password: false })
  const restoreAs = (u) => http.post(`${API}/auth/refresh`, () => HttpResponse.json({ access_token: 't', user: ready(u) }))
  const loggedOut = () => http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 }))
  const here = () => screen.getByRole('status', { name: 'current page' }).textContent

  function Where() {
    const { pathname } = useLocation()
    const navigate = useNavigate()
    return (
      <>
        <output aria-label="current page">{pathname}</output>
        <button type="button" onClick={() => navigate('/messages')}>Open Messages directly</button>
      </>
    )
  }

  async function startOn(route, u) {
    server.use(restoreAs(u), loggedOut(), dashboardStub())
    renderWithProviders(<><App /><Where /></>, { route })
    await screen.findByRole('navigation', { name: /main/i })
  }

  async function signOutFromMenu() {
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))
    await screen.findByRole('heading', { name: /sign in/i })
  }

  async function signInAs(u) {
    server.use(loginReturns(ready(u)))
    await signIn()
    await screen.findByRole('navigation', { name: /main/i })
  }

  test('signing out on Messages and signing in as someone else lands on their home page', async () => {
    await startOn('/messages', users.admin)
    expect(here()).toBe('/messages')
    await signOutFromMenu()
    await signInAs(users.employee)
    expect(here()).toBe('/')
  })

  test('signing out and signing back in as the same person also lands on home', async () => {
    await startOn('/messages', users.employee)
    await signOutFromMenu()
    await signInAs(users.employee)
    expect(here()).toBe('/')
  })

  test('a deep link opened while signed out returns there after signing in', async () => {
    server.use(noSession(), dashboardStub())
    renderWithProviders(<><App /><Where /></>, { route: '/messages' })
    await screen.findByRole('heading', { name: /sign in/i })
    await signInAs(users.employee)
    expect(here()).toBe('/messages')
  })

  test('a session that expires on a page returns the same person there after signing in again, but not someone else',
    async () => {
      for (const [again, lands] of [[users.employee, '/messages'], [users.manager, '/']]) {
        let restored = false
        server.use(http.post(`${API}/auth/refresh`, () => {
          if (restored) return HttpResponse.json({ error: { code: 'REFRESH_INVALID', message: 'ended' } }, { status: 401 })
          restored = true
          return HttpResponse.json({ access_token: 't', user: ready(users.employee) })
        }), dashboardStub())
        const { unmount } = renderWithProviders(<><App /><Where /></>, { route: '/' })
        await screen.findByRole('navigation', { name: /main/i })
        // The session ends while they are on Messages: the next call is refused and the refresh fails.
        server.use(http.get(`${API}/conversations`, () => HttpResponse.json(
          { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })))
        await userEvent.click(within(screen.getByRole('navigation', { name: /main/i })).getByRole('link', { name: /messages/i }))
        await screen.findByRole('heading', { name: /sign in/i })
        await signInAs(again)
        expect(here()).toBe(lands)
        unmount()
        api.setToken(null)
      }
    })

  test('the demo session ending lands the next sign-in on home', async () => {
    const demo = { ...users.employee, username: 'demo.admin', is_public_demo: true,
      session_expires_at: new Date(Date.now() + 1500).toISOString() }
    server.use(noSession(), dashboardStub(), loginReturns(ready(demo)), loggedOut())
    renderWithProviders(<><App /><Where /></>, { route: '/login' })
    await userEvent.click(within(await screen.findByRole('group', { name: /try the demo/i }))
      .getByRole('button', { name: 'Admin' }))
    await userEvent.click(await screen.findByRole('button', { name: /got it/i }))
    await userEvent.click(await screen.findByRole('link', { name: /messages/i }))
    expect(here()).toBe('/messages')
    await screen.findByText('Your 5-minute demo session has ended.', {}, { timeout: 4000 })
    await signInAs(users.employee)
    expect(here()).toBe('/')
  })

  test('the server ending a demo session before the timer lands the next sign-in on home', async () => {
    let restored = false
    server.use(http.post(`${API}/auth/refresh`, () => {
      if (restored) return HttpResponse.json({ error: { code: 'DEMO_SESSION_EXPIRED', message: 'ended' } }, { status: 401 })
      restored = true
      return HttpResponse.json({ access_token: 't', user: ready(users.employee) })
    }), dashboardStub())
    renderWithProviders(<><App /><Where /></>, { route: '/' })
    await screen.findByRole('navigation', { name: /main/i })
    server.use(http.get(`${API}/conversations`, () => HttpResponse.json(
      { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }, { status: 401 })))
    await userEvent.click(within(screen.getByRole('navigation', { name: /main/i })).getByRole('link', { name: /messages/i }))
    await screen.findByText('Your 5-minute demo session has ended.')
    await signInAs(users.employee)
    expect(here()).toBe('/')
  })

  test('a late expiry after a sign-out does not bring the return path back', async () => {
    await startOn('/messages', users.employee)
    await signOutFromMenu()
    server.use(noSession())
    await act(async () => { await api.refresh().catch(() => {}) })
    // Visiting a protected page now must not make Messages the place to return to.
    await userEvent.click(screen.getByRole('button', { name: /open messages directly/i }))
    await screen.findByRole('heading', { name: /sign in/i })
    await signInAs(users.employee)
    expect(here()).toBe('/')
  })

  test('signing out from the Ctrl+K palette lands the next sign-in on home', async () => {
    await startOn('/messages', users.admin)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await userEvent.type(await screen.findByRole('combobox', { name: /search scout/i }), 'sign out{Enter}')
    await screen.findByRole('heading', { name: /sign in/i })
    await signInAs(users.employee)
    expect(here()).toBe('/')
  })
})

describe('forced password change', () => {
  test('restricted user sees non-dismissible ForcePasswordChange', async () => {
    server.use(noSession(), loginReturns({ ...users.employee, must_change_password: true }))
    renderWithProviders(<App />, { route: '/login' })
    await signIn()
    const dialog = await screen.findByRole('dialog', { name: /choose a new password/i })
    expect(within(dialog).queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: /choose a new password/i })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /main/i })).not.toBeInTheDocument()
  })

  test('confirm password must match; checklist ticks live', async () => {
    let changed = false
    server.use(noSession(), loginReturns({ ...users.employee, must_change_password: true }),
      http.post(`${API}/auth/change-password`, () => {
        changed = true
        return HttpResponse.json({ access_token: 'tok2', user: { ...users.employee, must_change_password: false } })
      }), dashboardStub())
    renderWithProviders(<App />, { route: '/login' })
    const user = userEvent.setup()
    await signIn(user)
    const dialog = await screen.findByRole('dialog', { name: /choose a new password/i })
    const rule = (text) => within(dialog).getByText(text).closest('li')
    expect(rule('At least 6 characters')).toHaveAttribute('data-met', 'false')
    await user.type(within(dialog).getByLabelText(/temporary password/i), 'Passw0rd!')
    await user.type(within(dialog).getByLabelText(/^new password/i), 'abc1')
    expect(rule('At least 1 number')).toHaveAttribute('data-met', 'true')
    expect(rule('At least 6 characters')).toHaveAttribute('data-met', 'false')
    await user.type(within(dialog).getByLabelText(/^new password/i), 'xy!')
    expect(rule('At least 6 characters')).toHaveAttribute('data-met', 'true')
    expect(rule('At least 1 special character')).toHaveAttribute('data-met', 'true')
    await user.type(within(dialog).getByLabelText(/confirm/i), 'different')
    await user.click(within(dialog).getByRole('button', { name: /save password/i }))
    expect(await within(dialog).findByText("Passwords don't match")).toBeInTheDocument()
    expect(changed).toBe(false)
    await user.clear(within(dialog).getByLabelText(/confirm/i))
    await user.type(within(dialog).getByLabelText(/confirm/i), 'abc1xy!')
    await user.click(within(dialog).getByRole('button', { name: /save password/i }))
    expect(await screen.findByRole('navigation', { name: /main/i })).toBeInTheDocument()
    expect(changed).toBe(true)
  })
})

describe('forgot password', () => {
  test('forgot flow walks username → code → new password', async () => {
    const seen = {}
    server.use(noSession(),
      http.post(`${API}/auth/forgot-password`, async ({ request }) => {
        seen.forgot = await request.json()
        return HttpResponse.json({ message: 'If that account exists, a code has been sent.' })
      }),
      http.post(`${API}/auth/verify-reset-code`, async ({ request }) => {
        seen.verify = await request.json()
        return HttpResponse.json({ reset_token: 'reset-tok' })
      }),
      http.post(`${API}/auth/reset-password`, async ({ request }) => {
        seen.reset = await request.json()
        return new HttpResponse(null, { status: 204 })
      }))
    renderWithProviders(<App />, { route: '/forgot-password' })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/username/i), 'eli')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify/i }))
    await user.type(await screen.findByLabelText(/^new password/i), 'N3w!pass')
    await user.type(screen.getByLabelText(/confirm/i), 'N3w!pass')
    await user.click(screen.getByRole('button', { name: /save password/i }))
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByText(/password updated/i)).toBeInTheDocument()
    expect(seen).toEqual({ forgot: { username: 'eli' }, verify: { username: 'eli', code: '123456' },
      reset: { reset_token: 'reset-tok', new_password: 'N3w!pass' } })
  })

  test('wrong code shows an error next to the field', async () => {
    server.use(noSession(),
      http.post(`${API}/auth/forgot-password`, () => HttpResponse.json({ message: 'ok' })),
      http.post(`${API}/auth/verify-reset-code`, () => HttpResponse.json(
        { error: { code: 'CODE_INVALID', message: "That code isn't right" } }, { status: 400 })))
    renderWithProviders(<App />, { route: '/forgot-password' })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/username/i), 'eli')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(await screen.findByLabelText(/6-digit code/i), '000000')
    await user.click(screen.getByRole('button', { name: /verify/i }))
    expect(await screen.findByText("That code isn't right")).toBeInTheDocument()
  })

  test('resend disabled for 60s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let sends = 0
    server.use(noSession(), http.post(`${API}/auth/forgot-password`, () => {
      sends += 1
      return HttpResponse.json({ message: 'ok' })
    }))
    renderWithProviders(<App />, { route: '/forgot-password' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.type(await screen.findByLabelText(/username/i), 'eli')
    await user.click(screen.getByRole('button', { name: /next/i }))
    const resend = await screen.findByRole('button', { name: /resend code/i })
    expect(resend).toBeDisabled()
    expect(resend).toHaveTextContent(/\d+s/)
    await act(async () => { vi.advanceTimersByTime(61000) })
    expect(screen.getByRole('button', { name: /resend code/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /resend code/i }))
    expect(sends).toBe(2)
  })
})
