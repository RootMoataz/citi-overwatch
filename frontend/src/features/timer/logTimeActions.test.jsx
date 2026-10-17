import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import MyWeekPage from '../home/MyWeekPage.jsx'
import MilestonesTab from '../milestones/MilestonesTab.jsx'
import { projectView } from '../projects/viewer.js'
import TimesheetPage from '../timesheet/TimesheetPage.jsx'

const WEEK = '2026-10-12'
const NOW = '2026-10-15T16:00:00.000Z'
const apollo = { id: 'p1', name: 'Apollo Data Migration', status: 'active', is_archived: false }
const note = 'Mapped the address fields'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
  server.events.removeAllListeners()
})

const notFound = () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })
const onHold = { id: 'p2', name: 'Atlas', status: 'on_hold' }
const sheetRow = (id, name, extra = {}) => ({ milestone: { id, name, status: 'in_progress', ...extra.milestone },
  project: { ...apollo, ...extra.project }, open: extra.open ?? true })
const entry = (extra = {}) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: '2026-10-13', hours: 2, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note, label: 'Pending approval', manual: null,
  updated_at: '2026-10-13T10:00:00+00:00', ...extra })
function week({ rows = [sheetRow('m1', 'Schema Mapping'), sheetRow('m2', 'Cutover')], entries = [], start = WEEK } = {}) {
  return http.get(`${API}/time-entries`, ({ request }) => {
    const asked = new URL(request.url).searchParams.get('week') ?? start
    return HttpResponse.json({ week_start: asked, user: { id: users.employee.id, name: 'Eli Employee' },
      rows: asked === start ? rows : [], entries: asked === start ? entries : [], drafts: [],
      totals: { logged: 0, approved: 0 } })
  })
}
const timerOn = (id, name) => http.get(`${API}/timers/current`, () => HttpResponse.json({ now: NOW, stopped: null, limits: [],
  timer: { id: 't1', milestone: { id, name }, project: { id: 'p1', name: apollo.name }, work_date: '2026-10-15',
    started_at: '2026-10-15T15:00:00.000Z', stopped_at: null, auto_stopped: false, tracked_hours: 0, submitted: false, note: '' } }))
const start = (name) => screen.queryByRole('button', { name: `Start timer on ${name}` })
const manual = (name) => screen.queryByRole('button', { name: `Log hours manually on ${name}` })
const startBtn = (name) => screen.findByRole('button', { name: `Start timer on ${name}` })
const manualBtn = (name) => screen.findByRole('button', { name: `Log hours manually on ${name}` })

// ---------- My week ----------
const ms = (id, name, o = {}) => ({ id, name, status: 'not_started', display_status: 'not_started', difficulty: 'medium',
  priority: 'medium', start_date: '2026-10-01', end_date: '2026-11-30', waiting_on: [], progress_percent: null, is_archived: false,
  role: 'primary', project: apollo, can_open: true, logged_hours: 0, approved_hours: 0, ...o })
const inProgress = { status: 'in_progress', display_status: 'in_progress' }
const build = ms('m1', 'Build', { ...inProgress, end_date: '2026-10-20' })
const hypercare = ms('m2', 'Hypercare', { start_date: '2026-10-12', end_date: '2026-12-27' })
const finished = ms('m3', 'Finished', { status: 'completed', display_status: 'completed', start_date: '2026-07-15', end_date: '2026-10-09' })
const profile = (milestones, who = { id: 'u-emp', name: 'Eli Employee', role: 'employee', manager: null }) => ({ user: who,
  this_week: { week_start: WEEK, logged: 0, overtime: 0, planned: 30 }, all_time: { logged: 0, approved: 0 },
  projects: [], skills: [], milestones, coming_up: [] })
function serveMyWeek(milestones, who) {
  server.use(
    http.get(`${API}/users/:id/profile`, () => HttpResponse.json(profile(milestones, who))),
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/conversations`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/milestones/:id/discussion`, () => notFound()),
    week({ rows: milestones.map((m) => sheetRow(m.id, m.name, { milestone: { status: m.status } })) }),
  )
}
const myWeek = (user = users.employee) => renderAsUser(<MyWeekPage />, { user })

describe('every place that starts a timer also logs hours manually', () => {
  test('My week: the Now card, an In progress row and an Upcoming row', async () => {
    serveMyWeek([build, hypercare])
    myWeek()
    const focus = await screen.findByRole('region', { name: 'Your focus' })
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(await within(now).findByRole('button', { name: 'Start timer on Build' })).toBeInTheDocument()
    expect(within(now).getByRole('button', { name: 'Log hours manually on Build' })).toBeInTheDocument()
    const rows = screen.getByRole('region', { name: /^In progress/ })
    expect(within(rows).getByRole('button', { name: 'Start timer on Build' })).toBeInTheDocument()
    expect(within(rows).getByRole('button', { name: 'Log hours manually on Build' })).toBeInTheDocument()
    const upcoming = screen.getByRole('region', { name: /^Upcoming/ })
    expect(within(upcoming).getByRole('button', { name: 'Start timer on Hypercare' })).toBeInTheDocument()
    expect(within(upcoming).getByRole('button', { name: 'Log hours manually on Hypercare' })).toBeInTheDocument()
  })

  test('My week: the manual button reads "Log hours manually" and is a 44 px target', async () => {
    serveMyWeek([build])
    myWeek()
    const focus = await screen.findByRole('region', { name: 'Your focus' })
    const button = await within(focus).findByRole('button', { name: 'Log hours manually on Build' })
    expect(button).toHaveTextContent('Log hours manually')
    expect(button).toHaveStyle({ minHeight: '44px' })
    expect(within(focus).getByRole('button', { name: 'Start timer on Build' })).toHaveStyle({ minHeight: '44px' })
  })

  test("the milestone panel's Details tab", async () => {
    const project = { id: 'p1', name: 'Apollo', start_date: '2026-01-01', predicted_end_date: '2026-12-31', status: 'active',
      manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [] }
    const me = { id: users.employee.id, name: 'Eli Employee' }
    const mapping = { id: 'm1', project_id: 'p1', name: 'Schema Mapping', description: '', ...inProgress, blocked: false,
      predecessors: [], assignees: [me], is_assignee: true, completed_at: null, is_archived: false, difficulty: 'medium',
      priority: 'medium', objective: '', completion_criteria: '', required_skills: [], progress_percent: null, open_kickback: null,
      can_post_update: true, can_kick_back: true, can_resolve_kickback: false, can_claim: false, start_date: '2026-03-01',
      end_date: '2026-12-30', logged_hours: 4, estimated_hours: 10 }
    server.use(
      http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([mapping])),
      http.get(`${API}/projects/p1/members`, () => HttpResponse.json([])),
      http.get(`${API}/milestones/:id/notes`, () => HttpResponse.json([])),
      http.get(`${API}/milestones/:id/updates`, () => HttpResponse.json([])),
      http.get(`${API}/milestones/:id/history`, () => HttpResponse.json({ kickbacks: [], events: [] })),
      http.get(`${API}/milestones/:id/discussion`, () => notFound()),
      http.get(`${API}/skills`, () => HttpResponse.json({ items: [] })),
      week(),
    )
    const view = projectView(users.employee, project)
    renderAsUser(<MilestonesTab project={project} manage={view.manage} user={users.employee} view={view} />,
      { user: users.employee, route: '/m?milestone=m1' })
    const card = await screen.findByRole('complementary', { name: 'Schema Mapping' })
    expect(await within(card).findByRole('button', { name: 'Start timer on Schema Mapping' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Log hours manually on Schema Mapping' })).toBeInTheDocument()
  })

  describe('the Week grid', () => {
    beforeEach(() => { localStorage.setItem('overwatch.timesheet.view', 'week') })
    const sheet = (route) => renderAsUser(<TimesheetPage />, { user: users.employee, route, path: '/timesheet' })

    test('a row of this week has both buttons', async () => {
      server.use(week())
      sheet(`/timesheet?week=${WEEK}`)
      expect(await startBtn('Schema Mapping')).toBeInTheDocument()
      expect(await manualBtn('Schema Mapping')).toBeInTheDocument()
      expect(manual('Cutover')).toBeInTheDocument()
    })

    test('a past week has neither', async () => {
      server.use(week({ start: '2026-10-05' }))
      sheet('/timesheet?week=2026-10-05')
      expect(await screen.findByRole('rowheader', { name: /schema mapping/i })).toBeInTheDocument()
      expect(start('Schema Mapping')).not.toBeInTheDocument()
      expect(manual('Schema Mapping')).not.toBeInTheDocument()
    })

    test('a row of an on-hold project has neither', async () => {
      server.use(week({ rows: [sheetRow('m1', 'Schema Mapping'), sheetRow('m2', 'Cutover', { project: onHold, open: false })] }))
      sheet(`/timesheet?week=${WEEK}`)
      expect(await manualBtn('Schema Mapping')).toBeInTheDocument()
      expect(screen.getByRole('rowheader', { name: /cutover/i })).toBeInTheDocument()
      expect(start('Cutover')).not.toBeInTheDocument()
      expect(manual('Cutover')).not.toBeInTheDocument()
    })
  })
})

// ---------- Day view ----------
describe('the Day view', () => {
  const day = (route, options) => {
    server.use(week(options))
    return renderAsUser(<TimesheetPage />, { user: users.employee, route, path: '/timesheet' })
  }
  beforeEach(() => { localStorage.setItem('overwatch.timesheet.view', 'day') })

  test("today's row has both buttons", async () => {
    day(`/timesheet?week=${WEEK}&day=2026-10-15`)
    expect(await startBtn('Schema Mapping')).toBeInTheDocument()
    expect(await manualBtn('Schema Mapping')).toBeInTheDocument()
  })

  test('an empty cell on a past day has only the manual button, and its dialog selects that day', async () => {
    day(`/timesheet?week=${WEEK}&day=2026-10-13`)
    const user = userEvent.setup()
    await user.click(await manualBtn('Schema Mapping'))
    expect(start('Schema Mapping')).not.toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Day' })).toHaveTextContent('Tue 13 Oct')
  })

  test('Thursday Oct 8, seven days back, has the manual button only', async () => {
    day('/timesheet?week=2026-10-05&day=2026-10-08', { start: '2026-10-05' })
    expect(await manualBtn('Schema Mapping')).toBeInTheDocument()
    expect(start('Schema Mapping')).not.toBeInTheDocument()
  })

  test('none on a day with an entry', async () => {
    day(`/timesheet?week=${WEEK}&day=2026-10-13`, { entries: [entry()] })
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toBeInTheDocument()
    expect(await manualBtn('Cutover')).toBeInTheDocument()
    expect(manual('Schema Mapping')).not.toBeInTheDocument()
  })

  test('none on a closed row', async () => {
    day(`/timesheet?week=${WEEK}&day=2026-10-13`, { rows: [sheetRow('m1', 'Schema Mapping'),
      sheetRow('m2', 'Cutover', { project: onHold, open: false })] })
    expect(await manualBtn('Schema Mapping')).toBeInTheDocument()
    expect(manual('Cutover')).not.toBeInTheDocument()
  })

  test('none eight days back (Wed Oct 7)', async () => {
    day('/timesheet?week=2026-10-05&day=2026-10-07', { start: '2026-10-05' })
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 7')).toBeInTheDocument()
    expect(manual('Schema Mapping')).not.toBeInTheDocument()
  })

  test('none once hours are typed into the cell', async () => {
    day(`/timesheet?week=${WEEK}&day=2026-10-13`)
    const user = userEvent.setup()
    await manualBtn('Schema Mapping')
    await user.type(screen.getByLabelText('Schema Mapping, Tue Oct 13'), '2')
    expect(manual('Schema Mapping')).not.toBeInTheDocument()
  })
})

// ---------- hidden where Start timer is hidden ----------
describe('hidden where Start timer is hidden', () => {
  test('a timer running on this milestone hides it; another milestone keeps it enabled', async () => {
    server.use(timerOn('m1', 'Schema Mapping'))
    serveMyWeek([ms('m1', 'Schema Mapping', { ...inProgress, end_date: '2026-10-20' }),
      ms('m2', 'Cutover', { ...inProgress, end_date: '2026-10-25' })])
    myWeek()
    expect((await screen.findAllByRole('button', { name: /^Stop timer on Schema Mapping/ })).length).toBeGreaterThan(0)
    const others = await screen.findAllByRole('button', { name: 'Log hours manually on Cutover' })
    for (const b of others) expect(b).toBeEnabled()
    expect(manual('Schema Mapping')).not.toBeInTheDocument()
  })

  test('a completed milestone has neither', async () => {
    serveMyWeek([build, finished])
    myWeek()
    expect((await screen.findAllByRole('button', { name: 'Log hours manually on Build' })).length).toBeGreaterThan(0)
    expect(start('Finished')).not.toBeInTheDocument()
    expect(manual('Finished')).not.toBeInTheDocument()
  })

  test('a manager without "Tracks own hours" has neither', async () => {
    serveMyWeek([build], { id: 'u-mgr', name: 'Morgan Manager', role: 'manager', manager: null })
    renderAsUser(<MyWeekPage />, { user: users.manager })
    expect((await screen.findAllByRole('heading', { name: 'Build' })).length).toBeGreaterThan(0)
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(start('Build')).not.toBeInTheDocument()
    expect(manual('Build')).not.toBeInTheDocument()
  })

  test('the public demo admin who tracks hours sees it disabled, with the demo tooltip', async () => {
    serveMyWeek([build], { id: 'u-demo-admin', name: 'Dana Demo-Admin', role: 'admin', manager: null })
    myWeek({ ...users.demoAdmin, tracks_own_hours: true })
    const button = (await screen.findAllByRole('button', { name: 'Log hours manually on Build' }))[0]
    expect(button).toBeDisabled()
    await userEvent.setup().hover(button.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Disabled in the public demo')
  })
})

// ---------- Start timer waits on today's manual hours ----------
describe("Start timer waits on today's manual hours", () => {
  const sheet = () => renderAsUser(<TimesheetPage />, { user: users.employee, route: `/timesheet?week=${WEEK}&day=2026-10-15`, path: '/timesheet' })
  beforeEach(() => { localStorage.setItem('overwatch.timesheet.view', 'day') })

  test("it is disabled with the tooltip on a milestone with today's manual entry; the other starts", async () => {
    server.use(week({ entries: [entry({ work_date: '2026-10-15', manual: { reason: 'forgot_timer', details: null } })] }))
    const user = userEvent.setup()
    sheet()
    const button = await startBtn('Schema Mapping')
    await waitFor(() => expect(button).toBeDisabled())
    await user.hover(button.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent("You logged today's hours here manually. Edit that request instead.")
    expect(screen.getByRole('button', { name: 'Start timer on Cutover' })).toBeEnabled()
  })

  test('a manual entry on another day does not disable Start', async () => {
    server.use(week({ entries: [entry({ work_date: '2026-10-14', manual: { reason: 'forgot_timer', details: null } })] }))
    sheet()
    expect(await startBtn('Schema Mapping')).toBeEnabled()
  })
})

// ---------- privacy ----------
describe('privacy', () => {
  test('an employee opening and sending the dialog asks only for their own data', async () => {
    const seen = []
    server.events.on('request:start', ({ request }) => { seen.push({ method: request.method, url: new URL(request.url) }) })
    serveMyWeek([build])
    server.use(http.post(`${API}/manual-hours`, () => HttpResponse.json({ entry: entry({ work_date: '2026-10-15' }), week_start: WEEK }, { status: 201 })))
    myWeek()
    const user = userEvent.setup()
    const focus = await screen.findByRole('region', { name: 'Your focus' })
    await user.click(await within(focus).findByRole('button', { name: 'Log hours manually on Build' }))
    const dialog = await screen.findByRole('dialog', { name: 'Log hours manually' })
    await user.type(within(dialog).getByRole('textbox', { name: /^Hours/ }), '2')
    await user.click(within(dialog).getByRole('radio', { name: 'Forgot to start the timer' }))
    await user.type(within(dialog).getByRole('textbox', { name: /^Work note/ }), note)
    await user.click(within(dialog).getByRole('button', { name: 'Send for review' }))
    const path = (r) => r.url.pathname
    await waitFor(() => expect(seen.some((r) => r.method === 'POST' && path(r).endsWith('/manual-hours'))).toBe(true))
    expect(seen.filter((r) => path(r).includes('/manual-hours')).map((r) => r.method)).toEqual(['POST'])
    const entries = seen.filter((r) => path(r).endsWith('/time-entries'))
    expect(entries.length).toBeGreaterThan(0)
    for (const r of entries) expect(r.url.searchParams.has('user')).toBe(false)
    expect(seen.filter((r) => /\/(approvals|allocations)/.test(path(r)))).toEqual([])
    for (const r of seen.filter((s) => /\/users\//.test(path(s)))) expect(path(r)).toMatch(/\/users\/u-emp(\/|$)/)
  })
})
