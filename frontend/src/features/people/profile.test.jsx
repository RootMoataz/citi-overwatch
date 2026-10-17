import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { bold } from '../../test/bold.js'
import { setViewport } from '../../test/setup.js'
import PersonProfilePage from './PersonProfilePage.jsx'

const manager = { id: 'u-mgr', name: 'Morgan Manager', first_name: 'Morgan', job_title: 'Delivery Manager',
  department: { id: 'd1', name: 'Technology' }, is_archived: false }
const apollo = { id: 'p1', name: 'Apollo Data Migration', status: 'active', is_archived: false }
const atlas = { id: 'p2', name: 'Atlas Customer Portal', status: 'active', is_archived: false }
const ms = (id, name, extra = {}) => ({ id, name, status: 'completed', display_status: 'completed', start_date: '2026-08-15',
  end_date: '2026-10-23', is_archived: false, role: 'primary', project: apollo, logged_hours: 0, approved_hours: 0, can_open: true,
  difficulty: 'medium', priority: 'high', ...extra })

const profile = ({ salary, id = 'u-emp', archived = false, role = 'employee', boss = manager } = {}) => ({
  user: { id, name: 'Eli Employee', first_name: 'Eli', last_name: 'Employee', job_title: 'Software Engineer', role,
    department: { id: 'd1', name: 'Technology' }, is_archived: false, manager: boss, ...(salary == null ? {} : { salary }) },
  this_week: { week_start: '2026-10-12', logged: 19.75, overtime: 0, planned: 30 },
  all_time: { logged: 174.25, approved: 169.25 },
  skills: [{ id: 's1', name: 'Backend Development' }],
  can_edit_skills: false,
  projects: [
    { id: 'p1', name: 'Apollo Data Migration', status: 'active', start_date: '2026-01-01', predicted_end_date: '2026-12-31',
      is_archived: false, planned_hours_per_week: 30, on_team: true, logged_hours: 34, approved_hours: 24, can_open: true },
    { id: 'p2', name: 'Atlas Customer Portal', status: 'completed', start_date: '2025-01-01', predicted_end_date: '2025-06-30',
      is_archived: false, planned_hours_per_week: 10, on_team: false, logged_hours: 6, approved_hours: 6, can_open: false },
    ...(archived ? [{ id: 'p8', name: 'Shelved', status: 'active', start_date: '2025-01-01', predicted_end_date: '2025-03-01',
      is_archived: true, planned_hours_per_week: 0, on_team: false, logged_hours: 4, approved_hours: 4, can_open: false }] : [])],
  milestones: [
    ms('m1', 'Hypercare', { status: 'not_started', display_status: 'not_started', start_date: '2026-12-13', end_date: '2026-12-27' }),
    ms('m2', 'Schema Mapping', { logged_hours: 135.25, approved_hours: 131.25 }),
    ms('m3', 'Build', { project: { ...atlas, status: 'completed' }, can_open: false, status: 'ready_for_review',
      display_status: 'ready_for_review', start_date: '2026-07-16', end_date: '2026-10-05', role: 'supporting' }),
    ms('m4', 'Discovery', { start_date: '2026-07-15', end_date: '2026-08-14', role: null }),
    ms('m5', 'Build: frontend'), ms('m6', 'Review'), ms('m7', 'Design', { project: atlas, can_open: false }),
    ...(archived ? [ms('m9', 'Old', { is_archived: true, role: null, project: { id: 'p8', name: 'Shelved', status: 'active',
      is_archived: true }, can_open: false, start_date: '2025-01-01', end_date: '2025-03-01', logged_hours: 4, approved_hours: 4 })] : [])],
})

const stub = (body, id) => server.use(
  http.get(`${API}/users/${id}/profile`, () => HttpResponse.json(body)),
  http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [{ id: 'u-mgr', name: 'Morgan Manager' }], can_group: false })))
const renderProfile = (viewer, body, { id = body.user.id, route } = {}) => {
  stub(body, id)
  return renderAsUser(<PersonProfilePage />, { user: viewer, route: route ?? `/people/${id}/profile`, path: '/people/:id/profile' })
}
const ownPage = () => renderProfile(users.employee, profile({ salary: 95000 }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => { vi.useRealTimers(); server.events.removeAllListeners() })

describe('My history: an employee on their own page', () => {
  test('the header, the profile card and Employment details', async () => {
    ownPage()
    expect(await screen.findByRole('heading', { name: 'My history', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Your work record, including completed milestones.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open my timesheet' })).toHaveAttribute('href', '/timesheet')
    expect(screen.getByRole('heading', { name: 'Eli Employee', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Software Engineer')).toBeInTheDocument()
    expect(screen.getByText('Employee · Technology')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your manager', level: 3 })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Message Morgan' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /Employment details/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls')
    expect(screen.getByText('Annual salary and other employment details')).toBeInTheDocument()
    expect(screen.queryByText('$95,000')).not.toBeInTheDocument()
    expect(screen.queryByText('Annual salary')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Annual salary')).toBeInTheDocument()
    expect(screen.getByText('$95,000')).toBeInTheDocument()
  })

  test('the week and all-time figures', async () => {
    ownPage()
    const week = await screen.findByRole('group', { name: 'Week of Oct 12, 2026' })
    expect(within(week).getByText('Logged this week').parentElement).toHaveTextContent('19.75hPending and approved')
    expect(within(week).getByText('Planned this week').parentElement).toHaveTextContent('30h')
    expect(within(week).getByText('Overtime this week').parentElement).toHaveTextContent('0hAbove 40h')
    const all = screen.getByRole('group', { name: 'All time summary' })
    expect(within(all).getByText('Total hours logged').parentElement).toHaveTextContent('174.25hAll time')
    expect(within(all).getByText('Total hours approved').parentElement).toHaveTextContent('169.25hAll time')
  })

  test('a week with overtime puts "Overtime this week" in bold; a week without stays regular', async () => {
    const { unmount } = ownPage()
    expect(bold(await screen.findByRole('group', { name: 'Week of Oct 12, 2026' }))).toEqual([])
    unmount()
    const over = profile({ salary: 95000 })
    renderProfile(users.employee, { ...over, this_week: { ...over.this_week, logged: 45, overtime: 5 } })
    expect(bold(await screen.findByRole('group', { name: 'Week of Oct 12, 2026' }))).toEqual(['Overtime this week'])
  })

  test('the tabs, and ?tab=projects', async () => {
    const { unmount } = ownPage()
    const milestones = await screen.findByRole('tab', { name: 'Milestones 7' })
    expect(milestones).toHaveAttribute('aria-selected', 'true')
    expect(milestones).toHaveAttribute('aria-controls')
    await userEvent.click(screen.getByRole('tab', { name: 'Projects 2' }))
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=projects')
    expect(screen.getByRole('tab', { name: 'Projects 2' })).toHaveAttribute('aria-selected', 'true')
    unmount()
    renderProfile(users.employee, profile({ salary: 95000 }), { route: '/people/u-emp/profile?tab=projects' })
    expect(await screen.findByRole('tab', { name: 'Projects 2' })).toHaveAttribute('aria-selected', 'true')
  })

  test('the milestones table, search and project filter', async () => {
    ownPage()
    const table = await screen.findByRole('table')
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['Milestone', 'Project', 'Status', 'Planned dates', 'Hours logged', 'Hours approved'])
    expect(within(table).getByText('Supporting')).toBeInTheDocument()
    expect(within(table).getByText('No longer assigned')).toBeInTheDocument()
    expect(within(table).getByText('Project completed')).toBeInTheDocument()
    // newest planned dates first
    expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent('Hypercare')
    const links = within(table).getAllByRole('link', { name: 'Apollo Data Migration' })
    expect(links[0]).toHaveAttribute('href', '/projects/p1?tab=milestones')
    expect(within(table).getAllByText('Atlas Customer Portal')[0]).not.toHaveAttribute('href')
    const search = screen.getByRole('textbox', { name: 'Search milestones' })
    expect(search).toHaveAttribute('placeholder', 'Search milestones…')
    await userEvent.type(search, 'Schema')
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(1)
    await userEvent.clear(search)
    await userEvent.click(screen.getByRole('combobox', { name: 'Project' }))
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('All projects')
    await userEvent.click(screen.getByRole('option', { name: 'Atlas Customer Portal' }))
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(2)
  })

  test('the projects table', async () => {
    renderProfile(users.employee, profile({ salary: 95000 }), { route: '/people/u-emp/profile?tab=projects' })
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Project', 'Status', 'Planned / week', 'Hours logged', 'Hours approved'])
    expect(within(table).getByText('Left the team')).toBeInTheDocument()
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Apollo Data Migration', 'Atlas Customer Portal'])
    expect(within(table).getByRole('link', { name: 'Apollo Data Migration' })).toHaveAttribute('href', '/projects/p1')
  })

  test('the read-only footer', async () => {
    ownPage()
    expect(await screen.findByText('Read-only history. Edit eligible hours in My timesheet.')).toBeInTheDocument()
    expect(screen.queryByText('ⓘ')).not.toBeInTheDocument()
  })

  test('privacy: no archived controls, and only their own id is requested', async () => {
    const urls = []
    server.events.on('request:start', ({ request }) => urls.push(new URL(request.url).pathname))
    ownPage()
    await screen.findByRole('heading', { name: 'My history', level: 1 })
    expect(screen.queryByText('Include archived')).not.toBeInTheDocument()
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
    expect(screen.queryByText('Project archived')).not.toBeInTheDocument()
    const userUrls = urls.filter((u) => /\/users\/[^/]+/.test(u))
    expect(userUrls.length).toBeGreaterThan(0)
    for (const u of userUrls) expect(u).toMatch(/\/users\/u-emp(\/|$)/)
  })

  test('the photo sits in the profile card, and Edit skills shows when allowed', async () => {
    server.use(
      http.get(`${API}/avatars`, () => HttpResponse.json({ items: { 'u-emp': '42' } })),
      http.get(`${API}/users/u-emp/avatar`, () => new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })))
    renderProfile(users.employee, { ...profile({ salary: 95000 }), can_edit_skills: true })
    await screen.findByRole('heading', { name: 'My history', level: 1 })
    await waitFor(() => expect(document.querySelector('.MuiAvatar-img')).toHaveAttribute('src', expect.stringMatching(/^blob:/)))
    expect(screen.getByRole('button', { name: 'Edit skills' })).toBeInTheDocument()
  })

  test('phones: the profile card comes first and the tables are cards', async () => {
    setViewport(375)
    ownPage()
    const name = await screen.findByRole('heading', { name: 'Eli Employee', level: 2 })
    const week = screen.getByRole('heading', { name: 'Week of Oct 12, 2026' })
    expect(name.compareDocumentPosition(week) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe("My history: someone else's page, or a manager's own", () => {
  test('an admin sees archived rows only after Include archived, with the salary behind Employment details', async () => {
    renderProfile(users.admin, profile({ salary: 90000, archived: true }))
    expect(await screen.findByRole('heading', { name: 'Eli Employee', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reports to', level: 3 })).toBeInTheDocument()
    expect(screen.queryByText('Read-only history. Edit eligible hours in My timesheet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open my timesheet' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Employment details/ })).toBeInTheDocument()
    const box = screen.getByRole('checkbox', { name: 'Include archived' })
    expect(box).not.toBeChecked()
    expect(screen.getByRole('tab', { name: 'Milestones 7' })).toBeInTheDocument()
    expect(screen.queryByText('Project archived')).not.toBeInTheDocument()
    await userEvent.click(box)
    expect(screen.getByRole('tab', { name: 'Milestones 8' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projects 3' })).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('Archived')).toBeInTheDocument()
    expect(within(table).getByText('Project archived')).toBeInTheDocument()
  })

  test('a manager viewing an employee sees no Employment details', async () => {
    renderProfile(users.manager, profile())
    await screen.findByRole('heading', { name: 'Eli Employee', level: 1 })
    expect(screen.queryByText(/Employment details/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  test("a manager's own page keeps the name as the title and offers Include archived", async () => {
    renderProfile(users.manager, profile({ id: 'u-mgr', role: 'manager', boss: null, archived: true }))
    expect(await screen.findByRole('heading', { name: 'Eli Employee', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My history' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Include archived' })).toBeInTheDocument()
    expect(screen.getByText('Read-only history. Edit eligible hours in My timesheet.')).toBeInTheDocument()
  })

  test('an employee never gets Include archived, even from a payload with archived rows', async () => {
    renderProfile(users.employee, profile({ salary: 95000, archived: true }))
    await screen.findByRole('heading', { name: 'My history', level: 1 })
    expect(screen.queryByText('Include archived')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Milestones 7' })).toBeInTheDocument()
  })

  test('shows the department the person is in', async () => {
    renderProfile(users.admin, profile())
    await screen.findByRole('heading', { name: 'Eli Employee', level: 1 })
    expect(screen.getByText('Employee · Technology')).toBeInTheDocument()
  })
})

// Moves the page to another profile in the same mounted route, as a link would.
function Go() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/people/u-a/profile')}>Go to A</button>
      <button type="button" onClick={() => navigate('/people/u-b/profile')}>Go to B</button>
    </>
  )
}

describe('My history: final review fixes', () => {
  test("Sunday evening in New York (UTC already Monday) shows the week of Oct 12 and asks for it by its Monday", async () => {
    vi.setSystemTime(new Date('2026-10-19T02:00:00Z'))
    const weeks = []
    server.use(http.get(`${API}/users/u-emp/profile`, ({ request }) => {
      const week = new URL(request.url).searchParams.get('week')
      weeks.push(week)
      // Without ?week= the server answers with its own (UTC) week, which is already Oct 19.
      return HttpResponse.json({ ...profile({ salary: 95000 }), this_week: { week_start: week ?? '2026-10-19', logged: 0, overtime: 0, planned: 30 } })
    }))
    renderAsUser(<PersonProfilePage />, { user: users.employee, route: '/people/u-emp/profile', path: '/people/:id/profile' })
    expect(await screen.findByRole('heading', { name: 'Week of Oct 12, 2026' })).toBeInTheDocument()
    expect(weeks).toEqual(['2026-10-12'])
  })

  test('Employment details and the tab filters start fresh on each profile, a cached one included', async () => {
    const a = profile({ id: 'u-a', salary: 90000 })
    const b = { ...profile({ id: 'u-b', salary: 70000 }), user: { ...profile({ id: 'u-b', salary: 70000 }).user, name: 'Bea Builder' } }
    stub(a, 'u-a')
    stub(b, 'u-b')
    renderAsUser(<><PersonProfilePage /><Go /></>, { user: users.admin, route: '/people/u-b/profile', path: '/people/:id/profile' })
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Bea Builder', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Go to A' }))
    await screen.findByRole('heading', { name: 'Eli Employee', level: 1 })
    await user.click(screen.getByRole('button', { name: /Employment details/ }))
    expect(screen.getByText('$90,000')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search milestones' }), 'Schema')
    // B is cached: it shows at once, with its own state.
    await user.click(screen.getByRole('button', { name: 'Go to B' }))
    expect(await screen.findByRole('heading', { name: 'Bea Builder', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Employment details/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('$70,000')).not.toBeInTheDocument()
    expect(screen.queryByText('$90,000')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search milestones' })).toHaveValue('')
  })

  test('Include archived sits above both tabs: on Projects it shows and brings the archived project in', async () => {
    renderProfile(users.admin, profile({ salary: 90000, archived: true }), { route: '/people/u-emp/profile?tab=projects' })
    const box = await screen.findByRole('checkbox', { name: 'Include archived' })
    expect(screen.getByRole('tab', { name: 'Projects 2' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(box)
    expect(screen.getByRole('tab', { name: 'Projects 3' })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Projects' })).getByText('Archived')).toBeInTheDocument()
    // The same box still counts for Milestones.
    await userEvent.click(screen.getByRole('tab', { name: 'Milestones 8' }))
    expect(screen.getByRole('checkbox', { name: 'Include archived' })).toBeChecked()
  })

  test("on someone else's page an archived manager is still named under Reports to, with no way to message them", async () => {
    renderProfile(users.admin, profile({ boss: { ...manager, is_archived: true } }))
    const reports = await screen.findByRole('region', { name: 'Reports to' })
    expect(within(reports).getByText('Morgan Manager')).toBeInTheDocument()
    expect(within(reports).getByText('Archived')).toBeInTheDocument()
    expect(within(reports).queryByRole('link', { name: /Message/ })).not.toBeInTheDocument()
  })

  test('on their own page an archived manager has no Your manager card', async () => {
    renderProfile(users.employee, profile({ salary: 95000, boss: { ...manager, is_archived: true } }))
    await screen.findByRole('heading', { name: 'My history', level: 1 })
    expect(screen.queryByRole('region', { name: 'Your manager' })).not.toBeInTheDocument()
  })

  test('the history card is a region named by its H2, Work history', async () => {
    ownPage()
    const card = await screen.findByRole('region', { name: 'Work history' })
    expect(within(card).getByRole('heading', { level: 2, name: 'Work history' })).toBeInTheDocument()
    expect(within(card).getByRole('tab', { name: 'Milestones 7' })).toBeInTheDocument()
  })

  test('the history card sits in the right column under All time summary, beside the profile card', async () => {
    ownPage()
    const card = await screen.findByRole('region', { name: 'Work history' })
    const column = screen.getByRole('group', { name: 'All time summary' }).parentElement
    expect(column).toContainElement(card)
    expect(column).not.toContainElement(screen.getByRole('region', { name: 'Your manager' }))
    // Its long headers may take two lines (and its cells pad 8 px), so the six columns fit that column.
    const table = within(card).getByRole('table', { name: 'Milestones' })
    for (const name of [/^Planned dates/, /^Hours logged/, /^Hours approved/]) {
      expect(within(table).getByRole('columnheader', { name })).toHaveStyle({ whiteSpace: 'normal' })
    }
    // The read-only note closes the column, under the card.
    expect(card.compareDocumentPosition(within(column).getByText('Read-only history. Edit eligible hours in My timesheet.'))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('a salary of null reads as a dash once Employment details is opened, never $0', async () => {
    const body = profile({ salary: 1 })
    body.user.salary = null
    renderProfile(users.employee, body)
    await userEvent.click(await screen.findByRole('button', { name: /Employment details/ }))
    expect(screen.getByText('Annual salary')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })
})
