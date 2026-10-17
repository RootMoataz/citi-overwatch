import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { can } from '../../lib/permissions.js'
import TimerButton from './TimerButton.jsx'
import TimerChip from './TimerChip.jsx'
import {
  FLAG_LABEL, clockOffset, elapsedSeconds, formatElapsed, hoursIfStopped, isProofNote, shareText, trackedShare, weekSource,
} from './timerClock.js'

const MS = { id: 'm1', name: 'Schema Mapping' }
const NOW = '2026-10-14T15:00:00.000Z'
const running = (overrides = {}) => ({
  id: 't1', milestone: MS, project: { id: 'p1', name: 'Apollo' }, work_date: '2026-10-14',
  started_at: '2026-10-14T14:58:55.000Z', stopped_at: null, auto_stopped: false, tracked_hours: 0, submitted: false, note: '',
  ...overrides,
})
const current = (timer, stopped = null) => http.get(`${API}/timers/current`,
  () => HttpResponse.json({ timer, now: NOW, stopped }))

function Header({ milestones = [MS] }) {
  return (
    <>
      <TimerChip />
      {milestones.map((m) => <TimerButton key={m.id} milestone={m} />)}
    </>
  )
}

describe('timer arithmetic', () => {
  test('the clock follows the server and never goes below zero', () => {
    const device = Date.parse('2026-10-14T15:00:10Z')
    const offset = clockOffset(NOW, device) // this device runs 10s fast
    expect(offset).toBe(-10000)
    expect(elapsedSeconds('2026-10-14T14:58:55Z', offset, device)).toBe(65)
    expect(elapsedSeconds('2026-10-14T16:00:00Z', 0, device)).toBe(0)
    expect(clockOffset(undefined, device)).toBe(0)
    expect(elapsedSeconds(undefined, 0, device)).toBe(0)
  })

  test('elapsed time reads as m:ss, then h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(3725)).toBe('1:02:05')
  })

  test('a stop logs the nearest quarter hour, nothing under 7.5 minutes', () => {
    expect(hoursIfStopped(7 * 60)).toBe(0)
    expect(hoursIfStopped(7.5 * 60)).toBe(0.25)
    expect(hoursIfStopped(52 * 60)).toBe(0.75)
    expect(hoursIfStopped(53 * 60)).toBe(1)
    expect(hoursIfStopped(30 * 3600)).toBe(24)
  })

  test('a work note counts as proof at 10 to 500 characters, trimmed', () => {
    expect(isProofNote('Fixed bugs')).toBe(true)
    expect(isProofNote('  Fixed bug  ')).toBe(false)
    expect(isProofNote('x'.repeat(501))).toBe(false)
    expect(isProofNote(null)).toBe(false)
  })

  test('the tracked share adds up to 100%', () => {
    expect(trackedShare([{ hours: 8, tracked_hours: 8 }, { hours: 4, tracked_hours: 0 }])).toEqual({ tracked: 67, manual: 33 })
    expect(shareText([{ hours: 10, tracked_hours: 6.8 }])).toBe('Tracked 68% · Manual 32%')
    expect(shareText([])).toBeNull()
  })

  test("a person-week's source is Tracked at 100%, Manual at 0% and Mixed in between, by the rounded share (spec §7.2)", () => {
    expect(weekSource([{ hours: 8, tracked_hours: 8 }, { hours: 4, tracked_hours: 4 }])).toBe('tracked')
    expect(weekSource([{ hours: 8, tracked_hours: 0 }, { hours: 4 }])).toBe('manual')
    expect(weekSource([{ hours: 8, tracked_hours: 6 }, { hours: 16, tracked_hours: 16 }])).toBe('mixed')
    expect(weekSource([{ hours: 1000, tracked_hours: 999 }])).toBe('tracked')   // 99.9% reads 100%, as shareText says
    expect(weekSource([])).toBeNull()
  })

  test('the red flags have one name everywhere (spec §4.4)', () => {
    expect(FLAG_LABEL).toEqual({
      SAME_HOURS_DAILY: 'Repeated hours', LONG_DAY: 'Long day', CLOSED_MILESTONE: 'After completion', BACKDATED: 'Backdated',
      OVER_PLAN: 'Over plan', NO_ACTIVITY: 'No activity', NO_PROOF: 'No proof of work',
    })
  })

  test('timers belong to whoever keeps a timesheet, and the public demo admin sees them disabled', () => {
    expect(can(users.employee, 'timer.use')).toBe(true)
    expect(can(users.manager, 'timer.use')).toBe(false)
    expect(can(users.executive, 'timer.use')).toBe(false)
  })
})

describe('TimerButton and the header chip', () => {
  test('Start starts a timer on that milestone', async () => {
    let body = null
    let timer = null
    server.use(http.get(`${API}/timers/current`, () => HttpResponse.json({ timer, now: NOW, stopped: null })),
      http.post(`${API}/timers`, async ({ request }) => {
        body = await request.json()
        timer = running()
        return HttpResponse.json({ timer, now: NOW, stopped: null }, { status: 201 })
      }))
    renderAsUser(<Header />, { user: users.employee })
    expect(screen.queryByRole('button', { name: /timer running/i })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Start timer on Schema Mapping' }))
    await waitFor(() => expect(body).toEqual({ milestone_id: 'm1' }))
    // The header chip appears once the server says a timer runs.
    expect(await screen.findByRole('button', { name: /timer running on schema mapping/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /stop timer on schema mapping/i })).toBeInTheDocument()
  })

  test('the button reads Start timer, as its name begins (§5.1)', async () => {
    server.use(http.get(`${API}/timers/current`, () => HttpResponse.json({ timer: null, now: NOW, stopped: null })))
    renderAsUser(<Header milestones={[MS]} />, { user: users.employee })
    expect(await screen.findByRole('button', { name: 'Start timer on Schema Mapping' })).toHaveTextContent(/^Start timer$/)
  })

  test('no Start button on a completed milestone', async () => {
    server.use(http.get(`${API}/timers/current`, () => HttpResponse.json({ timer: null, now: NOW, stopped: null })))
    renderAsUser(<Header milestones={[MS, { id: 'm9', name: 'Wrapped Up', status: 'completed' }]} />, { user: users.employee })
    expect(await screen.findByRole('button', { name: 'Start timer on Schema Mapping' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start timer on Wrapped Up' })).not.toBeInTheDocument()
  })

  test('a running timer shows its live clock in the header and on its row', async () => {
    server.use(current(running({ started_at: new Date(Date.now() - 65_000).toISOString() })))
    renderAsUser(<Header />, { user: users.employee })
    const chip = await screen.findByRole('button', { name: /timer running on schema mapping/i })
    expect(chip).toHaveTextContent(/\d+:\d\d/)
    expect(screen.getByRole('button', { name: /stop timer on schema mapping \(running \d+:\d\d\)/i })).toBeInTheDocument()
  })

  test('another milestone cannot start while a timer runs', async () => {
    server.use(current(running()))
    renderAsUser(<Header milestones={[MS, { id: 'm2', name: 'Build' }]} />, { user: users.employee })
    await screen.findByRole('button', { name: /timer running on schema mapping/i })
    expect(screen.getByRole('button', { name: 'Start timer on Build' })).toBeDisabled()
  })

  test('the header chip stops the timer with an optional note and says the hours wait in the timesheet', async () => {
    let body = null
    let timer = running()
    server.use(http.get(`${API}/timers/current`, () => HttpResponse.json({ timer, now: NOW, stopped: null })),
      http.post(`${API}/timers/stop`, async ({ request }) => {
        body = await request.json()
        timer = null
        return HttpResponse.json({ timer: running({ stopped_at: NOW }), added_hours: 1.5, elapsed_hours: 1.5,
          auto_stopped: false, not_logged: null, work_date: '2026-10-14', week_start: '2026-10-12',
          message: "Added 1.5h to Wednesday's cell — open your timesheet to submit." })
      }))
    renderAsUser(<Header milestones={[]} />, { user: users.employee })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /timer running on schema mapping/i }))
    const dialog = await screen.findByRole('dialog', { name: /stop your timer/i })
    expect(dialog).toHaveTextContent(/stopping now adds/i)
    const note = within(dialog).getByLabelText(/what did you work on/i)
    await user.type(note, 'short')
    expect(within(dialog).getByText(/at least 10 characters/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Stop timer' })).toBeDisabled()
    await user.type(note, ' fixes to the address mapping')
    await user.click(within(dialog).getByRole('button', { name: 'Stop timer' }))
    await waitFor(() => expect(body).toEqual({ note: 'short fixes to the address mapping' }))
    expect(await screen.findByText("Added 1.5h to Wednesday's cell — open your timesheet to submit.")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /timer running/i })).not.toBeInTheDocument())
  })

  test('stopping without a note sends no note', async () => {
    let body = null
    server.use(current(running()), http.post(`${API}/timers/stop`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ timer: running({ stopped_at: NOW }), added_hours: 1, elapsed_hours: 1, auto_stopped: false,
        not_logged: null, message: "Added 1h to Wednesday's cell — open your timesheet to submit." })
    }))
    renderAsUser(<Header milestones={[]} />, { user: users.employee })
    await userEvent.click(await screen.findByRole('button', { name: /timer running on schema mapping/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop timer' }))
    await waitFor(() => expect(body).toEqual({}))
    expect(await screen.findByText(/open your timesheet to submit/i)).toBeInTheDocument()
  })

  test('a stop that adds nothing says why', async () => {
    server.use(current(running()), http.post(`${API}/timers/stop`, () => HttpResponse.json({
      timer: running({ stopped_at: NOW }), added_hours: 0, elapsed_hours: 0, auto_stopped: false, not_logged: null,
      message: 'Timer stopped after less than 7.5 minutes, so nothing was added' })))
    renderAsUser(<Header milestones={[]} />, { user: users.employee })
    await userEvent.click(await screen.findByRole('button', { name: /timer running on schema mapping/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop timer' }))
    expect(await screen.findByText('Timer stopped after less than 7.5 minutes, so nothing was added')).toBeInTheDocument()
  })

  test('a timer the server stopped at midnight is announced once', async () => {
    server.use(current(null, { timer: running({ auto_stopped: true }), added_hours: 4, elapsed_hours: 4, auto_stopped: true,
      not_logged: null,
      message: "Your timer on Schema Mapping stopped at midnight. Added 4h to Tuesday's cell — open your timesheet to submit." }))
    renderAsUser(<Header milestones={[]} />, { user: users.employee })
    expect(await screen.findByText(/stopped at midnight/i)).toBeInTheDocument()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.getAllByText(/stopped at midnight/i)).toHaveLength(1)
  })

  test('people who keep no timesheet never ask for a timer', async () => {
    let asked = false
    server.use(http.get(`${API}/timers/current`, () => { asked = true; return HttpResponse.json({ timer: null, now: NOW }) }))
    renderAsUser(<Header />, { user: users.manager })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(asked).toBe(false)
    expect(screen.queryByRole('button', { name: /start timer/i })).not.toBeInTheDocument()
  })

  test('the public demo admin sees Start disabled', async () => {
    renderAsUser(<Header />, { user: { ...users.demoAdmin, tracks_own_hours: true } })
    expect(await screen.findByRole('button', { name: 'Start timer on Schema Mapping' })).toBeDisabled()
  })
})
