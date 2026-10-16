// The public demo admin (demo.admin): the countdown pill, the welcome dialog, the page notices, and the actions it can't take.
import { getContrastRatio } from '@mui/material/styles'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ArchivePage from '../features/archive/ArchivePage.jsx'
import DepartmentsPage from '../features/departments/DepartmentsPage.jsx'
import PeoplePage from '../features/people/PeoplePage.jsx'
import UserDetailPage from '../features/people/UserDetailPage.jsx'
import ProfilePage from '../features/profile/ProfilePage.jsx'
import SkillsPage from '../features/skills/SkillsPage.jsx'
import ProjectDetailPage from '../features/projects/ProjectDetailPage.jsx'
import { demoTone } from '../lib/demoSession.js'
import { API, HttpResponse, http, server } from '../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../test/render.jsx'
import { setViewport } from '../test/setup.js'
import { DemoAccessNotice } from './DemoSession.jsx'
import Layout from './Layout.jsx'
import { buildTheme } from './theme.js'

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
function demoWithTimeLeft(seconds = 272, { welcomed = true, timeouts = false } = {}) {
  vi.useFakeTimers({ toFake: timeouts ? ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']
    : ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  const user = { ...users.demoAdmin, session_expires_at: new Date(NOW.getTime() + seconds * 1000).toISOString() }
  if (welcomed) sessionStorage.setItem(`acme-scout:demo-welcomed:${user.session_expires_at}`, '1')
  return user
}

afterEach(() => {
  vi.useRealTimers()
  try { sessionStorage.clear() } catch { /* nothing stored */ }
})

describe('demo pill and welcome', () => {
  test('only a public demo session has the pill, and no page banner exists', () => {
    const { unmount } = renderLayout(users.admin)
    expect(screen.queryByRole('button', { name: /demo session/i })).not.toBeInTheDocument()
    unmount()
    renderLayout(demoWithTimeLeft())
    expect(screen.getByRole('button', { name: /demo session/i })).toBeInTheDocument()
    expect(screen.queryByText(/for demonstration only/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /demo session/i })).not.toBeInTheDocument()
  })

  test('the pill label is one run of text, so the space after "·" is kept', () => {
    renderLayout(demoWithTimeLeft(269))
    const pill = screen.getByRole('button', { name: /demo session/i })
    // Split over two flex items the space at the end of the first one collapses ("Demo session ·4:29").
    expect(within(pill).getByText('Demo session · 4:29')).toBeInTheDocument()
  })

  // Below lg the pill shows the icon and m:ss only; its name starts with what it shows, so someone using speech control
  // can say "click 4:29" (WCAG 2.5.3, label in name).
  test.each([[390, 'a phone'], [1024, 'between md and lg']])('at %i px (%s) the pill is compact and its name starts with what it shows',
    (width) => {
      setViewport(width)
      renderLayout(demoWithTimeLeft(269))
      const pill = screen.getByRole('button', { name: '4:29 left in the demo session, signed out in 4 minutes 29 seconds' })
      expect(pill).toHaveTextContent(/^4:29$/)
      expect(pill.querySelector('svg')).not.toBeNull()
    })

  test('from lg (1200 px) the pill reads "Demo session · m:ss"', () => {
    setViewport(1200)
    renderLayout(demoWithTimeLeft(269))
    const pill = screen.getByRole('button', { name: 'Demo session, signed out in 4 minutes 29 seconds' })
    expect(pill).toHaveTextContent(/^Demo session · 4:29$/)
  })

  test("the compact pill's name also holds still while it has focus, and catches up when focus leaves", () => {
    setViewport(390)
    renderLayout(demoWithTimeLeft(269))
    const pill = screen.getByRole('button', { name: /left in the demo session/ })
    act(() => { pill.focus() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(pill).toHaveTextContent(/^4:26$/)
    expect(pill).toHaveAccessibleName('4:29 left in the demo session, signed out in 4 minutes 29 seconds')
    act(() => { pill.blur() })
    expect(pill).toHaveAccessibleName('4:26 left in the demo session, signed out in 4 minutes 26 seconds')
  })

  test("the pill's name holds still while it has focus, and catches up when focus leaves", () => {
    renderLayout(demoWithTimeLeft(269))
    const pill = screen.getByRole('button', { name: /demo session/i })
    act(() => { pill.focus() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(pill).toHaveTextContent('Demo session · 4:26')
    expect(pill).toHaveAccessibleName('Demo session, signed out in 4 minutes 29 seconds')
    act(() => { pill.blur() })
    expect(pill).toHaveAccessibleName('Demo session, signed out in 4 minutes 26 seconds')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(pill).toHaveAccessibleName('Demo session, signed out in 4 minutes 25 seconds')
  })

  test('the 1:00 live region is visually hidden, not as wide as the bar', () => {
    renderLayout(demoWithTimeLeft(90))
    const live = screen.getByRole('status')
    const style = getComputedStyle(live)
    expect(style.width).toBe('1px')
    expect(style.height).toBe('1px')
    expect(style.position).toBe('absolute')
  })

  test('the popover says how much time is left (the 1:00 announcement is muted while it is open)', async () => {
    renderLayout(demoWithTimeLeft(65))
    act(() => { screen.getByRole('button', { name: /demo session/i }).click() })
    const popover = await screen.findByRole('dialog', { name: /about the demo session/i })
    expect(popover).toHaveTextContent('Time left: 1:05')
    act(() => { vi.advanceTimersByTime(6000) })
    expect(popover).toHaveTextContent('Time left: 0:59')
  })

  test('the pill counts down and its name says the time left in words', () => {
    renderLayout(demoWithTimeLeft(269))
    const pill = screen.getByRole('button', { name: /demo session/i })
    expect(pill).toHaveTextContent('Demo session · 4:29')
    expect(pill).toHaveAccessibleName('Demo session, signed out in 4 minutes 29 seconds')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(pill).toHaveTextContent('Demo session · 4:28')
    expect(pill).toHaveAccessibleName('Demo session, signed out in 4 minutes 28 seconds')
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000) })
    expect(pill).toHaveTextContent('Demo session · 0:00')
  })

  test('the popover explains the demo', async () => {
    renderLayout(demoWithTimeLeft())
    act(() => { screen.getByRole('button', { name: /demo session/i }).click() })
    expect(await screen.findByText("Public demo admin. Some actions are disabled, and you'll be signed out when the "
      + 'timer ends.')).toBeInTheDocument()
  })

  test('the pill turns urgent under one minute', () => {
    renderLayout(demoWithTimeLeft(62))
    const pill = screen.getByRole('button', { name: /demo session/i })
    expect(pill).toHaveAttribute('data-urgent', 'false')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(pill).toHaveAttribute('data-urgent', 'true')
  })

  test('one polite announcement at 1:00, never each second', () => {
    renderLayout(demoWithTimeLeft(90, { timeouts: true }))
    const live = screen.getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toBeEmptyDOMElement()
    act(() => { vi.advanceTimersByTime(20_000) }) // 1:10 left, still above the line
    expect(live).toBeEmptyDOMElement()
    act(() => { vi.advanceTimersByTime(10_000) }) // 1:00
    expect(live).toHaveTextContent(/^1 minute left in the demo session$/)
    act(() => { vi.advanceTimersByTime(6000) }) // it empties itself after speaking
    expect(live).toBeEmptyDOMElement()
    // From here on any repeat would refill it.
    const changes = []
    const observer = new MutationObserver((records) => changes.push(...records))
    observer.observe(live, { childList: true, characterData: true, subtree: true })
    act(() => { vi.advanceTimersByTime(20_000) })
    observer.disconnect()
    expect(changes).toHaveLength(0)
    expect(live).toBeEmptyDOMElement()
  })

  test('the pill popover opens with Enter and closes with Escape, returning focus to the pill', async () => {
    const end = new Date(Date.now() + 200_000).toISOString()
    sessionStorage.setItem(`acme-scout:demo-welcomed:${end}`, '1')
    renderLayout({ ...users.demoAdmin, session_expires_at: end })
    const pill = screen.getByRole('button', { name: /demo session, signed out/i })
    pill.focus()
    await userEvent.keyboard('{Enter}')
    const popover = await screen.findByRole('dialog', { name: /about the demo session/i })
    expect(popover).toHaveTextContent('Public demo admin.')
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pill).toHaveFocus()
  })

  test('the announcement still comes, once, when a hidden tab wakes up below 1:00', () => {
    renderLayout(demoWithTimeLeft(120))
    const live = screen.getByRole('status')
    expect(live).toBeEmptyDOMElement()
    // The tab slept: the clock jumped 90 seconds before the next tick.
    act(() => { vi.setSystemTime(new Date(NOW.getTime() + 90_000)); vi.advanceTimersByTime(1000) })
    expect(live).toHaveTextContent(/^1 minute left in the demo session$/)
    expect(screen.getByRole('button', { name: /demo session/i })).toHaveAttribute('data-urgent', 'true')
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

  test('everyone else gets no dialog', () => {
    renderLayout(users.admin)
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

  test('the profile photo is locked when the menu opens from the sidebar chip too', async () => {
    sessionStorage.setItem(`acme-scout:demo-welcomed:${users.demoAdmin.id}`, '1')
    renderLayout(users.demoAdmin)
    const chip = within(screen.getByTestId('sidebar')).getByRole('button', { name: /, account menu$/ })
    await userEvent.click(chip)
    const photo = await screen.findByRole('menuitem', { name: /profile photo/i })
    expect(photo).toHaveAttribute('aria-disabled', 'true')
    expect(photo).toHaveTextContent(DISABLED)
  })
})

test('a demo-locked action shows its reason when reached with the keyboard', async () => {
  server.use(http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })))
  renderAsUser(<PeoplePage />, { user: users.demoAdmin, route: '/people', path: '/people' })
  const wrapper = (await screen.findByRole('button', { name: /new account/i })).parentElement
  for (let i = 0; i < 30 && document.activeElement !== wrapper; i += 1) await userEvent.tab()
  expect(wrapper).toHaveFocus()
  expect(await screen.findByRole('tooltip')).toHaveTextContent(DISABLED)
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
    expect(await screen.findByRole('button', { name: /edit project/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'More project actions' }))
    const item = screen.getByRole('menuitem', { name: 'Archive project' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(item.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(DISABLED)
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

describe('Demo access notices', () => {
  const PAGES = [
    ['People', PeoplePage, '/people', 'Demo access · Account creation and editing are unavailable in this session.'],
    ['Departments', DepartmentsPage, '/departments',
      'Demo access · Adding, renaming and archiving departments is disabled.'],
    ['Skills', SkillsPage, '/skills', 'Demo access · Adding, renaming and archiving skills is disabled.'],
    ['Archive', ArchivePage, '/archive', 'Demo access · Only milestone restoration is available in this session.'],
  ]
  function stubLists() {
    server.use(http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })),
      http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/skills`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/archive`, () => HttpResponse.json({ items: [] })))
  }

  // The notice: a tinted box with a timer icon, "Demo access" in bold, then the page's text.
  const notice = () => screen.queryByRole('note', { name: 'Demo access' })

  test.each(PAGES)('%s shows its notice to the demo admin and nobody else', async (title, Page, route, text) => {
    stubLists()
    const { unmount } = renderAsUser(<Page />, { user: users.demoAdmin, route, path: route })
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(notice().textContent).toBe(text)
    expect(within(notice()).getByText('Demo access').tagName).toBe('STRONG')
    expect(notice().querySelector('svg[data-testid="TimerOutlinedIcon"]')).not.toBeNull()
    unmount()
    renderAsUser(<Page />, { user: users.admin, route, path: route })
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(notice()).toBeNull()
  })

  test('the Archive notice can be hidden for the session, the others cannot', async () => {
    stubLists()
    const { unmount } = renderAsUser(<DepartmentsPage />, { user: users.demoAdmin, route: '/departments', path: '/departments' })
    expect(await screen.findByRole('note', { name: 'Demo access' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hide demo access notice/i })).not.toBeInTheDocument()
    unmount()
    const first = renderAsUser(<ArchivePage />, { user: users.demoAdmin, route: '/archive', path: '/archive' })
    await userEvent.click(await screen.findByRole('button', { name: /hide demo access notice/i }))
    expect(notice()).toBeNull()
    first.unmount()
    renderAsUser(<ArchivePage />, { user: users.demoAdmin, route: '/archive', path: '/archive' })
    expect(await screen.findByRole('heading', { name: 'Archive' })).toBeInTheDocument()
    expect(notice()).toBeNull()
  })

  test("hiding one page's notice leaves another page's dismissible notice alone", async () => {
    stubLists()
    const first = renderAsUser(<ArchivePage />, { user: users.demoAdmin, route: '/archive', path: '/archive' })
    await userEvent.click(await screen.findByRole('button', { name: /hide demo access notice/i }))
    first.unmount()
    renderAsUser(<DemoAccessNotice page="another-page" text="Demo access · Something else is limited." dismissible />,
      { user: users.demoAdmin })
    expect(notice()).toHaveTextContent('Demo access · Something else is limited.')
  })
})

describe('demo pill and notice colours', () => {
  // A see-through tint (dark mode) is seen laid over the surface under it; a solid one (light mode) as it is.
  const over = (tint, surface) => {
    const [r, g, b, a = 1] = tint.match(/[\d.]+/g).map(Number)
    const base = surface.replace('#', '').match(/../g).map((h) => parseInt(h, 16))
    return `rgb(${[r, g, b].map((c, i) => Math.round(c * a + base[i] * (1 - a))).join(', ')})`
  }
  test.each(['light', 'dark'])('%s: the pill and the notice text reach 4.5:1 on their tint', (mode) => {
    const theme = buildTheme(mode)
    const bar = theme.components.MuiAppBar.styleOverrides.root.backgroundColor
    for (const urgent of [false, true]) {
      const tone = demoTone(theme, { urgent })
      expect(getContrastRatio(tone.text, over(tone.fill, bar))).toBeGreaterThanOrEqual(4.5)
    }
    const tone = demoTone(theme)
    for (const surface of [theme.palette.background.default, theme.palette.background.paper]) {
      expect(getContrastRatio(tone.text, over(tone.fill, surface))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
