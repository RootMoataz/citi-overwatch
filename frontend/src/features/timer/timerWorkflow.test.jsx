import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import ChangeRequests from '../timesheets/ChangeRequests.jsx'
import TimesheetPage from '../timesheet/TimesheetPage.jsx'
import LiveTimersCard from './LiveTimersCard.jsx'
import TimerChip from './TimerChip.jsx'
import TimerLimitBanner from './TimerLimitBanner.jsx'
import { formatDuration, limitLevel, weekdayName, worstLevel } from './timerClock.js'

const WEEK = '2026-10-12'
const TUE = '2026-10-13'
const rows = [
  { milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' } },
  { milestone: { id: 'm2', name: 'Build' }, project: { id: 'p2', name: 'Atlas' } },
]
const NOTE = 'Mapped the legacy address fields'

function weekWithDraft({ request = null, entries = [], locks } = {}) {
  return http.get(`${API}/time-entries`, () => HttpResponse.json({
    week_start: WEEK, user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries,
    totals: { logged: entries.reduce((s, e) => s + e.hours, 0), approved: 0, draft: 2.5 },
    drafts: [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, note: NOTE }],
    locks: locks ?? [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, draft_hours: 2.5, tracked_hours: 0, request }],
  }))
}
const renderSheet = () => renderAsUser(<TimesheetPage />, { user: users.employee, route: `/timesheet?week=${WEEK}`, path: '/timesheet' })

describe('limits on the screen', () => {
  test('a limit turns to warning at warn_at and over at over_at, on the server clock', () => {
    const limit = { warn_at: '2026-10-14T15:00:00Z', over_at: '2026-10-14T17:00:00Z' }
    expect(limitLevel(limit, Date.parse('2026-10-14T14:59:59Z'))).toBe('ok')
    expect(limitLevel(limit, Date.parse('2026-10-14T15:00:00Z'))).toBe('warning')
    expect(limitLevel(limit, Date.parse('2026-10-14T17:00:00Z'))).toBe('over')
    expect(worstLevel([limit, { warn_at: '2026-10-14T10:00:00Z', over_at: '2026-10-14T11:00:00Z' }],
      Date.parse('2026-10-14T16:00:00Z'))).toBe('over')
    expect(worstLevel([], Date.now())).toBe('ok')
  })

  test('durations and weekdays read naturally', () => {
    expect(formatDuration(80 * 60)).toBe('1h 20m')
    expect(formatDuration(45 * 60 + 30)).toBe('45m')
    expect(weekdayName(TUE)).toBe('Tuesday')
  })
})

describe('timesheet: timer drafts are pre-filled, locked and submitted with the Submit button', () => {
  // These tests drive the week grid; the day view has its own in dayView.test.jsx.
  beforeEach(() => { localStorage.setItem('overwatch.timesheet.view', 'week') })

  test('the cell shows saved + timer hours, read-only, with the banner', async () => {
    server.use(weekWithDraft())
    renderSheet()
    const cell = await screen.findByRole('group', { name: 'Schema Mapping, Tue Oct 13: 2.5h, locked timer hours' })
    expect(cell).toHaveTextContent('2.5h')
    expect(screen.queryByLabelText('Schema Mapping, Tue Oct 13')).not.toBeInTheDocument() // no input to type in
    expect(screen.getByText('from timer, not submitted yet')).toBeInTheDocument()
    expect(screen.getByTestId('timer-draft-banner')).toHaveTextContent(
      'You have 2.5h of timer time not submitted yet — Save week to submit.')
    expect(screen.getByTestId('week-total')).toHaveTextContent('2.5h / 40h') // drafts count toward the live warnings
    await userEvent.hover(cell)
    expect(await screen.findByRole('tooltip')).toHaveTextContent("Timer hours can't be edited — request a change")
    // Other cells stay editable.
    expect(screen.getByLabelText('Build, Tue Oct 13')).toBeEnabled()
  })

  test('Submit sends the draft with the timer note', async () => {
    let body = null
    server.use(weekWithDraft(), http.put(`${API}/time-entries`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ week_start: WEEK, rows, entries: [], drafts: [], locks: [], totals: { logged: 2.5, approved: 0, draft: 0 } })
    }))
    renderSheet()
    const save = await screen.findByRole('button', { name: /^submit/i })
    await waitFor(() => expect(save).toBeEnabled())
    await userEvent.click(save)
    await waitFor(() => expect(body).toEqual({ week: WEEK,
      entries: [{ milestone_id: 'm1', work_date: TUE, hours: 2.5, note: NOTE }] }))
  })

  test('Request a change sends the hours and the reason', async () => {
    let body = null
    server.use(weekWithDraft(), http.post(`${API}/time-edit-requests`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 'r1', status: 'pending' }, { status: 201 })
    }))
    renderSheet()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Request a change, Schema Mapping, Tue Oct 13' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request a change' })
    const send = within(dialog).getByRole('button', { name: 'Send request' })
    await user.type(within(dialog).getByLabelText(/hours you want instead/i), '2.5')
    expect(within(dialog).getByText('That is what the cell holds already')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText(/hours you want instead/i))
    await user.type(within(dialog).getByLabelText(/hours you want instead/i), '1.5')
    await user.type(within(dialog).getByLabelText(/why/i), 'too short')
    expect(send).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/why/i), ' — it ran over lunch')
    await user.click(send)
    await waitFor(() => expect(body).toEqual({ milestone_id: 'm1', work_date: TUE, requested_hours: '1.5',
      reason: 'too short — it ran over lunch' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('a cell with a pending request shows it instead of the button', async () => {
    server.use(weekWithDraft({ request: { id: 'r1', requested_hours: 1.5, reason: 'Ran over lunch', status: 'pending' } }))
    renderSheet()
    expect(await screen.findByText('Change requested: 1.5h')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request a change/i })).not.toBeInTheDocument()
  })

  test("the server's lock refusal is explained", async () => {
    server.use(weekWithDraft({ locks: [] }), http.put(`${API}/time-entries`, () => HttpResponse.json({ error: {
      code: 'TIMER_HOURS_LOCKED', message: "Timer hours can't be edited",
      details: { cells: [{ milestone_id: 'm1', milestone: 'Schema Mapping', work_date: TUE, hours: 2.5, sent: 1 }] } } },
    { status: 409 })))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Tue Oct 13'), '1')
    await user.click(screen.getByRole('button', { name: /^submit/i }))
    const alert = (await screen.findByText("Timer hours can't be edited")).closest('[role=alert]')
    expect(alert).toHaveTextContent('Schema Mapping, Tue Oct 13 — use Request a change on those cells instead.')
  })
})

const changeRequest = (overrides = {}) => ({ id: 'r1', user: { id: 'u-emp', name: 'Eli Employee' },
  milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' }, work_date: TUE, week_start: WEEK,
  current_hours: 6, requested_hours: 4.5, reason: 'I left the timer running over lunch', status: 'pending', can_decide: true,
  ...overrides })

describe('Change requests on Timesheets', () => {
  test('a manager approves with a comment', async () => {
    let posted = null
    let decided = false
    server.use(http.get(`${API}/time-edit-requests`, () => HttpResponse.json(decided ? [] : [changeRequest()])),
      http.post(`${API}/time-edit-requests/r1/approve`, async ({ request }) => {
        posted = await request.json()
        decided = true
        return HttpResponse.json(changeRequest({ status: 'approved' }))
      }))
    renderAsUser(<ChangeRequests />, { user: users.manager })
    const section = await screen.findByRole('region', { name: 'Change requests' })
    expect(within(section).getByText('6h → 4.5h')).toBeInTheDocument()
    expect(within(section).getByText('“I left the timer running over lunch”')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(within(section).getByRole('button', { name: "Approve Eli Employee's change" }))
    const dialog = await screen.findByRole('dialog', { name: /approve eli's change/i })
    await user.type(within(dialog).getByLabelText(/comment for eli/i), 'Fine')
    await user.click(within(dialog).getByRole('button', { name: 'Approve change' }))
    await waitFor(() => expect(posted).toEqual({ comment: 'Fine' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Change requests' })).not.toBeInTheDocument())
  })

  test('a manager rejects without a comment', async () => {
    let posted = null
    server.use(http.get(`${API}/time-edit-requests`, () => HttpResponse.json([changeRequest()])),
      http.post(`${API}/time-edit-requests/r1/reject`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json(changeRequest({ status: 'rejected' }))
      }))
    renderAsUser(<ChangeRequests />, { user: users.manager })
    await userEvent.click(await screen.findByRole('button', { name: "Reject Eli Employee's change" }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reject change' }))
    await waitFor(() => expect(posted).toEqual({}))
  })

  test('nothing shows while no request waits', async () => {
    renderAsUser(<ChangeRequests />, { user: users.manager })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByRole('region', { name: 'Change requests' })).not.toBeInTheDocument()
  })
})

const liveItem = (overrides = {}) => ({ id: 't1', person: { id: 'u-emp', name: 'Eli Employee', first_name: 'Eli' },
  milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' },
  started_at: new Date(Date.now() - 65_000).toISOString(), elapsed_seconds: 65, today_hours: 6, today_used_hours: 6,
  level: 'ok', can_stop: true,
  limits: [{ kind: 'daily', limit_hours: 8, warn_at: new Date(Date.now() + 3_600_000).toISOString(),
    over_at: new Date(Date.now() + 7_200_000).toISOString(), level: 'ok' }], ...overrides })
const live = (items) => http.get(`${API}/timers/live`, () => HttpResponse.json({ now: new Date().toISOString(), items }))

describe('Live now', () => {
  test('each running timer ticks on the screen', async () => {
    server.use(live([liveItem()]))
    renderAsUser(<LiveTimersCard />, { user: users.manager })
    const clock = await screen.findByLabelText(/eli employee's timer: 1:0\d/i)
    const first = clock.textContent
    await waitFor(() => expect(screen.getByLabelText(/eli employee's timer: /i).textContent).not.toBe(first), { timeout: 2500 })
    expect(screen.getByText('1 person is running a timer')).toBeInTheDocument()
    expect(screen.queryByText(/warning/i)).not.toBeInTheDocument()
  })

  test('warning and over chips follow the limits', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    server.use(live([liveItem({ limits: [{ kind: 'daily', limit_hours: 8, warn_at: past, over_at: past }] }),
      liveItem({ id: 't2', person: { id: 'u-2', name: 'Ada Lovelace', first_name: 'Ada' },
        limits: [{ kind: 'milestone', limit_hours: 20, warn_at: past, over_at: new Date(Date.now() + 60_000).toISOString() }] })]))
    renderAsUser(<LiveTimersCard />, { user: users.manager })
    expect(await screen.findByText('Over: 8h day')).toBeInTheDocument()
    expect(screen.getByText('Warning: Estimate')).toBeInTheDocument()
  })

  test('a manager stops a timer with a required message', async () => {
    let posted = null
    server.use(live([liveItem()]), http.post(`${API}/timers/t1/stop-remote`, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ added_hours: 1.25, conversation_id: 'c1', message: 'ok' })
    }))
    renderAsUser(<LiveTimersCard />, { user: users.manager })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: "Stop Eli Employee's timer" }))
    const dialog = await screen.findByRole('dialog', { name: "Stop Eli's timer?" })
    const send = within(dialog).getByRole('button', { name: 'Stop timer and send' })
    await user.type(within(dialog).getByLabelText(/message to eli/i), 'Please')
    expect(send).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/message to eli/i), ' join the review call')
    await user.click(send)
    await waitFor(() => expect(posted).toEqual({ message: 'Please join the review call' }))
    expect(await screen.findByText(/stopped eli's timer — 1.25h went to their timesheet as a draft/i)).toBeInTheDocument()
  })

  test('executives watch without a Stop button; the public demo admin sees it disabled', async () => {
    server.use(live([liveItem({ can_stop: false })]))
    const { unmount } = renderAsUser(<LiveTimersCard />, { user: users.executive })
    await screen.findByLabelText(/eli employee's timer: /i)
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument()
    unmount()
    renderAsUser(<LiveTimersCard />, { user: users.demoAdmin })
    expect(await screen.findByRole('button', { name: "Stop Eli Employee's timer" })).toBeDisabled()
  })
})

const myTimer = { id: 't9', milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' },
  work_date: TUE, started_at: new Date(Date.now() - 3_600_000).toISOString(), stopped_at: null, auto_stopped: false,
  tracked_hours: 0, submitted: false, note: '' }

describe("the employee's own warnings", () => {
  test('a timer at its daily limit shows a banner and a toast once', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const later = new Date(Date.now() + 3_600_000).toISOString()
    server.use(http.get(`${API}/timers/current`, () => HttpResponse.json({ timer: myTimer, now: new Date().toISOString(),
      stopped: null, level: 'warning', unsubmitted: [],
      limits: [{ kind: 'daily', limit_hours: 8, warn_at: past, over_at: later, level: 'warning',
        message: "You've reached your 8h for today on this timer" }] })))
    renderAsUser(<><TimerChip /><TimerLimitBanner /></>, { user: users.employee })
    const banner = (await screen.findByText(/your timer on schema mapping is still running/i)).closest('[role=alert]')
    expect(banner).toHaveTextContent("You've reached your 8h for today on this timer")
    await waitFor(() => expect(screen.getAllByText("You've reached your 8h for today on this timer")).toHaveLength(2))
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)) })
    expect(screen.getAllByText("You've reached your 8h for today on this timer")).toHaveLength(2) // the toast once
  })

  test('timer hours not submitted yet point to the timesheet', async () => {
    server.use(http.get(`${API}/timers/current`, () => HttpResponse.json({ timer: null, now: new Date().toISOString(),
      stopped: null, level: 'ok', limits: [],
      unsubmitted: [{ work_date: TUE, week_start: WEEK, milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1' }, hours: 1.5 }] })))
    renderAsUser(<TimerLimitBanner showUnsubmitted />, { user: users.employee })
    expect(await screen.findByText(/you have 1.5h of timer time not submitted yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open timesheet' })).toHaveAttribute('href', `/timesheet?week=${WEEK}`)
  })
})

describe('the stop dialog', () => {
  test("says the hours go to that day's cell and wait for Save week", async () => {
    server.use(http.get(`${API}/timers/current`, () => HttpResponse.json({ timer: { ...myTimer,
      started_at: new Date(Date.now() - 20 * 60_000).toISOString() }, now: new Date().toISOString(), stopped: null,
    level: 'ok', limits: [], unsubmitted: [] })))
    renderAsUser(<TimerChip />, { user: users.employee })
    await userEvent.click(await screen.findByRole('button', { name: /timer running on schema mapping/i }))
    const dialog = await screen.findByRole('dialog', { name: /stop your timer/i })
    expect(dialog).toHaveTextContent("Stopping now adds 0.25h to Tuesday's cell on your timesheet. It isn't submitted until you Save week there.")
  })
})
