import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { bold } from '../../test/bold.js'
import MyWeekPage from './MyWeekPage.jsx'

// Thursday 15 Oct 2026, noon in New York. Only Date is faked: faking every timer makes userEvent hang.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  server.events.removeAllListeners()
})

const atlas = { id: 'p3', name: 'Atlas Customer Portal', status: 'active', is_archived: false }
const apollo = { id: 'p1', name: 'Apollo Data Migration', status: 'active', is_archived: false }
const ms = (id, name, o = {}) => ({
  id, name, status: 'not_started', display_status: 'not_started', difficulty: 'medium', priority: 'medium',
  start_date: '2026-10-01', end_date: '2026-11-30', waiting_on: [], progress_percent: null, is_archived: false,
  role: 'primary', project: apollo, can_open: true, logged_hours: 0, approved_hours: 0, ...o,
})
const doneMs = (id, name, end) => ms(id, name, { status: 'completed', display_status: 'completed', start_date: '2026-07-15', end_date: end })

const build = ms('m1', 'Build', { status: 'in_progress', display_status: 'in_progress', priority: 'critical', difficulty: 'hard',
  start_date: '2026-09-01', end_date: '2026-10-05', progress_percent: 40, project: atlas })
const hypercare = ms('m2', 'Hypercare', { start_date: '2026-10-12', end_date: '2026-12-27' })
const review = ms('m3', 'Review', { start_date: '2026-10-21', end_date: '2026-11-20' })
const dataLoad = ms('m4', 'Data load', { display_status: 'waiting', start_date: '2026-10-10', end_date: '2026-11-25',
  waiting_on: [{ id: 'm20', name: 'Load testing' }] })
const submitted = ms('m5', 'Schema review', { status: 'ready_for_review', display_status: 'ready_for_review', end_date: '2026-10-30' })
const completed = [doneMs('m6', 'Discovery', '2026-08-14'), doneMs('m8', 'Schema Mapping', '2026-10-09'),
  doneMs('m9', 'Build: frontend', '2026-09-23')]
const base = [build, hypercare, review, dataLoad, submitted, ...completed]

const cutover = {
  milestone: { id: 'c1', name: 'Data cutover', start_date: '2026-11-02', end_date: '2026-11-27', priority: 'high' },
  project: { id: 'p1', name: 'Apollo Data Migration' }, ready: true, after: [], skills: ['Data Engineering'],
  match: { have: 1, need: 1 }, is_new: true,
}
const reporting = {
  milestone: { id: 'c2', name: 'Reporting', start_date: '2026-11-16', end_date: '2026-12-11', priority: 'medium' },
  project: { id: 'p1', name: 'Apollo Data Migration' }, ready: false, after: [{ id: 'm30', name: 'Discovery' }],
  skills: ['Backend Development', 'Data Engineering'], match: { have: 2, need: 3 }, is_new: false,
}

const profile = (milestones, comingUp) => ({
  user: { id: 'u-emp', name: 'Eli Employee', role: 'employee', manager: null },
  this_week: { week_start: '2026-10-12', logged: 19.75, overtime: 0, planned: 30 },
  all_time: { logged: 300, approved: 280 }, projects: [], skills: [], milestones, coming_up: comingUp,
})

const pull = { id: 'p2', name: 'Beacon', status: 'active', work_mode: 'pull' }
const claimable = { id: 'm7', project_id: 'p2', name: 'Build pipeline', status: 'not_started', difficulty: 'medium',
  priority: 'medium', start_date: '2026-10-01', end_date: '2026-11-15', can_claim: true, claimable: true }
const taken = { ...claimable, id: 'm10', name: 'Taken already', can_claim: false, claimable: false }

const week = (rows) => ({ week_start: '2026-10-12', user: { id: 'u-emp', name: 'Eli Employee' }, entries: [],
  totals: { logged: 0, approved: 0 }, rows })
const notFound = () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })

function serve({ milestones = base, comingUp = [cutover, reporting], discussion = 404, rows = [], claim = [claimable, taken] } = {}) {
  server.use(
    http.get(`${API}/users/u-emp/profile`, () => HttpResponse.json(profile(milestones, comingUp))),
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [pull], total: 1 })),
    http.get(`${API}/projects/p2/milestones`, () => HttpResponse.json(claim)),
    http.get(`${API}/time-entries`, () => HttpResponse.json(week(rows))),
    // Whether Build has a discussion is read from the viewer's own conversations (always a 200); asking the milestone
    // for it would answer 404 for every milestone without one.
    http.get(`${API}/conversations`, () => HttpResponse.json({ items: discussion === 200
      ? [{ id: 'conv-1', subject: 'Build · Atlas Customer Portal', is_group: true,
        milestone: { id: 'm1', name: 'Build', project: { id: 'p3', name: 'Atlas Customer Portal' } } }]
      : [{ id: 'conv-2', subject: null, is_group: false, milestone: null },
        { id: 'conv-3', subject: 'Hypercare · Apollo', is_group: true, milestone: { id: 'm2', name: 'Hypercare' } }] })),
    http.get(`${API}/milestones/:id/discussion`, () => notFound()),
  )
}

const render = () => renderAsUser(<MyWeekPage />, { user: users.employee })
const openPage = async () => {
  render()
  return screen.findByRole('region', { name: 'Your focus' })
}
const region = (name) => screen.getByRole('region', { name })
// A line whose critical part is bold is split across elements: match the innermost element holding the whole line.
const wholeText = (text) => (_, el) => el.textContent === text && [...el.children].every((c) => c.textContent !== text)
const rowsOf = (section) => within(section).getAllByRole('listitem')
const names = (rows) => rows.map((r) => within(r).getByRole('heading', { level: 3 }).textContent)
const INTRO = 'When the milestone before one of these is completed, auto-routing picks someone on the team with the right '
  + "skills. It's a likely pick, not a promise."

describe('Your focus', () => {
  test('Now is the most urgent milestone in progress: due line, priority, difficulty, progress, state and View milestone', async () => {
    serve()
    const focus = await openPage()
    expect(within(focus).getByText(wholeText('1 overdue · 1 with your manager'))).toBeInTheDocument()
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(within(now).getByRole('heading', { level: 3, name: 'Build' })).toBeInTheDocument()
    expect(within(now).getByRole('link', { name: 'Atlas Customer Portal' })).toHaveAttribute('href', '/projects/p3?tab=milestones')
    expect(within(now).getByText(wholeText('Due Oct 5, 2026 · 10 days overdue'))).toBeInTheDocument()
    expect(within(now).getByText('Critical priority')).toBeInTheDocument()
    expect(within(now).getByText('Hard difficulty')).toBeInTheDocument()
    expect(within(now).getByText('40% done')).toBeInTheDocument()
    expect(within(now).getByText('In progress')).toBeInTheDocument()
    expect(within(now).getByRole('link', { name: 'View milestone' }))
      .toHaveAttribute('href', '/projects/p3?tab=milestones&milestone=m1')
  })

  test('Discuss opens the project panel on Discussion once the milestone has one', async () => {
    serve({ discussion: 200 })
    const focus = await openPage()
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(await within(now).findByRole('link', { name: 'Discuss' }))
      .toHaveAttribute('href', '/projects/p3?tab=milestones&milestone=m1&panel=discussion')
  })

  test('no Discuss while the milestone has no discussion, and no request that answers 404 to say so', async () => {
    const asked = []
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url).pathname))
    serve()
    const focus = await openPage()
    await waitFor(() => expect(asked).toContain(`${API}/conversations`))
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(within(focus).queryByRole('link', { name: 'Discuss' })).not.toBeInTheDocument()
    // Another milestone's discussion (Hypercare) doesn't count for Build.
    expect(asked.filter((path) => path.endsWith('/discussion'))).toEqual([])
  })

  test('Next is the first Upcoming milestone, with its label and a chevron to its panel', async () => {
    serve()
    const focus = await openPage()
    const next = within(focus).getByRole('group', { name: 'Next' })
    expect(within(next).getByRole('heading', { level: 3, name: 'Hypercare' })).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: 'Apollo Data Migration' })).toHaveAttribute('href', '/projects/p1?tab=milestones')
    expect(within(next).getByText('Ready to start')).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: 'View milestone Hypercare' }))
      .toHaveAttribute('href', '/projects/p1?tab=milestones&milestone=m2')
  })

  test('with nothing in progress: "Nothing in progress" and a link to start the first ready milestone', async () => {
    serve({ milestones: [hypercare, review] })
    const focus = await openPage()
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(within(now).getByText('Nothing in progress')).toBeInTheDocument()
    expect(within(now).getByRole('link', { name: 'Start Hypercare next' }))
      .toHaveAttribute('href', '/projects/p1?tab=milestones&milestone=m2')
  })

  test('with nothing up next and nothing predicted: "Nothing else assigned yet" and no way to predictions', async () => {
    serve({ milestones: [build], comingUp: [] })
    const focus = await openPage()
    const next = within(focus).getByRole('group', { name: 'Next' })
    expect(within(next).getByText('Nothing else assigned yet')).toBeInTheDocument()
    expect(within(focus).queryByRole('button', { name: 'See what might come your way' })).not.toBeInTheDocument()
  })

  test('See what might come your way reopens the predictions, scrolls to them and focuses their header', async () => {
    const original = Element.prototype.scrollIntoView
    const scrolled = []
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(options) { scrolled.push([this, options]) })
    try {
      serve({ milestones: [build] })
      const focus = await openPage()
      const user = userEvent.setup()
      const header = screen.getByRole('button', { name: 'Might come your way, 2 milestones' })
      await user.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')
      await user.click(within(focus).getByRole('button', { name: 'See what might come your way' }))
      expect(header).toHaveAttribute('aria-expanded', 'true')
      expect(header).toHaveFocus()
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
      expect(scrolled.at(-1)).toEqual([document.getElementById('myweek-coming'), { block: 'start' }])
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})

describe('Heads-up', () => {
  test('an urgent (high) first prediction gets a heads-up, marked New', async () => {
    serve()
    const focus = await openPage()
    expect(within(focus).getByRole('button', { name: 'Heads-up: Data cutover (High priority) may come your way' }))
      .toBeInTheDocument()
    expect(within(focus).getByText('New')).toBeInTheDocument()
  })

  test('a medium first prediction gets none', async () => {
    serve({ comingUp: [reporting, cutover] })
    const focus = await openPage()
    expect(within(focus).queryByRole('button', { name: /^Heads-up/ })).not.toBeInTheDocument()
  })

  test('an overdue low first prediction gets one', async () => {
    const late = { ...reporting, milestone: { ...reporting.milestone, name: 'Late audit', priority: 'low', end_date: '2026-10-01' } }
    serve({ comingUp: [late] })
    const focus = await openPage()
    expect(within(focus).getByRole('button', { name: 'Heads-up: Late audit (Low priority) may come your way' }))
      .toBeInTheDocument()
    expect(within(focus).queryByText('New')).not.toBeInTheDocument()
  })

  test('the heads-up reopens Might come your way and moves focus to that row', async () => {
    serve()
    const focus = await openPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Might come your way, 2 milestones' }))
    await user.click(within(focus).getByRole('button', { name: /^Heads-up: Data cutover/ }))
    expect(screen.getByRole('button', { name: 'Might come your way, 2 milestones' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('myweek-coming-c1')).toHaveFocus()
    expect(document.getElementById('myweek-coming-c1')).toHaveAttribute('tabindex', '-1')
  })
})

describe('the groups', () => {
  test('headings carry the counts; the buttons say how many milestones', async () => {
    serve()
    await openPage()
    for (const name of ['In progress (1)', 'Upcoming (3)', 'With your manager (1)', 'Might come your way (2)', 'Completed · 3']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'In progress, 1 milestone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upcoming, 3 milestones' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Completed, 3 milestones' })).toBeInTheDocument()
  })

  test('an empty group has no heading', async () => {
    serve({ milestones: [hypercare, review], comingUp: [] })
    await openPage()
    expect(screen.getByRole('heading', { level: 2, name: 'Upcoming (2)' })).toBeInTheDocument()
    for (const start of [/^In progress/, /^With your manager/, /^Might come your way/, /^Completed/]) {
      expect(screen.queryByRole('heading', { level: 2, name: start })).not.toBeInTheDocument()
    }
  })

  test('In progress rows: due line, percent done, state, priority, difficulty and Supporting', async () => {
    const helping = ms('m11', 'Rework', { status: 'blocked', display_status: 'blocked', priority: 'high', difficulty: 'easy',
      role: 'supporting', end_date: '2026-10-28' })
    serve({ milestones: [helping, build] })
    await openPage()
    const rows = rowsOf(region(/^In progress/))
    expect(names(rows)).toEqual(['Build', 'Rework'])
    expect(within(rows[0]).getByText(wholeText('Due Oct 5, 2026 · 10 days overdue'))).toBeInTheDocument()
    expect(within(rows[0]).getByText('40% done')).toBeInTheDocument()
    expect(within(rows[0]).getByText('In progress')).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('Priority: Critical')).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('Difficulty: Hard')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: 'Atlas Customer Portal' })).toHaveAttribute('href', '/projects/p3?tab=milestones')
    expect(within(rows[1]).getByText('Due Oct 28, 2026')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Blocked – needs review')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Supporting')).toBeInTheDocument()
  })

  test('Upcoming: ready, then later starts, then waiting, each with its due date, state and label', async () => {
    serve()
    await openPage()
    const rows = rowsOf(region(/^Upcoming/))
    expect(names(rows)).toEqual(['Hypercare', 'Review', 'Data load'])
    expect(within(rows[0]).getByText('Due Dec 27, 2026')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Not started')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Ready to start')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Starts Oct 21, 2026')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Waiting on Load testing')).toBeInTheDocument()
  })

  test('an overdue Upcoming row says by how many days', async () => {
    const lateStart = ms('m13', 'Late start', { start_date: '2026-10-01', end_date: '2026-10-10' })
    serve({ milestones: [lateStart, hypercare] })
    await openPage()
    const rows = rowsOf(region(/^Upcoming/))
    expect(names(rows)).toEqual(['Late start', 'Hypercare'])
    expect(within(rows[0]).getByText(wholeText('Due Oct 10, 2026 · 5 days overdue'))).toBeInTheDocument()
    expect(within(rows[1]).getByText('Due Dec 27, 2026')).toBeInTheDocument()
  })

  test('With your manager says who completes it', async () => {
    serve()
    await openPage()
    const rows = rowsOf(region(/^With your manager/))
    expect(names(rows)).toEqual(['Schema review'])
    expect(within(rows[0]).getByText('Submitted for review. Your manager completes the milestone.')).toBeInTheDocument()
  })

  test('Completed: newest first, with a check and the planned due date', async () => {
    serve()
    await openPage()
    const rows = rowsOf(region(/^Completed/))
    expect(names(rows)).toEqual(['Schema Mapping', 'Build: frontend', 'Discovery'])
    expect(within(rows[2]).getByText('Planned due Aug 14, 2026')).toBeInTheDocument()
    expect(within(rows[2]).getByRole('link', { name: 'Apollo Data Migration' })).toBeInTheDocument()
  })

  test('every row chevron is a link to that milestone on its project page', async () => {
    serve()
    await openPage()
    for (const m of base) {
      const links = screen.getAllByRole('link', { name: `View milestone ${m.name}` })
      for (const link of links) {
        expect(link).toHaveAttribute('href', `/projects/${m.project.id}?tab=milestones&milestone=${m.id}`)
      }
    }
    for (const c of [cutover, reporting]) {
      expect(screen.getByRole('link', { name: `View milestone ${c.milestone.name}` }))
        .toHaveAttribute('href', `/projects/p1?tab=milestones&milestone=${c.milestone.id}`)
    }
  })

  test('Might come your way: the intro, the skills you have, Ready now or After, priority, New and Prediction', async () => {
    serve()
    await openPage()
    const coming = region(/^Might come your way/)
    expect(within(coming).getByText(INTRO)).toBeInTheDocument()
    const rows = rowsOf(coming)
    expect(names(rows)).toEqual(['Data cutover', 'Reporting'])
    expect(within(rows[0]).getByText('Needs Data Engineering, which you have')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Ready now')).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('Priority: High')).toBeInTheDocument()
    expect(within(rows[0]).getByText('New')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Prediction')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Needs Backend Development and Data Engineering, which you have')).toBeInTheDocument()
    expect(within(rows[1]).getByText('After Discovery')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('New')).not.toBeInTheDocument()
    expect(within(rows[1]).getByText('Prediction')).toBeInTheDocument()
  })
})

describe('collapsing', () => {
  const TOGGLES = ['Your focus', 'In progress, 1 milestone', 'Upcoming, 3 milestones', 'With your manager, 1 milestone',
    'Might come your way, 2 milestones', 'Completed, 3 milestones', 'Available to claim, 1 milestone']

  test('every section starts expanded', async () => {
    serve()
    await openPage()
    await screen.findByRole('button', { name: 'Available to claim, 1 milestone' })
    for (const name of TOGGLES) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
  })

  test('Completed collapses to its header and count, and stays collapsed after a remount', async () => {
    serve()
    const first = render()
    await screen.findByRole('region', { name: 'Your focus' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Completed, 3 milestones' }))
    expect(screen.getByRole('button', { name: 'Completed, 3 milestones' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('heading', { level: 2, name: 'Completed · 3' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Discovery' })).not.toBeInTheDocument()
    first.unmount()

    render()
    await screen.findByRole('region', { name: 'Your focus' })
    expect(screen.getByRole('button', { name: 'Completed, 3 milestones' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { level: 3, name: 'Discovery' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upcoming, 3 milestones' })).toHaveAttribute('aria-expanded', 'true')
  })

  test('garbage in storage starts everything expanded', async () => {
    localStorage.setItem('overwatch.myweek.sections', '{not json')
    serve()
    await openPage()
    await screen.findByRole('button', { name: 'Available to claim, 1 milestone' })
    for (const name of TOGGLES) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Start timer', () => {
  const design = ms('m1', 'Design', { status: 'in_progress', display_status: 'in_progress', difficulty: 'hard',
    end_date: '2026-10-20' })
  const paused = ms('m3', 'Paused review', { status: 'in_progress', display_status: 'in_progress', end_date: '2026-10-30',
    project: { id: 'p9', name: 'Paused project', status: 'on_hold', is_archived: false } })
  const row = (m, open = true) => ({ milestone: { id: m.id, name: m.name, status: m.status },
    project: { id: m.project.id, name: m.project.name, status: m.project.status }, open })

  test('shows where this week\'s timesheet lists the row open, on the Now card and the row', async () => {
    serve({ milestones: [design, paused], comingUp: [], rows: [row(design), row(paused, false)] })
    const focus = await openPage()
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(await within(now).findByRole('button', { name: 'Start timer on Design' })).toBeInTheDocument()
    const inProgress = region(/^In progress/)
    expect(within(inProgress).getByRole('button', { name: 'Start timer on Design' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start timer on Paused review' })).not.toBeInTheDocument()
  })

  test('none on the Now milestone when its project is on hold', async () => {
    serve({ milestones: [paused], comingUp: [], rows: [row(paused, false)] })
    const answered = []
    server.events.on('response:mocked', ({ request }) => answered.push(new URL(request.url).pathname))
    const focus = await openPage()
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(within(now).getByRole('heading', { level: 3, name: 'Paused review' })).toBeInTheDocument()
    await waitFor(() => expect(answered).toContain(`${API}/time-entries`))
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(screen.queryByRole('button', { name: /^Start timer on/ })).not.toBeInTheDocument()
  })

  test('an Upcoming milestone the timesheet lists open has Start too; one it does not list has none', async () => {
    serve({ milestones: [design, hypercare, review], comingUp: [], rows: [row(design), row(hypercare)] })
    await openPage()
    const upcoming = region(/^Upcoming/)
    expect(await within(upcoming).findByRole('button', { name: 'Start timer on Hypercare' })).toBeInTheDocument()
    expect(within(upcoming).queryByRole('button', { name: 'Start timer on Review' })).not.toBeInTheDocument()
    // The chips stay as they were: the due line, the state and the label, no priority or difficulty.
    const [first] = rowsOf(upcoming)
    expect(within(first).getByText('Ready to start')).toBeInTheDocument()
    expect(within(first).queryByLabelText(/^Difficulty/)).not.toBeInTheDocument()
  })

  test('Start is a 44 px touch target on the Now card and the rows', async () => {
    serve({ milestones: [design, hypercare], comingUp: [], rows: [row(design), row(hypercare)] })
    const focus = await openPage()
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(await within(now).findByRole('button', { name: 'Start timer on Design' })).toHaveStyle({ minHeight: '44px' })
    expect(within(region(/^In progress/)).getByRole('button', { name: 'Start timer on Design' })).toHaveStyle({ minHeight: '44px' })
    expect(within(region(/^Upcoming/)).getByRole('button', { name: 'Start timer on Hypercare' })).toHaveStyle({ minHeight: '44px' })
  })

  test('none on a completed milestone', async () => {
    const finished = doneMs('m12', 'Finished design', '2026-10-09')
    serve({ milestones: [design, finished], comingUp: [], rows: [row(design), row(finished)] })
    await openPage()
    expect(await screen.findAllByRole('button', { name: 'Start timer on Design' })).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Start timer on Finished design' })).not.toBeInTheDocument()
  })
})

describe('Available to claim', () => {
  test('lists ready milestones nobody owns, with a count; Claim takes one', async () => {
    const claimed = []
    serve()
    server.use(http.post(`${API}/milestones/m7/claim`, () => { claimed.push('m7'); return HttpResponse.json(claimable) }))
    await openPage()
    expect(await screen.findByRole('heading', { level: 2, name: 'Available to claim · 1' })).toBeInTheDocument()
    const claim = region(/^Available to claim/)
    expect(within(claim).getByText('Build pipeline')).toBeInTheDocument()
    expect(within(claim).queryByText('Taken already')).not.toBeInTheDocument()
    await userEvent.setup().click(within(claim).getByRole('button', { name: 'Claim Build pipeline' }))
    await waitFor(() => expect(claimed).toEqual(['m7']))
  })

  test('Claim is a 44 px touch target', async () => {
    serve()
    await openPage()
    expect(await within(region(/^Available to claim/)).findByRole('button', { name: 'Claim Build pipeline' }))
      .toHaveStyle({ minHeight: '44px' })
  })

  test('with nothing to claim it says so', async () => {
    serve({ claim: [taken] })
    await openPage()
    expect(await screen.findByRole('heading', { level: 2, name: 'Available to claim · 0' })).toBeInTheDocument()
    expect(within(region(/^Available to claim/)).getByText('No unassigned milestones available right now.')).toBeInTheDocument()
  })
})

describe('nothing at all', () => {
  test('with no milestones and nothing coming, Your focus holds the empty state and no group shows', async () => {
    serve({ milestones: [], comingUp: [] })
    const focus = await openPage()
    expect(within(focus).getByText('Nothing assigned to you right now')).toBeInTheDocument()
    expect(within(focus).getByText('Milestones your manager gives you, or that you claim, show up here.')).toBeInTheDocument()
    expect(within(focus).queryByRole('group', { name: 'Now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /^(In progress|Upcoming|Completed)/ })).not.toBeInTheDocument()
  })
})

describe('privacy', () => {
  test('an employee session asks only for their own data, never approvals or allocations', async () => {
    const seen = []
    server.events.on('request:start', ({ request }) => seen.push(new URL(request.url)))
    serve({ discussion: 200 })
    await openPage()
    await screen.findByRole('heading', { level: 2, name: 'Available to claim · 1' })
    await waitFor(() => expect(seen.some((u) => u.pathname === `${API}/conversations`)).toBe(true))
    await waitFor(() => expect(seen.some((u) => u.pathname === `${API}/time-entries`)).toBe(true))
    const paths = seen.map((u) => u.pathname.replace(API, ''))
    for (const path of paths.filter((p) => p.startsWith('/users/'))) expect(path.split('/')[2]).toBe('u-emp')
    expect(paths.filter((p) => p.startsWith('/approvals') || p.startsWith('/allocations'))).toEqual([])
    for (const u of seen.filter((x) => x.pathname.startsWith(`${API}/time-entries`))) expect(u.searchParams.has('user')).toBe(false)
  })
})


describe('the critical details are bold', () => {
  test('lateness, the urgent priority and waiting: "10 days overdue", "Critical priority", "1 overdue", "Waiting on …"', async () => {
    serve()
    const focus = await openPage()
    expect(bold(focus)).toEqual(['1 overdue', '10 days overdue', 'Critical priority', 'High priority'])
    const inProgress = rowsOf(region(/^In progress/))
    expect(bold(inProgress[0])).toEqual(['10 days overdue', 'Critical Priority'])
    const upcoming = rowsOf(region(/^Upcoming/))
    expect(bold(upcoming[2])).toEqual(['Waiting on dependencies', 'Waiting on Load testing'])
    // The heads-up names an urgent prediction's priority in bold too.
    expect(bold(within(focus).getByRole('button', { name: 'Heads-up: Data cutover (High priority) may come your way' })))
      .toEqual(['High priority'])
  })

  test('a milestone due today has its due line in bold, on the Now card and its row, also late in the New York evening', async () => {
    // 22:00 on Oct 15 in New York: the UTC date is already Oct 16, but it is still due today, not a day late.
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z'))
    const goLive = ms('m11', 'Go-live', { status: 'in_progress', display_status: 'in_progress', priority: 'medium',
      end_date: '2026-10-15', project: apollo })
    serve({ milestones: [goLive, hypercare] })
    const focus = await openPage()
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(within(now).getByRole('heading', { level: 3, name: 'Go-live' })).toBeInTheDocument()
    expect(bold(now)).toEqual(['Due Oct 15, 2026'])
    expect(bold(rowsOf(region(/^In progress/))[0])).toEqual(['Due Oct 15, 2026'])
    expect(within(focus).queryByText(/overdue/)).not.toBeInTheDocument()
  })

  test('normal details stay regular: the due date alone, normal states, Ready to start and Medium priority', async () => {
    serve()
    await openPage()
    const upcoming = rowsOf(region(/^Upcoming/))
    expect(bold(upcoming[0])).toEqual([])
    const coming = rowsOf(region(/^Might come your way/))
    expect(within(coming[1]).getByLabelText('Priority: Medium')).toBeInTheDocument()
    expect(bold(coming[1])).toEqual([])
    expect(bold(coming[0])).toEqual(['High Priority'])
    expect(bold(region(/^Completed/))).toEqual([])
  })
})
