// The public demo admin (demo.admin): the countdown banner, the welcome dialog, and the actions it can't take.
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ArchivePage from '../features/archive/ArchivePage.jsx'
import DepartmentsPage from '../features/departments/DepartmentsPage.jsx'
import PeoplePage from '../features/people/PeoplePage.jsx'
import UserDetailPage from '../features/people/UserDetailPage.jsx'
import ProfilePage from '../features/profile/ProfilePage.jsx'
import ProjectDetailPage from '../features/projects/ProjectDetailPage.jsx'
import { API, HttpResponse, http, server } from '../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../test/render.jsx'
import Layout from './Layout.jsx'

const NOW = new Date('2026-10-15T12:00:00Z')
const DISABLED = 'Disabled in the public demo'

function renderLayout(user) {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout user={user} onLogout={() => {}} />}>
        <Route path="/" element={<p>Home content</p>} />
      </Route>
    </Routes>,
  )
}

/** The demo admin with 4 minutes 32 seconds left, on a frozen clock that only moves when the test says.
 * Unless `welcomed` is false, the welcome dialog was already seen this session (it would hide the page behind it). */
function demoWithTimeLeft(seconds = 272, { welcomed = true } = {}) {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  const user = { ...users.demoAdmin, session_expires_at: new Date(NOW.getTime() + seconds * 1000).toISOString() }
  if (welcomed) sessionStorage.setItem(`acme-scout:demo-welcomed:${user.session_expires_at}`, '1')
  return user
}

afterEach(() => {
  vi.useRealTimers()
  try { sessionStorage.clear() } catch { /* nothing stored */ }
})

describe('demo banner and welcome', () => {
  test('a demo admin sees a live countdown banner', () => {
    renderLayout(demoWithTimeLeft())
    const banner = screen.getByRole('region', { name: /demo session/i })
    expect(banner).toHaveTextContent("Demo admin — for demonstration only. You'll be signed out in 4:32.")
    act(() => { vi.advanceTimersByTime(1000) })
    expect(banner).toHaveTextContent('signed out in 4:31')
    act(() => { vi.advanceTimersByTime(4 * 60 * 1000 + 31 * 1000 + 5000) })
    expect(banner).toHaveTextContent('signed out in 0:00')
  })

  test('the banner can be hidden but the countdown stays in the header', async () => {
    const user = demoWithTimeLeft()
    renderLayout(user)
    act(() => { screen.getByRole('button', { name: /hide demo notice/i }).click() })
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: /demo session/i })).not.toBeInTheDocument())
    const chip = screen.getByRole('button', { name: /demo admin: signed out in 4:32/i })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(chip).toHaveAccessibleName(/signed out in 4:30/i)
    act(() => { chip.click() })
    expect(screen.getByRole('region', { name: /demo session/i })).toHaveTextContent('4:30')
  })

  test('a welcome dialog explains the demo once per session', async () => {
    const user = demoWithTimeLeft(272, { welcomed: false })
    const { unmount } = renderLayout(user)
    const dialog = screen.getByRole('dialog', { name: /public demo admin/i })
    expect(dialog).toHaveTextContent('This is a public demo admin account for presentation purposes. Some actions are '
      + "disabled, and you'll be signed out automatically in 5 minutes.")
    act(() => { within(dialog).getByRole('button', { name: /got it/i }).click() })
    vi.useRealTimers()
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    unmount()
    renderLayout(user)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('everyone else gets no banner and no dialog', () => {
    renderLayout(users.admin)
    expect(screen.queryByRole('region', { name: /demo session/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('the account menu keeps the profile photo out of reach', async () => {
    sessionStorage.setItem(`acme-scout:demo-welcomed:${users.demoAdmin.id}`, '1')
    renderLayout(users.demoAdmin)
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const photo = screen.getByRole('menuitem', { name: /profile photo/i })
    expect(photo).toHaveAttribute('aria-disabled', 'true')
    expect(photo).toHaveTextContent(DISABLED)
  })
})

async function expectDisabledWithTooltip(button) {
  expect(button).toBeDisabled()
  await userEvent.hover(button.parentElement)
  expect(await screen.findByRole('tooltip')).toHaveTextContent(DISABLED)
}

describe('blocked actions are disabled for the demo admin', () => {
  test('profile: name, email and photo', async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ ...users.demoAdmin, email: 'demo.admin@acme.example',
      job_title: 'Public demo administrator', salary: 120000 })))
    renderAsUser(<ProfilePage />, { user: users.demoAdmin, route: '/profile', path: '/profile' })
    await expectDisabledWithTooltip(await screen.findByRole('button', { name: /change photo/i }))
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: /email/i })).toBeDisabled()
  })

  test('people: no new accounts, and a person stays as they are', async () => {
    const ada = { id: 'u-ada', username: 'ada', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@acme.example',
      role: 'employee', job_title: 'Analyst', salary: 90000, manager_id: null, department_id: null, is_archived: false }
    server.use(http.get(`${API}/users`, () => HttpResponse.json({ items: [ada], total: 1 })),
      http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/users/u-ada`, () => HttpResponse.json(ada)))
    const { unmount } = renderAsUser(<PeoplePage />, { user: users.demoAdmin, route: '/people', path: '/people' })
    await expectDisabledWithTooltip(await screen.findByRole('button', { name: /new account/i }))
    unmount()
    renderAsUser(<UserDetailPage />, { user: users.demoAdmin, route: '/people/u-ada', path: '/people/:id' })
    for (const name of [/reset password/i, /^archive$/i]) {
      expect(await screen.findByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  test('departments can be looked at, not changed', async () => {
    server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: [
      { id: 'd1', name: 'Technology', is_archived: false, user_count: 7, project_count: 2 },
      { id: 'd9', name: 'Legacy', is_archived: true, user_count: 1, project_count: 0 }] })))
    renderAsUser(<DepartmentsPage />, { user: users.demoAdmin, route: '/departments', path: '/departments' })
    await expectDisabledWithTooltip(await screen.findByRole('button', { name: /archive technology/i }))
    for (const name of [/rename technology/i, /restore legacy/i, /^add$/i]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  test('a project cannot be archived, but milestones still can be restored from the archive', async () => {
    const p = { id: 'p1', name: 'Apollo', description: '', status: 'active', start_date: '2026-01-01',
      predicted_end_date: '2026-12-31', budget: 1000, consumed: 0, budget_pct: 0, progress_pct: 0, at_risk_reasons: [],
      is_archived: false, completed_at: null, manager: { id: users.manager.id, name: 'Morgan Manager' } }
    server.use(http.get(`${API}/projects/p1`, () => HttpResponse.json(p)),
      http.get(`${API}/projects/p1/summary`, () => HttpResponse.json({ project: p, budget: 1000, consumed: 0,
        remaining: 1000, budget_pct: 0, progress_pct: 0, at_risk_reasons: [], member_count: 0 })),
      http.get(`${API}/projects/p1/members`, () => HttpResponse.json([])),
      http.get(`${API}/projects/p1/milestone-costs`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })))
    const { unmount } = renderAsUser(<ProjectDetailPage />, { user: users.demoAdmin, route: '/projects/p1',
      path: '/projects/:id' })
    await expectDisabledWithTooltip(await screen.findByRole('button', { name: /^archive$/i }))
    expect(screen.getByRole('button', { name: /edit/i })).toBeEnabled()
    unmount()

    server.use(http.get(`${API}/archive`, () => HttpResponse.json({ items: [
      { type: 'project', id: 'p9', name: 'Gone Project', archived_at: '2026-10-13T12:00:00Z', can_restore: true },
      { type: 'milestone', id: 'm9', name: 'Dropped Milestone', archived_at: '2026-10-12T12:00:00Z', can_restore: true },
      { type: 'user', id: 'u9', name: 'Lee Leaver', archived_at: '2026-10-11T12:00:00Z', can_restore: true }] })))
    renderAsUser(<ArchivePage />, { user: users.demoAdmin, route: '/archive', path: '/archive' })
    expect(await screen.findByRole('button', { name: /restore gone project/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /restore lee leaver/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /restore dropped milestone/i })).toBeEnabled()
  })
})
