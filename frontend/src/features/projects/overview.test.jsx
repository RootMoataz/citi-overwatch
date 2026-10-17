import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { bold } from '../../test/bold.js'
import { setViewport } from '../../test/setup.js'
import ProjectDetailPage from './ProjectDetailPage.jsx'

// Thursday 15 Oct 2026, noon in New York. Only Date is faked: faking every timer makes userEvent hang.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  server.events.removeAllListeners()
  setViewport(1280)
})

const project = (o = {}) => ({
  id: 'p1', name: 'Apollo Data Migration', description: 'Move records', status: 'active', work_mode: 'push',
  start_date: '2026-07-15', predicted_end_date: '2026-12-27', budget: 250000, consumed: 21745, budget_pct: 8.7, progress_pct: 53.8,
  at_risk_reasons: [], is_archived: false, completed_at: null, total_estimated_hours: 640, duration_days: 165, working_days: 120,
  estimate_used_pct: 52, manager: { id: users.manager.id, name: 'Morgan Manager' }, ...o,
})
const ms = (id, name, o = {}) => ({
  id, name, project_id: 'p1', start_date: '2026-07-15', end_date: '2026-08-15', status: 'completed', display_status: 'completed',
  priority: 'medium', predecessors: [], progress_percent: null, assignees: [], supporting_ids: [], is_assignee: false,
  logged_hours: 0, estimated_hours: null, working_days: null, completed_at: '2026-08-14T10:00:00Z', is_archived: false, ...o,
})
const ada = { id: 'u-ada', name: 'Ada Lovelace' }
const eli = { id: users.employee.id, name: 'Eli Employee' }
const milestones = [
  ms('m1', 'Discovery'), ms('m2', 'Mapping'), ms('m3', 'Design', { is_assignee: true, assignees: [eli] }),
  ms('m4', 'Build'),
  ms('m5', 'Rework', { start_date: '2026-09-01', end_date: '2026-10-10', status: 'blocked', display_status: 'blocked', assignees: [ada] }),
  ms('m6', 'Testing', { start_date: '2026-09-15', end_date: '2026-10-12', status: 'in_progress', display_status: 'in_progress',
    assignees: [{ id: 'u-bo', name: 'Bo Peep' }, ada], supporting_ids: ['u-bo'] }),
  ms('m7', 'Go-live', { start_date: '2026-10-24', end_date: '2026-12-12', status: 'not_started', display_status: 'not_started',
    is_assignee: true, assignees: [eli] }),
]
const approvalItem = (id, hours) => ({ entry: { id, hours, status: 'pending', project_id: 'p1' }, user: ada, milestone: { id: 'm6', name: 'Testing' },
  project: { id: 'p1', name: 'Apollo Data Migration' }, flags: [] })

function handlers({ p = project(), list = milestones, summary = {}, pending = [], summaryFail = false } = {}) {
  return [
    http.get(`${API}/projects/${p.id}`, () => HttpResponse.json(p)),
    http.get(`${API}/projects/${p.id}/summary`, () => (summaryFail
      ? HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'Summary unavailable' } }, { status: 500 })
      : HttpResponse.json({ project: p, budget: p.budget, consumed: p.consumed, remaining: p.budget - p.consumed, forecast: 61293,
        budget_pct: p.budget_pct, progress_pct: p.progress_pct, at_risk_reasons: p.at_risk_reasons, member_count: 5, ...summary }))),
    http.get(`${API}/projects/${p.id}/milestones`, () => HttpResponse.json(list)),
    http.get(`${API}/projects/${p.id}/members`, () => HttpResponse.json([
      { user: { id: users.employee.id, first_name: 'Eli', last_name: 'Employee' }, planned_hours_per_week: 10 },
      ...['u-ada', 'u-bo', 'u-cy', 'u-di'].map((id) => ({ user: { id, first_name: id, last_name: 'X' }, planned_hours_per_week: 10 }))])),
    http.get(`${API}/approvals`, () => HttpResponse.json(pending)),
    http.get(`${API}/allocations`, () => HttpResponse.json([
      { user: ada, planned_total: 20, logged_total: 34, projects: [{ id: 'p1', name: 'Apollo', planned: 20, logged: 34, approved: 20 }] },
      { user: { id: 'u-bo', name: 'Bo Peep' }, planned_total: 10, logged_total: 5, projects: [{ id: 'p1', name: 'Apollo', planned: 10, logged: 5, approved: 5 }] }])),
    http.get(`${API}/users/${users.employee.id}/profile`, () => HttpResponse.json({ projects: [
      { id: 'p1', logged_hours: 38, approved_hours: 34, planned_hours_per_week: 10, on_team: true }], milestones: [] })),
    http.get(`${API}/time-entries`, () => HttpResponse.json({ rows: [], entries: [], totals: { logged: 0, approved: 0 } })),
  ]
}

const open = (user = users.manager, route = '/projects/p1') =>
  renderAsUser(<ProjectDetailPage />, { user, route, path: '/projects/:id' })
const requests = () => {
  const seen = []
  server.events.on('request:start', ({ request }) => seen.push(new URL(request.url).pathname.replace(API, '')))
  return seen
}
const location = () => screen.getByTestId('location')

describe('Overview KPI strip', () => {
  test('shows the four figures with their hints', async () => {
    server.use(...handlers())
    open()
    const strip = await screen.findByRole('group', { name: 'Project figures' })
    await within(strip).findByText('$21,745 / $250,000')
    expect(within(strip).getByText('53.8%')).toBeInTheDocument()
    expect(within(strip).getByText('Weighted milestone completion')).toBeInTheDocument()
    expect(within(strip).getByText('8.7% of budget used')).toBeInTheDocument()
    expect(within(strip).getByText('$61,293')).toBeInTheDocument()
    expect(within(strip).getByText('Based on last 4 weeks')).toBeInTheDocument()
    expect(within(strip).queryByText('⚠ Over budget')).not.toBeInTheDocument()
    expect(within(strip).getByText('Dec 27, 2026')).toBeInTheDocument()
    expect(within(strip).getByText('73 days remaining')).toBeInTheDocument()
  })

  test('a forecast above the budget says so', async () => {
    server.use(...handlers({ summary: { forecast: 261000 } }))
    open()
    expect(await screen.findByText('⚠ Over budget')).toBeInTheDocument()
  })

  test('a past end date is overdue and a completed project says when', async () => {
    server.use(...handlers({ p: project({ predicted_end_date: '2026-10-10' }) }))
    const { unmount } = open()
    expect(await screen.findByText('5 days overdue')).toBeInTheDocument()
    unmount()
    server.use(...handlers({ p: project({ status: 'completed', completed_at: '2026-12-01T10:00:00Z' }) }))
    open()
    expect(await screen.findByText('Completed Dec 1, 2026')).toBeInTheDocument()
  })

  test('a summary error shows Retry in the strip; progress and the rest of the page still show', async () => {
    server.use(...handlers({ summaryFail: true }))
    open()
    const strip = await screen.findByRole('group', { name: 'Project figures' })
    expect(await within(strip).findByRole('alert')).toHaveTextContent('Summary unavailable')
    expect(within(strip).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(within(strip).getByText('53.8%')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Milestone schedule' })).toBeInTheDocument()
  })

  test('progress is weighted by difficulty', async () => {
    server.use(...handlers({ p: project({ progress_pct: 33.3 }) }))
    open()
    const strip = await screen.findByRole('group', { name: 'Project figures' })
    expect(await within(strip).findByText('33.3%')).toBeInTheDocument()
    expect(within(strip).getByText('Weighted milestone completion')).toBeInTheDocument()
  })
})

describe('Overview schedule and next milestones', () => {
  test('counts the completed milestones, and View milestones opens the timeline view', async () => {
    server.use(...handlers())
    open()
    const user = userEvent.setup()
    expect(await screen.findByText('4 of 7 milestones complete')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'View milestones →' }))
    expect(location()).toHaveTextContent('/projects/p1?tab=milestones&view=timeline')
  })

  test('a timeline row opens that milestone', async () => {
    server.use(...handlers())
    open()
    const user = userEvent.setup()
    const timeline = await screen.findByRole('list', { name: 'Milestone timeline' })
    await user.click(within(timeline).getByRole('listitem', { name: /^Go-live,/ }))
    expect(location()).toHaveTextContent('/projects/p1?tab=milestones&milestone=m7')
  })

  test('while planning, the schedule is replaced by a pointer to the Plan tab', async () => {
    server.use(...handlers({ p: project({ status: 'planned', plan_finalized_at: null }) }))
    open(users.manager, '/projects/p1?tab=overview')
    const link = await screen.findByRole('link', { name: 'Open the Plan tab.' })
    expect(link.parentElement).toHaveTextContent('This project is being planned. Open the Plan tab.')
    expect(screen.queryByRole('list', { name: 'Milestone timeline' })).not.toBeInTheDocument()
  })

  test('next milestones: the next 3 unfinished by start date, with state, dates and owner; a row opens its panel', async () => {
    server.use(...handlers())
    open()
    const user = userEvent.setup()
    const table = await screen.findByRole('table', { name: 'Next milestones' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['Rework', 'Testing', 'Go-live'])
    expect(within(rows[0]).getByText('Sep 1 – Oct 10, 2026')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Oct 24 – Dec 12, 2026')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Blocked – needs review')).toBeInTheDocument()
    expect(within(rows[1]).getByText('In progress')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Ada Lovelace')).toBeInTheDocument() // Bo Peep is supporting
    expect(within(rows[2]).getByText('Eli Employee')).toBeInTheDocument()
    await user.click(within(rows[2]).getByText('Oct 24 – Dec 12, 2026'))
    expect(location()).toHaveTextContent('/projects/p1?tab=milestones&milestone=m7')
  })

  test('an unowned milestone reads Unassigned, and the card is hidden when nothing is left', async () => {
    server.use(...handlers({ list: [...milestones.slice(0, 6), ms('m7', 'Go-live', { status: 'not_started', display_status: 'not_started' })] }))
    const { unmount } = open()
    expect(await within(await screen.findByRole('table', { name: 'Next milestones' })).findByText('Unassigned')).toBeInTheDocument()
    unmount()
    server.use(...handlers({ list: milestones.slice(0, 4) }))
    open()
    await screen.findByText('4 of 4 milestones complete')
    expect(screen.queryByRole('heading', { name: 'Next milestones' })).not.toBeInTheDocument()
  })
})

describe('Overview for the manager', () => {
  test('Needs attention: pending entries, hours, the risk sentences and the milestone counts', async () => {
    const pending = Array.from({ length: 8 }, (_, i) => approvalItem(`e${i}`, i < 6 ? 8 : 7)) // 6*8 + 2*7 = 62
    let asked = null
    server.use(http.get(`${API}/approvals`, ({ request }) => { asked = new URL(request.url).searchParams.get('project'); return HttpResponse.json(pending) }),
      ...handlers({ pending, p: project({ at_risk_reasons: ['OVERDUE_MILESTONE', 'BUDGET_BURN'], budget_pct: 81, progress_pct: 62 }) }))
    open()
    const card = (await screen.findByRole('heading', { name: 'Needs attention' })).closest('section')
    expect(await within(card).findByText('8 pending entries')).toBeInTheDocument()
    expect(within(card).getByText('62h awaiting approval')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Review hours' })).toHaveAttribute('href', '/timesheets?project=p1')
    expect(within(card).getByText('81% of the budget used against 62% progress: 19 points ahead.')).toBeInTheDocument()
    expect(within(card).getByText('2 overdue milestones')).toBeInTheDocument()
    expect(within(card).getByText('1 kicked back')).toBeInTheDocument()
    expect(asked).toBe('p1')
  })

  test('Needs attention is hidden when there is nothing to show', async () => {
    let answered = false
    server.use(http.get(`${API}/approvals`, () => { answered = true; return HttpResponse.json([]) }),
      ...handlers({ list: milestones.slice(0, 4).concat(ms('m7', 'Go-live', { status: 'not_started', display_status: 'not_started',
        start_date: '2026-10-24', end_date: '2026-12-12' })) }))
    open()
    await screen.findByText('4 of 5 milestones complete')
    await waitFor(() => expect(answered).toBe(true))   // the pending entries are known (none), not still loading
    await new Promise((resolve) => setTimeout(resolve, 20))   // and that answer has reached the page
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument()
  })

  test('Team this week shows the week, planned and logged, and a +Nh chip above plan', async () => {
    server.use(...handlers())
    open()
    const card = (await screen.findByRole('heading', { name: 'Team this week' })).closest('section')
    expect(within(card).getByText('Week of Oct 12, 2026')).toBeInTheDocument()
    const row = (await within(card).findByText('Ada Lovelace')).closest('tr')
    expect(within(row).getByText('20h')).toBeInTheDocument()
    expect(within(row).getByText('34h')).toBeInTheDocument()
    expect(within(row).getByText('+14h')).toBeInTheDocument()
    expect(within(within(card).getByText('Bo Peep').closest('tr')).queryByText(/^\+/)).not.toBeInTheDocument()
  })

  test('Project details: budget available, effort, people and the work mode', async () => {
    server.use(...handlers({ p: project({ work_mode: 'pull' }) }))
    open()
    const card = (await screen.findByRole('heading', { name: 'Project details' })).closest('section')
    expect(await within(card).findByText('$228,255')).toBeInTheDocument()
    expect(within(card).getByText(/^of \$250,000/)).toBeInTheDocument()
    expect(within(card).getByText('Estimated effort')).toBeInTheDocument()
    expect(within(card).getByText('640h')).toBeInTheDocument()
    expect(within(card).getByText('over 165 days · 52% used')).toBeInTheDocument()
    expect(await within(card).findByText('5 people')).toBeInTheDocument()
    expect(within(card).getByText(/pull mode/i)).toBeInTheDocument()
  })

  test('a negative budget reads over budget', async () => {
    server.use(...handlers({ p: project({ consumed: 260000 }), summary: { remaining: -10000, consumed: 260000 } }))
    open()
    const card = (await screen.findByRole('heading', { name: 'Project details' })).closest('section')
    expect(await within(card).findByText('$10,000')).toBeInTheDocument()
    expect(within(card).getByText(/over budget/)).toBeInTheDocument()
  })

  test('the description, manager and department live in the header, not the Overview', async () => {
    server.use(...handlers())
    open()
    await screen.findByRole('heading', { name: 'Project details' })
    expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Manager:/)).not.toBeInTheDocument()
  })
})

describe('Overview for an employee', () => {
  test('never asks for approvals or allocations; Needs attention has only risk and milestone rows', async () => {
    const seen = requests()
    server.use(...handlers({ p: project({ at_risk_reasons: ['OVERDUE_MILESTONE'] }) }))
    open(users.employee)
    const card = (await screen.findByRole('heading', { name: 'Needs attention' })).closest('section')
    expect(within(card).getByText('2 overdue milestones')).toBeInTheDocument()
    expect(within(card).queryByText(/pending/)).not.toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: 'Review hours' })).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Your part' })
    expect(screen.queryByRole('heading', { name: 'Team this week' })).not.toBeInTheDocument()
    expect(seen.filter((p) => p.startsWith('/approvals') || p.startsWith('/allocations'))).toEqual([])
  })

  test('Your part: milestones, the next one, hours from the profile, this week from the timesheet, and the timesheet link', async () => {
    let week = null
    server.use(http.get(`${API}/time-entries`, ({ request }) => {
      week = new URL(request.url).searchParams.get('week')
      return HttpResponse.json({ rows: [], totals: { logged: 9, approved: 0 }, entries: [
        { id: 'a', project_id: 'p1', status: 'pending', hours: '4' }, { id: 'b', project_id: 'p1', status: 'approved', hours: 2 },
        { id: 'c', project_id: 'p1', status: 'rejected', hours: 3 }, { id: 'd', project_id: 'p2', status: 'approved', hours: 5 }] })
    }), ...handlers())
    open(users.employee)
    const card = (await screen.findByRole('heading', { name: 'Your part' })).closest('section')
    expect(await within(card).findByText('Your milestones: 2 of 7')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Go-live' })).toHaveAttribute('href', expect.stringContaining('milestone=m7'))
    expect(within(card).getByText(/due Dec 12, 2026/)).toBeInTheDocument()
    expect(await within(card).findByText('Your hours: 38h logged · 34h approved')).toBeInTheDocument()
    expect(await within(card).findByText('This week: 6h of 10h planned')).toBeInTheDocument()
    expect(week).toBe('2026-10-12')
    expect(within(card).getByRole('link', { name: 'Open my timesheet' })).toHaveAttribute('href', '/timesheet')
  })

  test('Your milestones counts a milestone they only support, and leaves archived ones out of both numbers', async () => {
    const list = [...milestones,
      ms('m8', 'Support', { status: 'in_progress', display_status: 'in_progress', start_date: '2026-10-01', end_date: '2026-11-30',
        is_assignee: true, assignees: [ada, eli], supporting_ids: [eli.id] }),
      ms('m9', 'Old work', { is_assignee: true, assignees: [eli], is_archived: true })]
    server.use(...handlers({ list }))
    open(users.employee)
    const card = (await screen.findByRole('heading', { name: 'Your part' })).closest('section')
    expect(await within(card).findByText('Your milestones: 3 of 8')).toBeInTheDocument()   // Design, Go-live, Support
    expect(within(card).getByRole('link', { name: 'Support' })).toHaveAttribute('href', expect.stringContaining('milestone=m8'))
  })

  test("someone who isn't on the team is told so", async () => {
    server.use(http.get(`${API}/projects/p1/members`, () => HttpResponse.json([])), ...handlers())
    open(users.employee)
    expect(await screen.findByText("You aren't on this project's team.")).toBeInTheDocument()
  })

  test('the timesheet link is for people who keep a timesheet only', async () => {
    server.use(http.get(`${API}/projects/p1/members`, () => HttpResponse.json([
      { user: { id: 'u-other-mgr', first_name: 'Other', last_name: 'Manager' }, planned_hours_per_week: 5 }])),
    http.get(`${API}/users/u-other-mgr/profile`, () => HttpResponse.json({ projects: [], milestones: [] })), ...handlers())
    open({ ...users.manager, id: 'u-other-mgr' })
    expect(await screen.findByRole('heading', { name: 'Your part' })).toBeInTheDocument()
    expect(await screen.findByText('Your milestones: 2 of 7')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open my timesheet' })).not.toBeInTheDocument()
  })
})

describe('Overview for an executive', () => {
  test('the manager layout, read-only: no pending rows, no Team this week, no approvals request, no Edit', async () => {
    const seen = requests()
    server.use(...handlers({ p: project({ at_risk_reasons: ['OVERDUE_MILESTONE'] }) }))
    open(users.executive)
    const card = (await screen.findByRole('heading', { name: 'Needs attention' })).closest('section')
    expect(within(card).getByText('2 overdue milestones')).toBeInTheDocument()
    expect(within(card).queryByText(/pending/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Team this week' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your part' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(await screen.findByText('4 of 7 milestones complete')).toBeInTheDocument()
    expect(seen.filter((p) => p.startsWith('/approvals'))).toEqual([])
  })
})

describe('Overview on a phone', () => {
  // The KPI strip comes before every card.
  const expectStripFirst = () => {
    const strip = screen.getByRole('group', { name: 'Project figures' })
    const first = screen.getByRole('heading', { level: 2, name: 'Milestone schedule' })
    expect(strip.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }

  test('stacks the cards in reading order', async () => {
    setViewport(375)
    server.use(...handlers())
    open()
    await screen.findByRole('heading', { name: 'Needs attention' })
    await screen.findByRole('heading', { name: 'Team this week' })
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(heads.filter((t) => ['Milestone schedule', 'Next milestones', 'Needs attention', 'Team this week', 'Project details'].includes(t)))
      .toEqual(['Milestone schedule', 'Next milestones', 'Needs attention', 'Team this week', 'Project details'])
    expectStripFirst()
  })

  test("tapping a Next milestones card's link opens the panel once: Back returns to the Overview", async () => {
    setViewport(375)
    function Back() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate(-1)}>Back</button>
    }
    server.use(...handlers())
    renderAsUser(<><ProjectDetailPage /><Back /></>, { user: users.manager, path: '/projects/:id',
      entries: ['/projects', '/projects/p1'] })
    const cards = await screen.findByRole('list', { name: 'Next milestones' })
    const user = userEvent.setup()
    await user.click(within(cards).getByRole('link', { name: 'Go-live' }))
    expect(location()).toHaveTextContent('/projects/p1?tab=milestones&milestone=m7')
    // The panel opens as a full-screen sheet, which hides the rest of the page from the accessibility tree.
    await user.click(screen.getByRole('button', { name: 'Back', hidden: true }))
    expect(location()).toHaveTextContent(/^\/projects\/p1$/)
  })

  test("an employee's stack has Your part in Team this week's slot, after the KPI strip", async () => {
    setViewport(375)
    server.use(...handlers())
    open(users.employee)
    await screen.findByRole('heading', { name: 'Needs attention' })
    await screen.findByRole('heading', { name: 'Your part' })
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(heads.filter((t) => ['Milestone schedule', 'Next milestones', 'Needs attention', 'Team this week', 'Your part',
      'Project details'].includes(t)))
      .toEqual(['Milestone schedule', 'Next milestones', 'Needs attention', 'Your part', 'Project details'])
    expectStripFirst()
  })
})


describe('Overview: the critical details are bold', () => {
  test('over budget, overdue, the pending and kicked-back counts, the +Nh chip and the risk word; normal states stay regular', async () => {
    const pending = [approvalItem('e1', 8), approvalItem('e2', 4)]
    server.use(...handlers({ pending, summary: { forecast: 261000, remaining: -10000, consumed: 260000 },
      p: project({ consumed: 260000, predicted_end_date: '2026-10-10', at_risk_reasons: ['PAST_DUE', 'OVERDUE_MILESTONE'] }) }))
    open()
    const strip = await screen.findByRole('group', { name: 'Project figures' })
    await waitFor(() => expect(bold(strip)).toEqual(['⚠ Over budget', '5 days overdue']))
    expect(bold(screen.getByRole('img', { name: 'Risk: Past due, Overdue milestone' }))).toEqual(['Past due'])
    const attention = await screen.findByRole('region', { name: 'Needs attention' })
    await within(attention).findByText(/pending entries/)
    expect(bold(attention)).toEqual(['2 pending entries', '12h awaiting approval', '2 overdue milestones', '1 kicked back'])
    const details = screen.getByRole('region', { name: 'Project details' })
    await within(details).findByText('$10,000')
    expect(bold(details)).toEqual(['over budget'])
    const team = screen.getByRole('region', { name: 'Team this week' })
    await within(team).findByText('Ada Lovelace')
    expect(bold(team)).toEqual(['+14h'])
    // Kicked back is bold; In progress and Not started are not.
    expect(bold(screen.getByRole('region', { name: 'Next milestones' }))).toEqual(['Blocked – needs review'])
  })
})
