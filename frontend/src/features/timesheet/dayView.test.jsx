import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const MON = WEEK
const TUE = '2026-10-13'
const WED = '2026-10-14'
const NOTE = 'Mapped the legacy address fields'
const rows = [
  { milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
  { milestone: { id: 'm2', name: 'Build', status: 'in_progress' }, project: { id: 'p2', name: 'Atlas', status: 'active' }, open: true },
]
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: MON, hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: '', label: 'Pending approval', ...overrides })

function sheetWith({ sheetRows = rows, entries = [], extra = {} } = {}) {
  return http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK,
    user: { id: users.employee.id, name: 'Eli Employee' }, rows: sheetRows, entries,
    totals: { logged: entries.reduce((s, e) => s + (e.status === 'rejected' ? 0 : e.hours), 0), approved: 0 }, ...extra }))
}
const saved = () => HttpResponse.json({ week_start: WEEK, rows, entries: [], totals: { logged: 0, approved: 0 },
  user: { id: users.employee.id, name: 'Eli Employee' } })

const renderSheet = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />,
  { user: users.employee, route, path: '/timesheet' })
const dayButton = (name) => screen.getByRole('button', { name })
const completed = (row) => ({ ...row, milestone: { ...row.milestone, status: 'completed' } })
// A timer draft of 2.5h on Schema Mapping on Tuesday, stopped without a note.
const timerDraft = { totals: { logged: 0, approved: 0, draft: 2.5 }, drafts: [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, note: '' }],
  locks: [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, draft_hours: 2.5, tracked_hours: 0, request: null }] }

// "Today" is Wednesday 14 Oct 2026 for every test here; only Date is faked, so timers and requests run normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0))
  server.use(sheetWith())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Timesheet day view', () => {
  test('opens on today for the current week and on Monday for other weeks', async () => {
    renderSheet()
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(dayButton('Wed 14 Oct, 0h')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Wednesday 14 October 2026' })).toBeInTheDocument()
  })

  test('opens on Monday for any other week', async () => {
    renderSheet('/timesheet?week=2026-10-05')
    expect(await screen.findByLabelText('Schema Mapping, Mon Oct 5')).toBeInTheDocument()
    expect(dayButton('Mon 5 Oct, 0h')).toHaveAttribute('aria-pressed', 'true')
    expect(dayButton('Wed 7 Oct, 0h')).toHaveAttribute('aria-pressed', 'false')
  })

  test.each([
    ['not a date', `?week=${WEEK}&day=banana`, 'Wed 14 Oct, 0h'],
    ['outside the week', `?week=${WEEK}&day=2026-10-20`, 'Wed 14 Oct, 0h'],
    ['outside another week', '?week=2026-10-05&day=2026-10-12', 'Mon 5 Oct, 0h'],
  ])('a bad or out-of-week ?day= falls back to the default day (%s)', async (_, search, selected) => {
    renderSheet(`/timesheet${search}`)
    expect(await screen.findByRole('button', { name: selected })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { pressed: true, name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ Oct, / })).toHaveLength(1)
  })

  test('a good ?day= opens that day', async () => {
    renderSheet(`/timesheet?week=${WEEK}&day=${TUE}`)
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toBeInTheDocument()
    expect(dayButton('Tue 13 Oct, 0h')).toHaveAttribute('aria-pressed', 'true')
  })

  test("the strip shows each day's total and marks a day over the cap", async () => {
    server.use(sheetWith({ entries: [entry({ id: 'e1', work_date: MON, hours: 3 }), entry({ id: 'e2', work_date: WED, hours: 6 })] }))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Wed 14 Oct, 6h' })).toHaveAttribute('data-over', 'false')
    expect(dayButton('Mon 12 Oct, 3h')).toBeInTheDocument()
    expect(dayButton('Tue 13 Oct, 0h')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ Oct, / })).toHaveLength(7)
    expect(screen.getByTestId('week-total')).toHaveTextContent('9h counted of 40h')
    await user.type(screen.getByLabelText('Build, Wed Oct 14'), '20')
    expect(dayButton('Wed 14 Oct, 26h, over 24h')).toHaveAttribute('data-over', 'true')
    expect(dayButton('Mon 12 Oct, 3h')).toHaveAttribute('data-over', 'false')
  })

  test('typing hours and a note for two days submits one PUT with both entries', async () => {
    let puts = 0
    let body = null
    server.use(http.put(`${API}/time-entries`, async ({ request }) => {
      puts += 1
      body = await request.json()
      return saved()
    }))
    renderSheet()
    const user = userEvent.setup()
    const submit = await screen.findByRole('button', { name: 'Submit' })
    expect(submit).toBeDisabled()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.type(screen.getByLabelText('Work note, Schema Mapping'), NOTE)
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    await user.click(dayButton('Mon 12 Oct, 0h'))
    await user.type(screen.getByLabelText('Build, Mon Oct 12'), '2')
    await user.type(screen.getByLabelText('Work note, Build'), 'Wired the settings form')
    // Switching days kept the Wednesday edit.
    expect(dayButton('Wed 14 Oct, 6h')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit 2 changes' }))
    await waitFor(() => expect(puts).toBe(1))
    expect(body.week).toBe(WEEK)
    expect(body.entries).toHaveLength(2)
    expect(body.entries).toEqual(expect.arrayContaining([
      { milestone_id: 'm1', work_date: WED, hours: 6, note: NOTE },
      { milestone_id: 'm2', work_date: MON, hours: 2, note: 'Wired the settings form' },
    ]))
  })

  test('hours without a note mark the row and the PROOF_REQUIRED error names the day with a link to it', async () => {
    server.use(http.put(`${API}/time-entries`, () => HttpResponse.json({ error: {
      code: 'PROOF_REQUIRED', message: 'Add a work note (10-500 characters) or post a progress update that day for: ...',
      details: { cells: [
        { milestone_id: 'm1', milestone: 'Schema Mapping', work_date: WED, reason: 'no_note' },
        { milestone_id: 'm2', milestone: 'Build', work_date: MON, reason: 'note_too_short' }] },
      request_id: 'r1' } }, { status: 400 })))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    const row = screen.getByLabelText('Work note, Schema Mapping').closest('li')
    expect(row).toHaveAttribute('data-attention', 'true')
    expect(within(row).getByText(/needed/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Work note, Build').closest('li')).not.toHaveAttribute('data-attention')
    await user.click(dayButton('Mon 12 Oct, 0h'))
    await user.type(screen.getByLabelText('Build, Mon Oct 12'), '2')
    await user.click(screen.getByRole('button', { name: 'Submit 2 changes' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Add a work note before saving')
    expect(alert).toHaveTextContent('(note too short)')
    const link = within(alert).getByRole('link', { name: 'Schema Mapping, Wed Oct 14' })
    await user.click(link)
    expect(screen.getByTestId('location')).toHaveTextContent(`day=${WED}`)
    expect(dayButton('Wed 14 Oct, 6h')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Work note, Schema Mapping').closest('li')).toHaveAttribute('data-attention', 'true')
  })

  test('a note shorter than 10 characters is flagged', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Work note, Build'), 'too short')
    expect(screen.getByLabelText('Work note, Build')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument()
    expect(screen.getByText(/9\/500/)).toBeInTheDocument()
  })

  test('timer hours show locked with Request a change', async () => {
    server.use(sheetWith({ extra: { totals: { logged: 0, approved: 0, draft: 2.5 },
      drafts: [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, note: NOTE }],
      locks: [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, draft_hours: 2.5, tracked_hours: 0, request: null }] } }))
    renderSheet(`/timesheet?week=${WEEK}&day=${TUE}`)
    const user = userEvent.setup()
    const cell = await screen.findByRole('group', { name: 'Schema Mapping, Tue Oct 13: 2.5h, locked timer hours' })
    expect(cell).toHaveTextContent('2.5h')
    expect(screen.queryByLabelText('Schema Mapping, Tue Oct 13')).not.toBeInTheDocument() // nothing to type into
    expect(screen.getByLabelText('Work note, Schema Mapping')).toHaveValue(NOTE) // the stop's note pre-fills it
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Request a change, Schema Mapping, Tue Oct 13' }))
    expect(await screen.findByRole('dialog', { name: 'Request a change' })).toBeInTheDocument()
  })

  test('a completed milestone is hidden behind "Show 1 closed milestone" and has no Start button', async () => {
    server.use(sheetWith({ sheetRows: [
      { ...rows[0], milestone: { ...rows[0].milestone, status: 'completed' } }, rows[1]] }))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Start timer on Build' })).toBeInTheDocument() // today, open milestone
    expect(screen.queryByLabelText('Schema Mapping, Wed Oct 14')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show 1 closed milestone' }))
    // Logging earlier days on a completed milestone is allowed (as in the week grid), so shown it is editable.
    expect(screen.getByLabelText('Schema Mapping, Wed Oct 14')).toBeEnabled()
    expect(screen.getByLabelText('Work note, Schema Mapping')).toBeEnabled()
    expect(screen.getByText(/milestone completed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start timer on Schema Mapping' })).not.toBeInTheDocument()
  })

  test('an expanded completed milestone accepts hours and a note and submits them', async () => {
    let body = null
    server.use(sheetWith({ sheetRows: [
      { ...rows[0], milestone: { ...rows[0].milestone, status: 'completed' } }, rows[1]] }),
    http.put(`${API}/time-entries`, async ({ request }) => { body = await request.json(); return saved() }))
    renderSheet()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Show 1 closed milestone' }))
    // Three keystrokes: the row must not move or remount (losing focus) as the first one makes it a change.
    await user.type(screen.getByLabelText('Schema Mapping, Wed Oct 14'), '7.5')
    expect(screen.getByLabelText('Schema Mapping, Wed Oct 14')).toHaveValue('7.5')
    await user.type(screen.getByLabelText('Work note, Schema Mapping'), NOTE)
    // Hiding the closed rows keeps the edited one in view.
    await user.click(screen.getByRole('button', { name: 'Hide 1 closed milestone' }))
    expect(screen.getByLabelText('Schema Mapping, Wed Oct 14')).toHaveValue('7.5')
    expect(screen.queryByRole('button', { name: /closed milestone/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WED, hours: 7.5, note: NOTE }] }))
  })

  test('a timer draft with no note on a completed milestone shows its row without expanding, and the PROOF_REQUIRED link reaches a visible note box', async () => {
    server.use(sheetWith({ sheetRows: [completed(rows[0]), rows[1]], extra: timerDraft }),
      http.put(`${API}/time-entries`, () => HttpResponse.json({ error: { code: 'PROOF_REQUIRED', message: 'Add a work note',
        details: { cells: [{ milestone_id: 'm1', milestone: 'Schema Mapping', work_date: TUE, reason: 'no_note' }] }, request_id: 'r1' } },
      { status: 400 })))
    renderSheet(`/timesheet?week=${WEEK}&day=${TUE}`)
    const user = userEvent.setup()
    const row = (await screen.findByLabelText('Work note, Schema Mapping')).closest('li')
    expect(row).toHaveAttribute('data-attention', 'true')
    expect(screen.queryByRole('button', { name: /closed milestone/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    const alert = (await screen.findByText('Add a work note before saving')).closest('[role=alert]')
    await user.click(dayButton('Wed 14 Oct, 0h'))
    // On a day where the completed milestone holds nothing it is tucked away again.
    expect(screen.queryByLabelText('Work note, Schema Mapping')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show 1 closed milestone' })).toBeInTheDocument()
    await user.click(within(alert).getByRole('link', { name: 'Schema Mapping, Tue Oct 13' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`day=${TUE}`)
    expect(screen.getByLabelText('Work note, Schema Mapping')).toBeVisible()
    expect(screen.queryByRole('button', { name: /closed milestone/ })).not.toBeInTheDocument()
  })

  test('a rejected entry on a completed milestone shows its row without expanding', async () => {
    server.use(sheetWith({ sheetRows: [completed(rows[0]), rows[1]], entries: [entry({ id: 'e3', work_date: WED, hours: 6,
      status: 'rejected', label: 'Rejected', rejection_reason: 'Wrong milestone' })] }))
    renderSheet()
    expect(await screen.findByRole('button', { name: 'Resubmit Schema Mapping, Wed Oct 14' })).toBeInTheDocument()
    expect(screen.getByLabelText('Work note, Schema Mapping')).toBeVisible()
    expect(screen.queryByRole('button', { name: /closed milestone/ })).not.toBeInTheDocument()
  })

  test('milestones of a project on hold are closed and the Start button only shows on today', async () => {
    server.use(sheetWith({ sheetRows: [rows[0],
      { ...rows[1], project: { ...rows[1].project, status: 'on_hold' }, open: false }] }))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Start timer on Schema Mapping' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Build, Wed Oct 14')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show 1 closed milestone' }))
    expect(screen.getByLabelText('Build, Wed Oct 14')).toBeDisabled()
    expect(screen.getByLabelText('Work note, Build')).toBeDisabled()
    expect(screen.getByText('Project on hold — logging paused')).toBeInTheDocument()
    await user.click(dayButton('Tue 13 Oct, 0h'))
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toBeEnabled()
    expect(screen.queryByRole('button', { name: /start timer/i })).not.toBeInTheDocument()
  })

  test('milestones are grouped under their project only when there is more than one project', async () => {
    renderSheet()
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Apollo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
  })

  test('a single project is named on its rows instead', async () => {
    server.use(sheetWith({ sheetRows: [rows[0], { ...rows[1], project: rows[0].project }] }))
    renderSheet()
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Apollo' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Apollo')).toHaveLength(2)
  })

  test('a supporting row shows a Supporting chip', async () => {
    server.use(sheetWith({ sheetRows: [rows[0], { ...rows[1], role: 'supporting' }] }))
    renderSheet()
    const build = (await screen.findByLabelText('Work note, Build')).closest('li')
    expect(within(build).getByText('Supporting')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Work note, Schema Mapping').closest('li')).queryByText('Supporting')).not.toBeInTheDocument()
  })

  test('a rejected entry shows its reason and Resubmit', async () => {
    let body = null
    server.use(sheetWith({ entries: [entry({ id: 'e3', work_date: WED, hours: 6, status: 'rejected', label: 'Rejected',
      rejection_reason: 'Wrong milestone' })] }),
    http.put(`${API}/time-entries`, async ({ request }) => { body = await request.json(); return saved() }))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByText(/Reason: wrong milestone/i)).toBeInTheDocument()
    const row = screen.getByLabelText('Work note, Schema Mapping').closest('li')
    expect(within(row).getByText('Needs revision')).toBeInTheDocument()
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Resubmit Schema Mapping, Wed Oct 14' }))
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WED, hours: 6 }] }))
  })

  test('hours past the day cap show the cap error and disable Submit', async () => {
    renderSheet()
    const user = userEvent.setup()
    const hours = await screen.findByLabelText('Schema Mapping, Wed Oct 14')
    await user.type(hours, '25')
    expect(await screen.findByText('More than 24h on Wed Oct 14')).toBeInTheDocument()
    expect(hours).toHaveAttribute('aria-invalid', 'true')
    expect(dayButton('Wed 14 Oct, 25h, over 24h')).toHaveAttribute('data-over', 'true')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeDisabled()
    await user.clear(hours)
    await user.type(hours, '8')
    expect(screen.queryByText(/more than 24h/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
  })

  test('the cap error on another day links to it', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '25')
    await user.click(dayButton('Mon 12 Oct, 0h'))
    await user.click(await screen.findByRole('link', { name: 'Go to Wed Oct 14' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`day=${WED}`)
    expect(dayButton('Wed 14 Oct, 25h, over 24h')).toHaveAttribute('aria-pressed', 'true')
  })

  test('a value under 0.25 on another day is listed with a link to it', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Mon 12 Oct, 0h' }))
    await user.type(screen.getByLabelText('Build, Mon Oct 12'), '0.1')
    await user.click(dayButton('Wed 14 Oct, 0h'))
    const alert = screen.getByText(/at least 0.25 hours/i).closest('[role=alert]')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeDisabled()
    await user.click(within(alert).getByRole('link', { name: 'Build, Mon Oct 12' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`day=${MON}`)
    expect(dayButton('Mon 12 Oct, 0.1h')).toHaveAttribute('aria-pressed', 'true')
  })

  test('the timer-hours refusal links each cell to its day', async () => {
    server.use(http.put(`${API}/time-entries`, () => HttpResponse.json({ error: {
      code: 'TIMER_HOURS_LOCKED', message: "Timer hours can't be edited",
      details: { cells: [{ milestone_id: 'm1', milestone: 'Schema Mapping', work_date: TUE, hours: 2.5, sent: 1 }] } } },
    { status: 409 })))
    renderSheet(`/timesheet?week=${WEEK}&day=${TUE}`)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Tue Oct 13'), '1')
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    const alert = (await screen.findByText("Timer hours can't be edited")).closest('[role=alert]')
    expect(alert).toHaveTextContent('Schema Mapping, Tue Oct 13 — use Request a change on those cells instead.')
    await user.click(dayButton('Wed 14 Oct, 0h'))
    await user.click(within(alert).getByRole('link', { name: 'Schema Mapping, Tue Oct 13' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`day=${TUE}`)
    expect(dayButton('Tue 13 Oct, 1h')).toHaveAttribute('aria-pressed', 'true')
  })

  test("a week change from a link leaves the old week's edits out of Submit and brings them back on return", async () => {
    let body = null
    server.use(sheetWith({ extra: { ...timerDraft, drafts: [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, note: NOTE }] } }),
      http.put(`${API}/time-entries`, async ({ request }) => { body = await request.json(); return saved() }))
    renderAsUser(<>
      <TimesheetPage />
      <Link to="/timesheet?week=2026-10-05">Elsewhere</Link>
      <Link to={`/timesheet?week=${WEEK}`}>Back here</Link>
    </>, { user: users.employee, route: `/timesheet?week=${WEEK}`, path: '/timesheet' })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Wed Oct 14'), '6')
    await user.type(screen.getByLabelText('Work note, Build'), NOTE)
    expect(screen.getByRole('button', { name: 'Submit 2 changes' })).toBeEnabled() // the timer draft and the typed hours
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(await screen.findByLabelText('Build, Mon Oct 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled() // nothing changed in this week
    await user.type(screen.getByLabelText('Build, Mon Oct 5'), '2')
    await user.type(screen.getByLabelText('Work note, Build'), 'Wired the settings form')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    await user.click(screen.getByRole('link', { name: 'Back here' }))
    expect(await screen.findByLabelText('Build, Wed Oct 14')).toHaveValue('6')
    await user.click(screen.getByRole('button', { name: 'Submit 2 changes' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.week).toBe(WEEK)
    expect(body.entries.map((e) => e.work_date).sort()).toEqual([TUE, WED])
  })

  test('This week while already on this week just opens today, with no discard question', async () => {
    renderSheet(`/timesheet?week=${WEEK}&day=${MON}`)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Mon Oct 12'), '4')
    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`day=${WED}`)
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(dayButton('Mon 12 Oct, 4h')).toBeInTheDocument() // the edit is still there
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
  })

  test('a note on a row with no hours says it needs hours', async () => {
    renderSheet()
    const user = userEvent.setup()
    await screen.findByLabelText('Work note, Build')
    expect(screen.queryByText(/add hours to save this note/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Work note, Build'), 'Waiting on the vendor reply')
    expect(screen.getByText(/add hours to save this note/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled() // a note alone has nothing to save
    await user.type(screen.getByLabelText('Build, Wed Oct 14'), '2')
    expect(screen.queryByText(/add hours to save this note/i)).not.toBeInTheDocument()
  })

  test('a note typed on a row with no hours survives a submit of other rows', async () => {
    let body = null
    server.use(http.put(`${API}/time-entries`, async ({ request }) => { body = await request.json(); return saved() }))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Work note, Build'), 'Waiting on the vendor reply')
    await user.type(screen.getByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.type(screen.getByLabelText('Work note, Schema Mapping'), NOTE)
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WED, hours: 6, note: NOTE }] }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled())
    expect(screen.getByLabelText('Work note, Build')).toHaveValue('Waiting on the vendor reply')
    expect(screen.getByText(/add hours to save this note/i)).toBeInTheDocument()
  })

  test('the hours field has a visible Hours label and keeps its accessible name', async () => {
    renderSheet()
    expect(await screen.findByRole('textbox', { name: 'Schema Mapping, Wed Oct 14' })).toBeInTheDocument()
    expect(screen.getAllByText('Hours', { selector: 'label' })).toHaveLength(2) // one per row
  })

  test('leaving the page with unsaved changes asks the browser to warn, and stops asking once they are gone', async () => {
    const leaving = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    const view = renderSheet()
    const user = userEvent.setup()
    const hours = await screen.findByLabelText('Schema Mapping, Wed Oct 14')
    expect(leaving()).toBe(false)
    await user.type(hours, '6')
    expect(leaving()).toBe(true)
    await user.clear(hours)
    expect(leaving()).toBe(false)
    await user.type(hours, '6')
    expect(leaving()).toBe(true)
    view.unmount()
    expect(leaving()).toBe(false)
  })

  test("the server's 24h refusal links to its day", async () => {
    server.use(http.put(`${API}/time-entries`, () => HttpResponse.json({ error: { code: 'DAY_OVER_24H',
      message: "More than 24h on Wed 14 Oct (26h across your milestones). A day can't go over 24 hours.",
      details: { work_date: WED, hours: 26 }, request_id: 'r-24' } }, { status: 400 })))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Wed Oct 14'), '4')
    await user.click(dayButton('Mon 12 Oct, 0h'))
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('More than 24h on Wed 14 Oct (26h across your milestones)')
    await user.click(within(alert).getByRole('link', { name: 'Go to Wed Oct 14' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`day=${WED}`)
    expect(dayButton('Wed 14 Oct, 4h')).toHaveAttribute('aria-pressed', 'true')
  })

  test('changing week with unsaved edits asks to discard them', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.click(screen.getByRole('button', { name: /next week/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard 1 unsaved change?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('location')).toHaveTextContent(`week=${WEEK}`)
    expect(screen.getByLabelText('Schema Mapping, Wed Oct 14')).toHaveValue('6')
    await user.click(screen.getByRole('button', { name: /next week/i }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Discard 1 unsaved change?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByLabelText('Schema Mapping, Mon Oct 19')).toHaveValue('')
    expect(screen.getByTestId('location')).toHaveTextContent('week=2026-10-19')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  test('the Day/Week choice is remembered', async () => {
    const first = renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Timesheet view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(await screen.findByRole('table', { name: 'Timesheet for the week of Oct 12, 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Days of the week' })).not.toBeInTheDocument()
    expect(localStorage.getItem('overwatch.timesheet.view')).toBe('week')
    first.unmount()
    renderSheet()
    expect(await screen.findByRole('table', { name: 'Timesheet for the week of Oct 12, 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Day' }))
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(localStorage.getItem('overwatch.timesheet.view')).toBe('day')
  })

  test('a blocked localStorage still renders the Day view', async () => {
    const blocked = () => { throw new Error('storage is blocked') }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(await screen.findByRole('table', { name: 'Timesheet for the week of Oct 12, 2026' })).toBeInTheDocument()
  })
})

describe('Day view status words', () => {
  test('an over-40 pending entry reads Pending and Overtime, not the server label', async () => {
    server.use(sheetWith({ entries: [entry({ id: 'e4', work_date: WED, over_40: true, label: 'Pending (Overtime requested from Eli Employee)' })] }))
    renderSheet()
    const row = (await screen.findByLabelText('Work note, Schema Mapping')).closest('li')
    expect(within(row).getByText('Pending')).toBeInTheDocument()
    expect(within(row).getByText('Overtime')).toBeInTheDocument()
    expect(screen.queryByText(/Overtime requested from/)).not.toBeInTheDocument()
  })

  test('Edited and the source chip stay', async () => {
    server.use(sheetWith({ entries: [entry({ id: 'e5', work_date: WED, edited_after_decision: true, source: 'manual' })] }))
    renderSheet()
    expect(await screen.findByText('Edited')).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })
})
