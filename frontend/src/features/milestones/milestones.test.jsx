import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, delay, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import { projectView } from '../projects/viewer.js'
import MilestonesTab from './MilestonesTab.jsx'

// "Today" is Thursday 15 Oct 2026 in New York; only Date is faked, because faking every timer makes userEvent hang.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const project = {
  id: 'p1', name: 'Apollo', start_date: '2026-07-15', predicted_end_date: '2026-12-27', status: 'active',
  manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [],
}
const eli = { id: users.employee.id, name: 'Eli Employee' }
const chloe = { id: 'u-chloe', name: 'Chloe Park' }
const gia = { id: 'u-gia', name: 'Gia Rossi' }
const ben = { id: 'u-ben', name: 'Ben Osei' }
const ana = { id: 'u-ana', name: 'Ana Reyes' }

const ms = (overrides) => ({
  project_id: 'p1', description: '', status: 'not_started', display_status: 'not_started', blocked: false,
  predecessors: [], assignees: [], supporting_ids: [], is_assignee: false, completed_at: null, is_archived: false,
  difficulty: 'medium', priority: 'medium', estimated_hours: null, logged_hours: 0, open_kickback: null,
  progress_percent: null, objective: '', completion_criteria: '', required_skills: [], claimable: false, can_claim: false,
  can_post_update: false, can_kick_back: false, can_resolve_kickback: false,
  ...overrides,
})

const kickback = {
  id: 'k1', category: 'unclear_requirement', category_label: 'Unclear requirement',
  reason: 'The acceptance script is missing.', raised_at: '2026-10-12T10:00:00Z', raised_by: eli,
  resolution: null, resolution_note: null, resolved_at: null, resolved_by: null,
}

// The mockup's seven milestones, in the API's dependency order.
const apollo = [
  ms({ id: 'm1', name: 'Discovery', status: 'completed', display_status: 'completed', start_date: '2026-07-15',
    end_date: '2026-08-14', estimated_hours: 114, assignees: [eli, chloe] }),
  ms({ id: 'm2', name: 'Build: frontend', description: 'Deliver the screens people use, built against the agreed designs.',
    status: 'completed', display_status: 'completed', start_date: '2026-08-15', end_date: '2026-10-23', estimated_hours: 264,
    logged_hours: 118, predecessors: ['m1'], assignees: [eli, gia], is_assignee: true }),
  ms({ id: 'm3', name: 'Schema Mapping', status: 'completed', display_status: 'completed', start_date: '2026-08-15',
    end_date: '2026-10-23', estimated_hours: 383, logged_hours: 295.25, predecessors: ['m1'], assignees: [eli, ben, ana, gia] }),
  ms({ id: 'm4', name: 'Solution architecture', status: 'completed', display_status: 'completed', start_date: '2026-08-15',
    end_date: '2026-09-05', estimated_hours: 100, logged_hours: 100.5, predecessors: ['m1'], assignees: [ben, ana] }),
  ms({ id: 'm5', name: 'Cutover', start_date: '2026-10-24', end_date: '2026-12-12', logged_hours: 12, predecessors: ['m3'] }),
  ms({ id: 'm6', name: 'QA & user acceptance testing', status: 'blocked', display_status: 'blocked', start_date: '2026-09-20',
    end_date: '2026-10-10', predecessors: ['m2', 'm3'], assignees: [eli], is_assignee: true, open_kickback: kickback }),
  ms({ id: 'm7', name: 'Hypercare', display_status: 'waiting', blocked: true, start_date: '2026-12-13', end_date: '2026-12-27',
    estimated_hours: 44, predecessors: ['m5'], assignees: [ben] }),
]

const entry = (id, milestone, hours) => ({ entry: { id, hours, work_date: '2026-10-12' }, user: gia,
  milestone: { id: milestone, name: milestone }, project: { id: 'p1', name: 'Apollo' } })
// Two entries (16h) on Build: frontend, six (46h) on Schema Mapping: 8 entries, 62h.
const pending = [entry('e1', 'm2', 8), entry('e2', 'm2', 8), entry('e3', 'm3', 10), entry('e4', 'm3', 10),
  entry('e5', 'm3', 10), entry('e6', 'm3', 8), entry('e7', 'm3', 4), entry('e8', 'm3', 4)]

const profile = { projects: [{ id: 'p1', logged_hours: 38, approved_hours: 34, planned_hours_per_week: 10, on_team: true }],
  milestones: [{ id: 'm2', logged_hours: 24 }, { id: 'm6', logged_hours: 14 }] }

let asked
function handlers(list = apollo, extra = [], { approvals = pending } = {}) {
  asked = { approvals: [], profile: 0 }
  return [
    ...extra,
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json(list)),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([eli, chloe, gia, ben, ana].map((p) => {
      const [first, last] = p.name.split(' ')
      return { user: { id: p.id, first_name: first, last_name: last, job_title: 'Engineer', username: first.toLowerCase() },
        planned_hours_per_week: 30 }
    }))),
    http.get(`${API}/milestones/:id/notes`, () => HttpResponse.json([])),
    http.get(`${API}/approvals`, ({ request }) => {
      asked.approvals.push(new URL(request.url).search)
      return HttpResponse.json(new URL(request.url).searchParams.get('milestone') ? [] : approvals)
    }),
    http.get(`${API}/users/:id/profile`, () => { asked.profile += 1; return HttpResponse.json(profile) }),
    http.get(`${API}/skills`, () => HttpResponse.json({ items: [] })),
  ]
}

function renderTab(user, { route = '/m', p = project } = {}) {
  const view = projectView(user, p)
  return renderAsUser(<MilestonesTab project={p} manage={view.manage} user={user} view={view} />, { user, route })
}

// The table once its rows are in (while loading it holds skeleton rows).
async function table() {
  const t = await screen.findByRole('table', { name: 'Milestones' })
  await waitFor(() => expect(t.closest('[aria-busy="true"]')).toBeNull())
  return t
}
const row = (name) => screen.getByRole('button', { name }).closest('tr')
const cells = (name) => within(row(name)).getAllByRole('cell')
const bodyRows = (t) => within(t).getAllByRole('row').slice(1)
const names = (t) => bodyRows(t).map((r) => within(r).getAllByRole('cell')[1].querySelector('button').textContent)
const headers = (t) => within(t).getAllByRole('columnheader').map((h) => h.textContent.replace('ⓘ', '').trim())
const location = () => screen.getByTestId('location')
const panel = (name) => screen.findByRole('complementary', { name })

describe('Milestones tab: summary', () => {
  test('counts the completed milestones above the status bar, as the card heading', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const summary = await screen.findByRole('region', { name: '4 of 7 milestones complete' })
    expect(within(summary).getByRole('heading', { level: 2, name: '4 of 7 milestones complete' })).toBeInTheDocument()
    expect(within(summary).getByRole('img', { name: 'Completed: 4 milestones' })).toBeInTheDocument()
    expect(within(summary).getByRole('list', { name: 'Milestones by state' })).toBeInTheDocument()
  })

  test("a manager sees the pending entries and hours, linking to the project's timesheets; hidden at 0", async () => {
    server.use(...handlers())
    const first = renderTab(users.manager)
    const link = await screen.findByRole('link', { name: '8 pending entries · 62h' })
    expect(link).toHaveAttribute('href', '/timesheets?project=p1')
    expect(asked.approvals).toEqual(['?project=p1'])
    first.unmount()
    server.use(...handlers(apollo, [], { approvals: [] }))
    renderTab(users.manager)
    await screen.findByRole('region', { name: '4 of 7 milestones complete' })
    await waitFor(() => expect(asked.approvals).toHaveLength(1))
    expect(screen.queryByRole('link', { name: /pending entr/ })).not.toBeInTheDocument()
  })

  test('an employee sees their part and never asks for approvals', async () => {
    server.use(...handlers())
    renderTab(users.employee)
    expect(await screen.findByText('Your part: 2 of 7 milestones · 38h logged')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /pending entr/ })).not.toBeInTheDocument()
    expect(asked.approvals).toEqual([])
  })

  test('an executive gets neither the pending entries nor a part, and asks for neither', async () => {
    server.use(...handlers())
    renderTab(users.executive)
    await screen.findByRole('region', { name: '4 of 7 milestones complete' })
    expect(screen.queryByText(/Your part/)).not.toBeInTheDocument()
    expect(asked.approvals).toEqual([])
    expect(asked.profile).toBe(0)
  })
})

describe('Milestones tab: columns', () => {
  test('# is the dependency order; the Milestone cell names its dependencies', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const t = await table()
    expect(headers(t)).toEqual(['#', 'Milestone', 'Status', 'Assignees', 'Planned dates', 'Effort (logged / estimate)',
      'Approvals', 'More'])
    expect(bodyRows(t).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(names(t)).toEqual(apollo.map((m) => m.name))
    expect(cells('Discovery')[1]).toHaveTextContent('Dependency: None')
    expect(cells('Build: frontend')[1]).toHaveTextContent('Dependency: after Discovery')
    expect(cells('QA & user acceptance testing')[1]).toHaveTextContent('Dependency: after Build: frontend, Schema Mapping')
  })

  test('your own milestones carry a "You" tag', async () => {
    server.use(...handlers())
    renderTab(users.employee)
    await table()
    expect(within(cells('Build: frontend')[1]).getByText('You')).toBeInTheDocument()
    expect(within(cells('Discovery')[1]).queryByText('You')).not.toBeInTheDocument()
  })

  test('Status shows the state chip, plus "Kicked back" while a kickback is open', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    expect(cells('Discovery')[2]).toHaveTextContent('Completed')
    expect(cells('Hypercare')[2]).toHaveTextContent('Waiting on dependencies')
    expect(within(cells('QA & user acceptance testing')[2]).getByText('Blocked – needs review')).toBeInTheDocument()
    expect(within(cells('QA & user acceptance testing')[2]).getByText('Kicked back')).toBeInTheDocument()
    expect(within(cells('Discovery')[2]).queryByText('Kicked back')).not.toBeInTheDocument()
  })

  test('Assignees: up to three avatars, "+N" and first names; "Unassigned" when nobody', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    const group = within(cells('Schema Mapping')[3]).getByRole('group', { name: 'People on Schema Mapping' })
    expect(within(group).getAllByRole('img').map((el) => el.getAttribute('aria-label')).reverse())
      .toEqual(['Eli Employee · Primary', 'Ben Osei · Primary', 'Ana Reyes · Primary'])
    expect(within(cells('Schema Mapping')[3]).getByRole('img', { name: '1 more: Gia Rossi' })).toHaveTextContent('+1')
    expect(cells('Schema Mapping')[3]).toHaveTextContent('Eli, Ben, Ana, Gia')
    expect(cells('Cutover')[3]).toHaveTextContent('Unassigned')
    expect(within(cells('Cutover')[3]).queryByRole('group')).not.toBeInTheDocument()
  })

  test('Planned dates read in full; an unfinished milestone past its end says "Overdue"', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    expect(cells('Build: frontend')[4]).toHaveTextContent('Aug 15, 2026 – Oct 23, 2026')
    expect(cells('Build: frontend')[4]).not.toHaveTextContent('Overdue')
    expect(cells('QA & user acceptance testing')[4]).toHaveTextContent('Sep 20, 2026 – Oct 10, 2026Overdue')
    expect(cells('Discovery')[4]).not.toHaveTextContent('Overdue')   // ended, but completed
  })

  test("overdue uses New York's date: late on the 15th there, a milestone ending the 15th isn't overdue yet", async () => {
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z'))   // 22:00 on Oct 15 in New York, already the 16th in UTC
    server.use(...handlers([
      ms({ id: 'a', name: 'Ends today', status: 'in_progress', display_status: 'in_progress', start_date: '2026-10-01', end_date: '2026-10-15' }),
      ms({ id: 'b', name: 'Ended yesterday', status: 'in_progress', display_status: 'in_progress', start_date: '2026-10-01', end_date: '2026-10-14' }),
    ]))
    renderTab(users.manager)
    await table()
    expect(cells('Ends today')[4]).not.toHaveTextContent('Overdue')
    expect(cells('Ended yesterday')[4]).toHaveTextContent('Overdue')
  })

  test('Effort shows logged / estimate in every form, with what is over the estimate', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const t = await table()
    expect(within(t).getByRole('img', { name: 'Logged counts pending and approved hours of everyone on the milestone.' }))
      .toBeInTheDocument()
    expect(cells('Build: frontend')[5]).toHaveTextContent(/^118h \/ 264h$/)
    expect(cells('Schema Mapping')[5]).toHaveTextContent(/^295.25h \/ 383h$/)
    expect(cells('Discovery')[5]).toHaveTextContent(/^114h estimate$/)
    expect(cells('Cutover')[5]).toHaveTextContent(/^12h logged$/)
    expect(cells('QA & user acceptance testing')[5]).toHaveTextContent(/^—$/)
    expect(cells('Solution architecture')[5]).toHaveTextContent(/^100.5h \/ 100h\+0.5h over estimate$/)
  })

  test('Approvals counts pending entries per milestone for a manager, "—" at 0', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    expect(await within(cells('Build: frontend')[6]).findByText('2 pending')).toBeInTheDocument()
    expect(cells('Schema Mapping')[6]).toHaveTextContent('6 pending')
    expect(cells('Discovery')[6]).toHaveTextContent(/^—$/)
  })

  test('an employee gets "Your hours" instead of Approvals', async () => {
    server.use(...handlers())
    renderTab(users.employee)
    const t = await table()
    expect(headers(t)).toEqual(['#', 'Milestone', 'Status', 'Assignees', 'Planned dates', 'Effort (logged / estimate)',
      'Your hours', 'More'])
    expect(await within(cells('Build: frontend')[6]).findByText('24h')).toBeInTheDocument()
    expect(cells('Discovery')[6]).toHaveTextContent(/^—$/)
  })

  test('More holds a hidden chevron, and the "⋯" only for managers', async () => {
    server.use(...handlers())
    const first = renderTab(users.manager)
    await table()
    const more = cells('Build: frontend')[7]
    expect(within(more).getByTestId('ChevronRightIcon')).toHaveAttribute('aria-hidden', 'true')
    expect(within(more).getByRole('button', { name: 'More actions for Build: frontend' })).toBeInTheDocument()
    // The name is the row's one keyboard target besides the menu.
    expect(within(row('Build: frontend')).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent))
      .toEqual(['Build: frontend', 'More actions for Build: frontend'])
    first.unmount()
    renderTab(users.employee)
    await table()
    expect(within(cells('Build: frontend')[7]).getByTestId('ChevronRightIcon')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument()
  })

  test('the footer counts the rows and explains effort', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    expect(screen.getByText('7 milestones · Select a row to view details, discussion and history.')).toBeInTheDocument()
    expect(screen.getByText('Effort shows logged / estimated hours. Status does not imply hours are approved.')).toBeInTheDocument()
  })
})

describe('Milestones tab: toolbar', () => {
  test('the search matches the name and the description', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const t = await table()
    const user = userEvent.setup()
    const search = screen.getByRole('textbox', { name: 'Search milestones' })
    expect(search).toHaveAttribute('placeholder', 'Search milestones…')
    await user.type(search, 'agreed designs')
    expect(names(t)).toEqual(['Build: frontend'])
    await user.clear(search)
    await user.type(search, 'CUTOVER')
    expect(names(t)).toEqual(['Cutover'])
    expect(cells('Cutover')[0]).toHaveTextContent('5')   // # stays the dependency position
    expect(screen.getByText('1 milestone · Select a row to view details, discussion and history.')).toBeInTheDocument()
  })

  test('the Status filter keeps one display status', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const t = await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Not started', 'In progress',
      'Ready for review', 'Completed', 'Waiting', 'Blocked'])
    await user.click(screen.getByRole('option', { name: 'Waiting' }))
    expect(names(t)).toEqual(['Hypercare'])
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'Completed' }))
    expect(names(t)).toEqual(['Discovery', 'Build: frontend', 'Schema Mapping', 'Solution architecture'])
  })

  test('"Timeline" sets ?view=timeline and is remembered after a remount without it', async () => {
    server.use(...handlers())
    const first = renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(location()).toHaveTextContent('/m?view=timeline')
    expect(await screen.findByRole('list', { name: 'Milestone timeline' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Milestones' })).not.toBeInTheDocument()
    first.unmount()
    renderTab(users.manager, { route: '/m' })
    expect(await screen.findByRole('list', { name: 'Milestone timeline' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(await table()).toBeInTheDocument()
    expect(location()).toHaveTextContent(/^\/m$/)
  })

  test('the URL wins over the remembered view', async () => {
    localStorage.setItem('overwatch.milestones.view', 'list')
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?view=timeline' })
    expect(await screen.findByRole('list', { name: 'Milestone timeline' })).toBeInTheDocument()
  })

  test('the Timeline has its heading, range, footer and the detailed layout on a wide screen', async () => {
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?view=timeline' })
    expect(await screen.findByRole('heading', { level: 2, name: 'Planned schedule' })).toBeInTheDocument()
    expect(screen.getByText('Jul 15 – Dec 27, 2026 · Bars show planned dates, colours show current status.')).toBeInTheDocument()
    expect(screen.getByText('Select a milestone to inspect dependencies, approvals and history.')).toBeInTheDocument()
    expect(await screen.findByText('Dependency')).toBeInTheDocument()
    expect(screen.getAllByText('After Discovery').length).toBeGreaterThan(0)
  })

  test('"Add milestone" opens the dialog, for managers only', async () => {
    server.use(...handlers())
    const first = renderTab(users.manager)
    await table()
    await userEvent.click(screen.getByRole('button', { name: 'Add milestone' }))
    expect(await screen.findByRole('dialog', { name: 'New milestone' })).toBeInTheDocument()
    first.unmount()
    const second = renderTab(users.employee)
    await table()
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument()
    second.unmount()
    renderTab(users.executive)
    await table()
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument()
  })

  test('the search and the Status filter apply to the Timeline too', async () => {
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?view=timeline' })
    const timeline = await screen.findByRole('list', { name: 'Milestone timeline' })
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Search milestones' }), 'schema')
    expect(within(timeline).getAllByRole('listitem').map((li) => li.getAttribute('aria-label').split(',')[0]))
      .toEqual(['Schema Mapping'])
    await user.clear(screen.getByRole('textbox', { name: 'Search milestones' }))
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'Blocked' }))
    expect(within(timeline).getAllByRole('listitem').map((li) => li.getAttribute('aria-label').split(',')[0]))
      .toEqual(['QA & user acceptance testing'])
  })
})

describe('Milestones tab: sorting', () => {
  test('Milestone by name, Status in the status bar order, Planned dates by start', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const t = await table()
    const user = userEvent.setup()
    await user.click(within(t).getByRole('button', { name: 'Milestone' }))
    expect(names(t)).toEqual(['Build: frontend', 'Cutover', 'Discovery', 'Hypercare', 'QA & user acceptance testing',
      'Schema Mapping', 'Solution architecture'])
    await user.click(within(t).getByRole('button', { name: 'Status' }))
    expect(names(t)).toEqual(['Discovery', 'Build: frontend', 'Schema Mapping', 'Solution architecture', 'Cutover',
      'Hypercare', 'QA & user acceptance testing'])
    await user.click(within(t).getByRole('button', { name: 'Planned dates' }))
    expect(names(t)).toEqual(['Discovery', 'Build: frontend', 'Schema Mapping', 'Solution architecture',
      'QA & user acceptance testing', 'Cutover', 'Hypercare'])
  })
})

describe('Milestones tab: opening a milestone', () => {
  test('a row click opens the panel; the list narrows to #, Milestone and Status', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const t = await table()
    const user = userEvent.setup()
    await user.click(within(row('Build: frontend')).getByText('Aug 15, 2026 – Oct 23, 2026'))
    expect(location()).toHaveTextContent('/m?milestone=m2')
    const side = await panel('Build: frontend')
    expect(within(side).getByRole('heading', { level: 2, name: 'Build: frontend' })).toHaveFocus()
    expect(headers(t)).toEqual(['#', 'Milestone', 'Status'])
    expect(row('Build: frontend')).toHaveAttribute('aria-current', 'true')
    // Narrow, the Status cell carries the pending chip.
    expect(within(cells('Build: frontend')[2]).getByText('2 pending')).toBeInTheDocument()
  })

  test('Enter on the name button opens it', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Discovery' }).focus()
    await user.keyboard('{Enter}')
    expect(location()).toHaveTextContent('/m?milestone=m1')
    expect(await panel('Discovery')).toBeInTheDocument()
  })

  test('the deep link ?milestone=m2 opens the panel on load', async () => {
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?milestone=m2' })
    expect(await panel('Build: frontend')).toBeInTheDocument()
  })

  test('Esc closes it, the URL drops it, and focus returns to the row\'s name button', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Build: frontend' }))
    await panel('Build: frontend')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    expect(location()).toHaveTextContent(/^\/m$/)
    expect(screen.getByRole('button', { name: 'Build: frontend' })).toHaveFocus()
  })

  test('Back closes the panel: opening pushes one history entry, closing replaces it', async () => {
    function Back() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate(-1)}>Back</button>
    }
    server.use(...handlers())
    const view = projectView(users.manager, project)
    renderAsUser(<><MilestonesTab project={project} manage={view.manage} user={users.manager} view={view} /><Back /></>,
      { user: users.manager, route: '/m' })
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Build: frontend' }))
    await panel('Build: frontend')
    await user.click(screen.getByRole('button', { name: 'Build: frontend' }))   // the open row again adds no entry
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    expect(location()).toHaveTextContent(/^\/m$/)
    await user.click(screen.getByRole('button', { name: 'Discovery' }))
    await panel('Discovery')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Back' }))   // closing replaced the entry: Back doesn't reopen it
    expect(location()).toHaveTextContent(/^\/m$/)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  test('closing a panel whose row is filtered out puts focus on the search field', async () => {
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?milestone=m3' })
    await panel('Schema Mapping')
    const user = userEvent.setup()
    const search = screen.getByRole('textbox', { name: 'Search milestones' })
    await user.type(search, 'cutover')
    expect(screen.queryByRole('button', { name: 'Schema Mapping' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    expect(search).toHaveFocus()
  })

  test('a milestone that is gone once the list has loaded closes the panel with a toast', async () => {
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?milestone=gone&panel=notes' })
    expect(await screen.findByText('That milestone is no longer available.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toHaveTextContent(/^\/m$/))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  test('a link to a milestone newer than the cached list asks the server again before calling it gone', async () => {
    function Go() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/m?milestone=m9')}>Go</button>
    }
    const golive = ms({ id: 'm9', name: 'Go-live', start_date: '2026-12-01', end_date: '2026-12-20' })
    server.use(...handlers())
    const view = projectView(users.manager, project)
    renderAsUser(<><MilestonesTab project={project} manage={view.manage} user={users.manager} view={view} /><Go /></>,
      { user: users.manager, route: '/m' })
    await table()   // the cache now holds the list without m9, and is fresh enough not to refetch by itself
    server.use(http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([...apollo, golive])))
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(await panel('Go-live')).toBeInTheDocument()
    expect(location()).toHaveTextContent('/m?milestone=m9')
    expect(screen.queryByText('That milestone is no longer available.')).not.toBeInTheDocument()
  })

  test('clicking a timeline row opens its panel', async () => {
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?view=timeline' })
    const timeline = await screen.findByRole('list', { name: 'Milestone timeline' })
    await userEvent.click(within(timeline).getByRole('listitem', { name: /^Cutover,/ }))
    expect(location()).toHaveTextContent('/m?view=timeline&milestone=m5')
    expect(await panel('Cutover')).toBeInTheDocument()
  })
})

describe('Milestones tab: the panel header', () => {
  test('the name, its state, the description and the three facts', async () => {
    server.use(...handlers())
    renderTab(users.manager, { route: '/m?milestone=m2' })
    const side = await panel('Build: frontend')
    expect(within(side).getAllByText('Completed')).toHaveLength(2)  // its state, and Discovery's under Dependencies
    expect(within(side).getByText('Deliver the screens people use, built against the agreed designs.')).toBeInTheDocument()
    expect(within(side).getByText('Aug 15, 2026 – Oct 23, 2026 · After Discovery')).toBeInTheDocument()
    expect(within(side).getByRole('group', { name: 'People on Build: frontend' })).toBeInTheDocument()
    expect(within(side).getByText('118h logged / 264h estimated')).toBeInTheDocument()
    expect(within(side).queryByText(/You:/)).not.toBeInTheDocument()
  })

  test('an assignee also sees their own hours on it', async () => {
    server.use(...handlers())
    renderTab(users.employee, { route: '/m?milestone=m2' })
    const side = await panel('Build: frontend')
    expect(await within(side).findByText('118h logged / 264h estimated · You: 24h')).toBeInTheDocument()
  })

  test('"Edit" and "⋯" are for managers only', async () => {
    server.use(...handlers())
    const first = renderTab(users.manager, { route: '/m?milestone=m2' })
    let side = await panel('Build: frontend')
    expect(within(side).getByRole('button', { name: 'More actions for Build: frontend' })).toBeInTheDocument()
    await userEvent.click(within(side).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit milestone' })
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /^name/i })).toHaveFocus())
    first.unmount()
    for (const viewer of [users.employee, users.executive]) {
      const { unmount } = renderTab(viewer, { route: '/m?milestone=m2' })
      side = await panel('Build: frontend')
      expect(within(side).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      expect(within(side).queryByRole('button', { name: /^More actions/ })).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('Milestones tab: the "⋯" menu', () => {
  const menuItems = () => screen.getAllByRole('menuitem').map((i) => i.textContent)

  test("a manager's menu: the edits, the status moves statusActions allows, discussion and archive", async () => {
    const review = apollo.map((m) => (m.id === 'm3' ? { ...m, status: 'ready_for_review', display_status: 'ready_for_review' } : m))
    server.use(...handlers(review))
    renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Build: frontend' }))
    expect(menuItems()).toEqual(['Edit details', 'Assign people', 'Dependencies', 'Reopen', 'Open discussion', 'Archive milestone'])
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'More actions for Schema Mapping' }))
    expect(menuItems()).toEqual(['Edit details', 'Assign people', 'Dependencies', 'Complete', 'Send back', 'Open discussion',
      'Archive milestone'])
  })

  test('"Assign people" and "Dependencies" open the dialog on their field', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Build: frontend' }))
    await user.click(screen.getByRole('menuitem', { name: 'Assign people' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit milestone' })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /assigned to/i })).toHaveFocus())
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'More actions for Build: frontend' }))
    await user.click(screen.getByRole('menuitem', { name: 'Dependencies' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit milestone' })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /depends on/i })).toHaveFocus())
  })

  test('"Open discussion" opens the panel on its Discussion tab', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Build: frontend' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open discussion' }))
    expect(location()).toHaveTextContent('/m?milestone=m2&panel=discussion')
    expect(await panel('Build: frontend')).toBeInTheDocument()
  })

  test('"Archive milestone" asks first, then archives it', async () => {
    let archived = null
    server.use(...handlers(apollo, [http.delete(`${API}/milestones/:id`, ({ params }) => {
      archived = params.id
      return new HttpResponse(null, { status: 204 })
    })]))
    renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Discovery' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive milestone' }))
    const confirm = await screen.findByRole('dialog', { name: 'Archive this milestone?' })
    expect(archived).toBeNull()
    await user.click(within(confirm).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(archived).toBe('m1'))
  })
})

describe('Milestones tab: archiving', () => {
  const archiveFrom = async (scope, name) => {
    const user = userEvent.setup()
    await user.click(within(scope).getByRole('button', { name: `More actions for ${name}` }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive milestone' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Archive this milestone?' })).getByRole('button', { name: 'Archive' }))
  }

  test('a failed archive keeps the row and says why', async () => {
    server.use(...handlers(apollo, [http.delete(`${API}/milestones/:id`, () => HttpResponse.json(
      { error: { code: 'CONFLICT', message: 'Discovery has hours waiting for approval' } }, { status: 409 }))]))
    renderTab(users.manager)
    await table()
    await archiveFrom(row('Discovery'), 'Discovery')
    expect(await screen.findByText('Discovery has hours waiting for approval')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Archive this milestone?' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Discovery' })).toBeInTheDocument()
  })

  test('archiving the open milestone closes its panel without "no longer available", and focus goes to the search', async () => {
    let gone = false
    server.use(...handlers(apollo, [
      http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json(gone ? apollo.filter((m) => m.id !== 'm2') : apollo)),
      http.delete(`${API}/milestones/:id`, () => { gone = true; return new HttpResponse(null, { status: 204 }) }),
    ]))
    renderTab(users.manager, { route: '/m?milestone=m2' })
    await archiveFrom(await panel('Build: frontend'), 'Build: frontend')
    expect(await screen.findByText('Milestone archived')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    await waitFor(() => expect(location()).toHaveTextContent(/^\/m$/))
    expect(screen.queryByText('That milestone is no longer available.')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search milestones' })).toHaveFocus()
  })
})

describe('Milestones tab: states', () => {
  test('skeleton rows while the list loads', async () => {
    server.use(...handlers(apollo, [http.get(`${API}/projects/p1/milestones`, async () => { await delay('infinite') })]))
    renderTab(users.manager)
    const t = await screen.findByRole('table', { name: 'Milestones' })
    expect(t.closest('[aria-busy="true"]')).not.toBeNull()
    expect(bodyRows(t)).toHaveLength(5)
  })

  test('without milestones: "Add milestone" for a manager, a note for everyone else', async () => {
    server.use(...handlers([]))
    const first = renderTab(users.manager)
    expect(await screen.findByText('No milestones yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add milestone' })).toHaveLength(1)
    first.unmount()
    renderTab(users.employee)
    expect(await screen.findByText('No milestones yet')).toBeInTheDocument()
    expect(screen.getByText("Your manager hasn't planned any milestones yet.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument()
  })

  test('no match: "No milestones match" with "Clear"', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await table()
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Search milestones' }), 'nothing like this')
    expect(screen.getByText('No milestones match')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(names(await table())).toHaveLength(7)
    expect(screen.getByRole('textbox', { name: 'Search milestones' })).toHaveValue('')
  })
})

describe('Milestones tab: phones', () => {
  test('at 375 px a manager\'s card has its "⋯" beside it, and picking an item doesn\'t open the panel', async () => {
    setViewport(375)
    server.use(...handlers())
    const first = renderTab(users.manager)
    const cards = within(await screen.findByRole('list', { name: 'Milestones' })).getAllByRole('listitem')
    const user = userEvent.setup()
    await user.click(within(cards[1]).getByRole('button', { name: 'More actions for Build: frontend' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }))
    expect(await screen.findByRole('dialog', { name: 'Edit milestone' })).toBeInTheDocument()
    expect(location()).toHaveTextContent(/^\/m$/)
    first.unmount()
    renderTab(users.employee)
    const list = await screen.findByRole('list', { name: 'Milestones' })
    expect(within(list).queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument()
  })

  test('at 375 px the rows are cards and the panel is a full-screen dialog', async () => {
    setViewport(375)
    server.use(...handlers())
    renderTab(users.manager)
    const list = await screen.findByRole('list', { name: 'Milestones' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(7)
    expect(items[1]).toHaveTextContent('Build: frontend')
    await userEvent.click(within(items[1]).getByRole('button', { name: /^2\. Build: frontend/ }))
    expect(location()).toHaveTextContent('/m?milestone=m2')
    const dialog = await screen.findByRole('dialog', { name: 'Build: frontend' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('118h logged / 264h estimated')).toBeInTheDocument()
    // A narrow header: Edit is an icon and the state chip opens the body, so the title keeps its room.
    expect(within(dialog).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'More actions for Build: frontend' })).toBeInTheDocument()
    expect(within(dialog).getAllByText('Completed')).toHaveLength(2)
  })
})

// ---- Kept from the card layout: each intent now lives in the row, the panel or the dialog. ----
const legacy = {
  ...project, start_date: '2026-01-01', predicted_end_date: '2026-12-31',
}
const me = eli
const discovery = ms({ id: 'm1', name: 'Discovery', start_date: '2026-01-05', end_date: '2026-02-28', status: 'in_progress',
  display_status: 'in_progress', assignees: [me], is_assignee: true })
const mapping = ms({ id: 'm2', name: 'Schema Mapping', start_date: '2026-03-01', end_date: '2026-06-30',
  display_status: 'waiting', blocked: true, predecessors: ['m1'], assignees: [me], is_assignee: true })
const cutover = ms({ id: 'm3', name: 'Cutover', start_date: '2026-07-01', end_date: '2026-09-30', difficulty: 'hard',
  priority: 'critical' })
const trio = [discovery, mapping, cutover]
const renderLegacy = (user, route = '/m', p = legacy) => renderTab(user, { route, p })

describe('Milestones tab: kept behaviour', () => {
  test('an employee sees every milestone but gets actions only on their own', async () => {
    server.use(...handlers(trio))
    renderLegacy(users.employee, '/m?milestone=m1')
    const disc = await panel('Discovery')
    expect(within(disc).getByRole('button', { name: /ready for review/i })).toBeEnabled()
    expect(within(disc).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cutover' }))
    const cut = await panel('Cutover')
    expect(within(cut).queryByRole('button', { name: /^start$|ready for review|^complete$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument()
  })

  test('a waiting milestone: Start is disabled, its tooltip names what it waits on', async () => {
    server.use(...handlers(trio))
    renderLegacy(users.employee, '/m?milestone=m2')
    const map = await panel('Schema Mapping')
    expect(within(map).getAllByText('Waiting on dependencies').length).toBeGreaterThan(0)
    const start = within(map).getByRole('button', { name: /start/i })
    expect(start).toBeDisabled()
    await userEvent.hover(start.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Waiting on: Discovery')
  })

  test('the assignee marks ready for review in the panel; the manager completes from the "⋯"', async () => {
    const calls = []
    server.use(...handlers(trio, [
      http.post(`${API}/milestones/:id/status`, async ({ params, request }) => {
        calls.push([params.id, (await request.json()).status])
        return HttpResponse.json({ ...discovery, status: 'ready_for_review', display_status: 'ready_for_review' })
      })]))
    const first = renderLegacy(users.employee, '/m?milestone=m1')
    await userEvent.click(within(await panel('Discovery')).getByRole('button', { name: /ready for review/i }))
    await waitFor(() => expect(calls).toEqual([['m1', 'ready_for_review']]))
    first.unmount()

    const review = { ...discovery, status: 'ready_for_review', display_status: 'ready_for_review', is_assignee: false }
    server.use(...handlers([review, mapping, cutover], [
      http.post(`${API}/milestones/:id/status`, async ({ params, request }) => {
        calls.push([params.id, (await request.json()).status])
        return HttpResponse.json({ ...review, status: 'completed', display_status: 'completed' })
      })]))
    renderLegacy(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Discovery' }))
    expect(screen.getByRole('menuitem', { name: 'Send back' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Complete' }))
    await waitFor(() => expect(calls.at(-1)).toEqual(['m1', 'completed']))
  })

  test('a dependency loop is explained in the dialog', async () => {
    server.use(...handlers(trio, [
      http.put(`${API}/milestones/m1`, async ({ request }) => HttpResponse.json({ ...discovery, ...(await request.json()) })),
      http.put(`${API}/milestones/m1/dependencies`, () => HttpResponse.json(
        { error: { code: 'DEPENDENCY_CYCLE', message: 'That dependency would create a loop' } }, { status: 400 })),
    ]))
    renderLegacy(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Discovery' }))
    await user.click(screen.getByRole('menuitem', { name: 'Dependencies' }))
    const dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    await user.click(within(dialog).getByRole('combobox', { name: /depends on/i }))
    await user.click(await screen.findByRole('option', { name: /^Schema Mapping/ }))
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    expect(await within(dialog).findByText('That dependency would create a loop.')).toBeInTheDocument()
  })

  test('a date range outside the project is explained', async () => {
    server.use(...handlers([], [
      http.post(`${API}/projects/p1/milestones`, () => HttpResponse.json(
        { error: { code: 'OUT_OF_PROJECT_RANGE', message: 'Milestone dates must fall between 2026-01-01 and 2026-12-31' } },
        { status: 400 }))]))
    renderLegacy(users.manager)
    const user = userEvent.setup()
    expect(await screen.findByText('No milestones yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add milestone' }))
    const dialog = await screen.findByRole('dialog', { name: /new milestone/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Late')
    await user.type(within(dialog).getByLabelText(/start date/i), '2027-01-01')
    await user.type(within(dialog).getByLabelText(/end date/i), '2027-02-01')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('must fall between')
  })

  test('the timeline has a bar per milestone with accessible labels', async () => {
    server.use(...handlers(trio))
    renderLegacy(users.employee, '/m?view=timeline')
    const timeline = await screen.findByRole('list', { name: /milestone timeline/i })
    const bars = within(timeline).getAllByRole('listitem')
    expect(bars).toHaveLength(3)
    expect(bars[1]).toHaveAccessibleName(/Schema Mapping, Mar 1, 2026 to Jun 30, 2026, Waiting on dependencies/)
    expect(bars[1]).toHaveAttribute('tabindex', '0')
  })

  test('the summary and its state bar sit above the list and above the timeline', async () => {
    server.use(...handlers(trio))
    const first = renderLegacy(users.employee)
    let bar = await screen.findByRole('region', { name: '0 of 3 milestones complete' })
    expect(bar.compareDocumentPosition(await table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    first.unmount()
    renderLegacy(users.employee, '/m?view=timeline')
    bar = await screen.findByRole('region', { name: '0 of 3 milestones complete' })
    const timeline = await screen.findByRole('list', { name: /milestone timeline/i })
    expect(bar.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('the notes thread shows authors and lets assignees post', async () => {
    let posted = null
    server.use(...handlers([discovery], [
      http.get(`${API}/milestones/m1/notes`, () => HttpResponse.json([
        { id: 'n1', body: 'Inventory done', created_at: '2026-10-13T10:00:00Z', author: { id: 'u-mgr', name: 'Morgan Manager' } }])),
      http.post(`${API}/milestones/m1/notes`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ id: 'n2', body: posted.body, created_at: '2026-10-13T11:00:00Z', author: me }, { status: 201 })
      })]))
    renderLegacy(users.employee, '/m?milestone=m1')
    const user = userEvent.setup()
    await user.click(within(await panel('Discovery')).getByRole('tab', { name: 'Notes' }))
    expect(await screen.findByText('Inventory done')).toBeInTheDocument()
    expect(screen.getByText('Morgan Manager')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/add a progress note/i), 'Mapped 40 tables')
    await user.click(screen.getByRole('button', { name: /add a note/i }))
    await waitFor(() => expect(posted).toEqual({ body: 'Mapped 40 tables' }))
  })

  test('auto-routed support shows a Supporting chip next to the name in the panel', async () => {
    const ada = { id: 'u-ada', name: 'Ada Lovelace' }
    server.use(...handlers([{ ...cutover, assignees: [ada, me], supporting_ids: [me.id] }]))
    renderLegacy(users.manager, '/m?milestone=m3')
    const cut = await panel('Cutover')
    expect(within(cut).getByText('Supporting')).toBeInTheDocument()
    expect(within(cut).getByLabelText('Eli Employee is supporting')).toBeInTheDocument()
    expect(within(cut).queryByLabelText('Ada Lovelace is supporting')).not.toBeInTheDocument()
  })

  test("a row's avatar group puts primaries first, with the role in each tooltip label", async () => {
    const ada = { id: 'u-ada', name: 'Ada Lovelace' }
    server.use(...handlers([{ ...cutover, assignees: [me, ada], supporting_ids: [me.id] }]))
    renderLegacy(users.manager)
    await table()
    const group = within(cells('Cutover')[3]).getByRole('group', { name: 'People on Cutover' })
    // MUI's AvatarGroup reverses the DOM and lays it out row-reverse, so on screen the first person is leftmost.
    expect(within(group).getAllByRole('img').map((el) => el.getAttribute('aria-label')).reverse())
      .toEqual(['Ada Lovelace · Primary', 'Eli Employee · Supporting'])
    expect(cells('Cutover')[3]).toHaveTextContent('Ada, Eli')
  })

  test('the people fact lists the names in order, apart from the dates fact', async () => {
    const ada = { id: 'u-ada', name: 'Ada Lovelace' }
    server.use(...handlers([{ ...cutover, assignees: [me, ada], supporting_ids: [me.id] }, discovery]))
    renderLegacy(users.manager, '/m?milestone=m3')
    const cut = await panel('Cutover')
    expect(within(cut).getByText(/^Jul 1, 2026 – Sep 30, 2026/)).not.toHaveTextContent(/Ada|Eli/)
    const people = within(cut).getByRole('group', { name: 'People on Cutover' }).parentElement
    expect(people).toHaveTextContent(/Ada Lovelace, Eli Employee\s*Supporting/)
  })

  test("the project's manager opens each assignee's profile from the panel; a teammate only their own", async () => {
    const ada = { id: 'u-ada', name: 'Ada Lovelace' }
    server.use(...handlers([{ ...cutover, assignees: [me, ada] }]))
    const { unmount } = renderLegacy(users.manager, '/m?milestone=m3')
    const cut = await panel('Cutover')
    expect(within(cut).getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
    expect(within(cut).getByRole('link', { name: 'Eli Employee' })).toHaveAttribute('href', `/people/${me.id}/profile`)
    unmount()
    renderLegacy(users.employee, '/m?milestone=m3')
    const mine = await panel('Cutover')
    expect(within(mine).queryByRole('link', { name: 'Ada Lovelace' })).not.toBeInTheDocument()
    expect(within(mine).getByRole('link', { name: 'Eli Employee' })).toBeInTheDocument()
  })

  test('a milestone with nobody on it reads "Unassigned" in the row and the panel; an assigned one never does', async () => {
    server.use(...handlers([cutover, discovery]))
    renderLegacy(users.manager)
    await table()
    expect(cells('Cutover')[3]).toHaveTextContent(/^Unassigned$/)
    expect(cells('Discovery')[3]).not.toHaveTextContent('Unassigned')
    await userEvent.click(screen.getByRole('button', { name: 'Cutover' }))
    const cut = await panel('Cutover')
    expect(within(cut).getByText('Unassigned')).toBeInTheDocument()
    expect(within(cut).queryByRole('group', { name: 'People on Cutover' })).not.toBeInTheDocument()
  })

  test('the panel shows the priority before the difficulty, and the timeline says the priority too', async () => {
    server.use(...handlers(trio))
    const first = renderLegacy(users.employee, '/m?milestone=m3')
    const cut = await panel('Cutover')
    const priority = within(cut).getByLabelText('Priority: Critical')
    expect(priority).toHaveTextContent('Critical')
    expect(priority.compareDocumentPosition(within(cut).getByLabelText('Difficulty: Hard')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Discovery' }))
    const disc = await panel('Discovery')
    expect(within(disc).getByLabelText('Priority: Medium')).toHaveTextContent('Medium')
    expect(within(disc).getByLabelText('Difficulty: Medium')).toHaveTextContent('Medium')
    first.unmount()
    renderLegacy(users.employee, '/m?view=timeline')
    const timeline = await screen.findByRole('list', { name: 'Milestone timeline' })
    expect(within(timeline).getByRole('listitem', { name: /^Cutover, .*, Critical priority$/ })).toBeInTheDocument()
  })

  test('a manager picks a difficulty when adding a milestone, Medium by default', async () => {
    let created = null
    server.use(...handlers([], [
      http.post(`${API}/projects/p1/milestones`, async ({ request }) => {
        created = await request.json()
        return HttpResponse.json({ ...cutover, id: 'm9', ...created }, { status: 201 })
      }),
      http.put(`${API}/milestones/m9/dependencies`, () => HttpResponse.json({ ...cutover, warnings: [] })),
      http.put(`${API}/milestones/m9/assignees`, () => HttpResponse.json(cutover))]))
    renderLegacy(users.manager)
    const user = userEvent.setup()
    expect(await screen.findByText('No milestones yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    const dialog = await screen.findByRole('dialog', { name: /new milestone/i })
    const difficulty = within(dialog).getByRole('combobox', { name: /difficulty/i })
    expect(difficulty).toHaveTextContent('Medium')
    expect(within(dialog).getByText(/weighted by difficulty/i)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^name/i), 'Launch')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-10-01')
    await user.type(within(dialog).getByLabelText(/end date/i), '2026-10-31')
    await user.click(difficulty)
    await user.click(await screen.findByRole('option', { name: 'Hard' }))
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(created).toMatchObject({ name: 'Launch', difficulty: 'hard' }))
  })

  test('editing from the panel sends the difficulty only when it changed', async () => {
    const sent = []
    server.use(...handlers(trio, [
      http.put(`${API}/milestones/m1`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ ...discovery, ...sent.at(-1) })
      })]))
    renderLegacy(users.manager, '/m?milestone=m1')
    const user = userEvent.setup()
    await user.click(within(await panel('Discovery')).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    await user.click(within(dialog).getByRole('combobox', { name: /difficulty/i }))
    await user.click(await screen.findByRole('option', { name: 'Easy' }))
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(sent).toEqual([{ difficulty: 'easy' }]))
  })

  test('a manager picks a priority next to difficulty, Medium by default', async () => {
    let created = null
    server.use(...handlers([], [
      http.post(`${API}/projects/p1/milestones`, async ({ request }) => {
        created = await request.json()
        return HttpResponse.json({ ...cutover, id: 'm9', ...created }, { status: 201 })
      }),
      http.put(`${API}/milestones/m9/dependencies`, () => HttpResponse.json({ ...cutover, warnings: [] })),
      http.put(`${API}/milestones/m9/assignees`, () => HttpResponse.json(cutover))]))
    renderLegacy(users.manager)
    const user = userEvent.setup()
    expect(await screen.findByText('No milestones yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    const dialog = await screen.findByRole('dialog', { name: /new milestone/i })
    const priority = within(dialog).getByRole('combobox', { name: /priority/i })
    expect(priority).toHaveTextContent('Medium')
    expect(within(dialog).getByText('How urgent this is. Separate from difficulty, which weights progress.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^name/i), 'Launch')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-10-01')
    await user.type(within(dialog).getByLabelText(/end date/i), '2026-10-31')
    await user.click(priority)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Low', 'Medium', 'High', 'Critical'])
    await user.click(screen.getByRole('option', { name: 'Critical' }))
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(created).toMatchObject({ name: 'Launch', priority: 'critical', difficulty: 'medium' }))
  })

  test('"Edit details" sends the priority only when it changed', async () => {
    const sent = []
    server.use(...handlers(trio, [
      http.put(`${API}/milestones/m1`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ ...discovery, ...sent.at(-1) })
      })]))
    renderLegacy(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Discovery' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }))
    const dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /^name/i })).toHaveFocus())
    await user.click(within(dialog).getByRole('combobox', { name: /priority/i }))
    await user.click(await screen.findByRole('option', { name: 'High' }))
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(sent).toEqual([{ priority: 'high' }]))
  })

  test('the estimate shows as effort in the row, and as a time frame and usage in words in the panel', async () => {
    server.use(...handlers([
      { ...discovery, estimated_hours: 120, duration_days: 55, working_days: 40, logged_hours: 86, estimate_used_pct: 71.7 },
      { ...mapping, estimated_hours: 100, duration_days: 122, working_days: 88, logged_hours: 130, estimate_used_pct: 130 },
      { ...cutover, estimated_hours: null, duration_days: 92, working_days: 66, logged_hours: 0, estimate_used_pct: null }]))
    renderLegacy(users.manager, '/m?milestone=m1')
    const disc = await panel('Discovery')
    expect(within(disc).getByText(/Est\. 120h · 55 days \(40 working days\)/)).toBeInTheDocument()
    expect(within(disc).getByText('86h logged · 72% of estimate')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    expect(cells('Discovery')[5]).toHaveTextContent(/^86h \/ 120h$/)
    expect(cells('Schema Mapping')[5]).toHaveTextContent(/^130h \/ 100h\+30h over estimate$/)
    expect(cells('Cutover')[5]).toHaveTextContent(/^—$/)
    await userEvent.click(screen.getByRole('button', { name: 'Schema Mapping' }))
    expect(within(await panel('Schema Mapping')).getByText('130h logged · 130% of estimate · over estimate')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cutover' }))
    const cut = await panel('Cutover')
    expect(within(cut).getByText('92 days (66 working days)')).toBeInTheDocument()
    // Nothing logged: no usage line, only the hours fact.
    expect(within(cut).getAllByText(/logged/).map((el) => el.textContent)).toEqual(['0h logged'])
  })

  test('the manager sets, checks and clears the estimated effort', async () => {
    const sent = []
    server.use(...handlers([{ ...discovery, estimated_hours: 80 }, mapping, cutover], [
      http.put(`${API}/milestones/m1`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ ...discovery, ...sent.at(-1) })
      })]))
    renderLegacy(users.manager, '/m?milestone=m1')
    const user = userEvent.setup()
    await user.click(within(await panel('Discovery')).getByRole('button', { name: 'Edit' }))
    let dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    const field = within(dialog).getByLabelText(/estimated effort/i)
    expect(field).toHaveValue(80)
    expect(within(dialog).getByText('Total person-hours expected')).toBeInTheDocument()
    await user.clear(field)
    await user.type(field, '12.25')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    expect(await within(dialog).findByText(/one decimal at most/i)).toBeInTheDocument()
    await user.clear(field)
    await user.type(field, '120.5')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(sent).toEqual([{ estimated_hours: 120.5 }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(within(await panel('Discovery')).getByRole('button', { name: 'Edit' }))
    dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    await user.clear(within(dialog).getByLabelText(/estimated effort/i))
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ estimated_hours: null }))
  }, 20000)

  test('in a pull project, team members claim ready milestones and see what pull mode means', async () => {
    let claimed = null
    const open = { ...cutover, claimable: true, can_claim: true }
    server.use(...handlers([discovery, mapping, open], [
      http.post(`${API}/milestones/m3/claim`, () => { claimed = 'm3'; return HttpResponse.json({ ...open, assignees: [me], is_assignee: true }) })]))
    renderLegacy(users.employee, '/m?milestone=m1', { ...legacy, work_mode: 'pull' })
    const user = userEvent.setup()
    expect(await screen.findByText(/this project works in pull mode/i)).toBeInTheDocument()
    expect(within(await panel('Discovery')).queryByRole('button', { name: /claim/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cutover' }))
    await user.click(within(await panel('Cutover')).getByRole('button', { name: /claim cutover/i }))
    await waitFor(() => expect(claimed).toBe('m3'))
    expect(await screen.findByText("You're on Cutover")).toBeInTheDocument()
  })

  test('a claim someone else won first explains why', async () => {
    const open = { ...cutover, claimable: true, can_claim: true }
    server.use(...handlers([open], [http.post(`${API}/milestones/m3/claim`, () => HttpResponse.json({ error: {
      code: 'ALREADY_CLAIMED', message: 'Someone is already on this milestone', request_id: 'r-1' } }, { status: 409 }))]))
    renderLegacy(users.employee, '/m?milestone=m3', { ...legacy, work_mode: 'pull' })
    const user = userEvent.setup()
    await user.click(within(await panel('Cutover')).getByRole('button', { name: /claim cutover/i }))
    expect(await within(await panel('Cutover')).findByText('Someone is already on this milestone')).toBeInTheDocument()
  })

  test('push projects have no claim buttons or pull explanation', async () => {
    server.use(...handlers([{ ...cutover, claimable: false, can_claim: false }]))
    renderLegacy(users.employee, '/m?milestone=m3')
    await panel('Cutover')
    expect(screen.queryByRole('button', { name: /claim/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/pull mode/i)).not.toBeInTheDocument()
  })

  test('a dependency that starts too early warns under the summary', async () => {
    server.use(...handlers(trio, [
      http.put(`${API}/milestones/m3/dependencies`, () => HttpResponse.json({ ...cutover, warnings: ['STARTS_BEFORE_PREDECESSOR_ENDS'] })),
    ]))
    renderLegacy(users.manager)
    await table()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More actions for Cutover' }))
    await user.click(screen.getByRole('menuitem', { name: 'Dependencies' }))
    const dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    await user.click(within(dialog).getByRole('combobox', { name: /depends on/i }))
    await user.click(await screen.findByRole('option', { name: /^Schema Mapping/ }))
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    const alert = await screen.findByText('Cutover starts before one of the milestones it depends on ends.')
    const summary = screen.getByRole('region', { name: '0 of 3 milestones complete' })
    expect(summary.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
