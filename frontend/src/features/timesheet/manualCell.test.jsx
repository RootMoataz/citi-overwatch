// A manual request on the employee's own timesheet: a read-only cell with a "Manual request" chip, edited, resubmitted or
// withdrawn from its panels. Typing never reaches it, restored or not (spec decision 3, Review Focus 3 and 5).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const WED = '2026-10-14'
const VIEW_KEY = 'overwatch.timesheet.view'
const STORE_KEY = 'overwatch.timesheet.unsaved.u-emp.2026-10-12'
const NOTE = 'Mapped the address fields offline'
const CELL = 'Schema Mapping, Wed Oct 14'
const project = { id: 'p1', name: 'Apollo Data Migration', status: 'active' }
const mapping = { milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project, open: true }
const build = { milestone: { id: 'm2', name: 'Build', status: 'in_progress' }, project, open: true }
const onHold = { milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' },
  project: { ...project, status: 'on_hold' }, open: false }
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: WED, hours: 2, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: NOTE, source: 'manual', tracked_hours: 0,
  label: 'Pending approval', updated_at: '2026-10-15T10:00:00+00:00',
  manual: { reason: 'forgot_timer', details: 'Laptop was in for repair' }, ...overrides })

const body = ({ rows = [mapping], entries = [entry()] } = {}) => ({ week_start: WEEK,
  user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries, drafts: [], locks: [],
  totals: { logged: entries.reduce((s, e) => s + (e.status === 'rejected' ? 0 : e.hours), 0), approved: 0, draft: 0 } })
const sheet = (options) => http.get(`${API}/time-entries`, () => HttpResponse.json(body(options)))
const calendarMilestone = { id: 'm1', name: 'Schema Mapping', start_date: '2026-10-01', end_date: '2026-12-18', status: 'in_progress',
  display_status: 'in_progress', progress_percent: 40, project, role: 'primary' }
const calendar = (entries = [entry()], milestone = calendarMilestone) => http.get(`${API}/time-entries/calendar`, ({ request }) => {
  const month = new URL(request.url).searchParams.get('month')
  return HttpResponse.json({ month, range: { start: '2026-09-28', end: '2026-11-01' },
    user: { id: users.employee.id, name: 'Eli Employee' }, milestones: [milestone], entries, drafts: [], locks: [] })
})
const saveManual = () => http.put(`${API}/manual-hours/e1`, () => HttpResponse.json({ entry: entry({ hours: 3 }) }))

const render = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />,
  { user: users.employee, route, path: '/timesheet' })
const asDay = (route) => { localStorage.setItem(VIEW_KEY, 'day'); return render(route) }

beforeEach(() => {
  localStorage.setItem(VIEW_KEY, 'week')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => {
  server.events.removeAllListeners()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Week grid', () => {
  test('a manual cell is a read-only group with a status line, not a textbox', async () => {
    server.use(sheet())
    render()
    expect(await screen.findByRole('group', { name: `${CELL}: 2h, manual request` })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: CELL })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Pending, details for ${CELL}` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Add work note, ${CELL}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Edit work note, ${CELL}` })).not.toBeInTheDocument()
  })

  test('the chip is focusable, named by its reason, and its tooltip adds the details', async () => {
    server.use(sheet())
    render()
    const chip = await screen.findByLabelText('Manual request: Forgot to start the timer')
    expect(chip).toHaveAttribute('tabindex', '0')
    expect(within(chip).getByText('Manual request')).toBeInTheDocument()
    chip.focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Forgot to start the timer: Laptop was in for repair')
  })

  test('without details the tooltip is the reason alone', async () => {
    server.use(sheet({ entries: [entry({ manual: { reason: 'forgot_timer', details: null } })] }))
    render()
    const chip = await screen.findByLabelText('Manual request: Forgot to start the timer')
    chip.focus()
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(/^Forgot to start the timer$/)
  })

  test('Edit opens the Edit manual hours dialog', async () => {
    server.use(sheet())
    const user = userEvent.setup()
    render()
    await user.click(await screen.findByRole('button', { name: `Edit manual hours, ${CELL}` }))
    expect(await screen.findByRole('dialog', { name: 'Edit manual hours' })).toBeInTheDocument()
  })

  test('a rejected request shows Needs revision, Fix and resubmit and the reason, with no Resubmit', async () => {
    server.use(sheet({ entries: [entry({ status: 'rejected', rejection_reason: 'Split it between milestones' })] }))
    const user = userEvent.setup()
    render()
    expect(await screen.findByRole('button', { name: `Needs revision, details for ${CELL}` })).toBeInTheDocument()
    expect(screen.getByText('Reason: Split it between milestones')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Resubmit/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `Fix and resubmit, ${CELL}` }))
    expect(await screen.findByRole('dialog', { name: 'Fix and resubmit' })).toBeInTheDocument()
  })

  test('an approved request offers Edit', async () => {
    server.use(sheet({ entries: [entry({ status: 'approved' })] }))
    render('/timesheet?week=2026-10-12&entry=m1:2026-10-14')
    const panel = await screen.findByRole('complementary', { name: 'Entry details' })
    expect(within(panel).getByRole('button', { name: `Edit manual hours, ${CELL}` })).toHaveTextContent(/^Edit$/)
    expect(within(panel).queryByRole('button', { name: /^Withdraw/ })).not.toBeInTheDocument()
  })

  test('an on-hold row has no actions', async () => {
    server.use(sheet({ rows: [onHold] }))
    render()
    expect(await screen.findByRole('group', { name: `${CELL}: 2h, manual request` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit manual hours/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Withdraw/ })).not.toBeInTheDocument()
  })
})

describe('Day view', () => {
  test('the work note is read-only and the row carries the chip, not a Manual source chip', async () => {
    server.use(sheet())
    asDay(`/timesheet?week=${WEEK}&day=${WED}`)
    const note = await screen.findByRole('textbox', { name: 'Work note, Schema Mapping' })
    expect(note).toHaveAttribute('readonly')
    expect(note).toHaveValue(NOTE)
    expect(screen.getByText('Manual request')).toBeInTheDocument()
    expect(screen.queryByText('Manual')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Resubmit/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Edit manual hours, ${CELL}` })).toBeInTheDocument()
  })
})

describe('Entry details', () => {
  const open = () => render(`/timesheet?week=${WEEK}&entry=m1:${WED}`)
  const panel = () => screen.findByRole('complementary', { name: 'Entry details' })

  test('shows the reason, details and source, with the hours and note read-only', async () => {
    server.use(sheet())
    open()
    const p = await panel()
    expect(within(p).getByText('Why not the timer?')).toBeInTheDocument()
    expect(within(p).getByText('Forgot to start the timer')).toBeInTheDocument()
    expect(within(p).getByText('Laptop was in for repair')).toBeInTheDocument()
    expect(within(p).getByRole('textbox', { name: 'Source' })).toHaveValue('Manual request')
    expect(within(p).getByRole('textbox', { name: 'Hours' })).toHaveAttribute('readonly')
    expect(within(p).getByRole('textbox', { name: 'Work note' })).toHaveAttribute('readonly')
    expect(within(p).queryByRole('button', { name: /Save & resubmit/ })).not.toBeInTheDocument()
  })

  test('Withdraw asks first, sends the DELETE, toasts and closes the panel', async () => {
    let deleted = 0
    server.use(sheet(), http.delete(`${API}/manual-hours/e1`, () => { deleted += 1; return new HttpResponse(null, { status: 204 }) }))
    const user = userEvent.setup()
    open()
    await panel()
    await user.click(screen.getByRole('button', { name: `Withdraw, ${CELL}` }))
    const confirm = await screen.findByRole('dialog', { name: 'Withdraw these hours?' })
    expect(within(confirm).getByText("2h on Schema Mapping, Wed 14 Oct, are removed and your manager won't see them."))
      .toBeInTheDocument()
    expect(deleted).toBe(0)
    await user.click(within(confirm).getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Withdrew 2h on Schema Mapping (Wed 14 Oct)')).toBeInTheDocument()
    expect(deleted).toBe(1)
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Entry details' })).not.toBeInTheDocument())
  })

  test('a request edited after a decision cannot be withdrawn', async () => {
    server.use(sheet({ entries: [entry({ edited_after_decision: true })] }))
    open()
    const p = await panel()
    expect(within(p).getByRole('button', { name: `Edit manual hours, ${CELL}` })).toBeInTheDocument()
    expect(within(p).queryByRole('button', { name: /^Withdraw/ })).not.toBeInTheDocument()
  })
})

describe('Month view', () => {
  test("the day panel shows the request's reason and Withdraw, not Edit in Day view", async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    server.use(sheet(), calendar())
    render(`/timesheet?week=${WEEK}&month=2026-10&day=${WED}`)
    const region = await screen.findByRole('region', { name: 'Wednesday, October 14, 2026' })
    expect(await within(region).findByRole('button', { name: `Withdraw, ${CELL}` })).toBeInTheDocument()
    expect(within(region).getByText('Forgot to start the timer')).toBeInTheDocument()
    expect(within(region).getByText('Laptop was in for repair')).toBeInTheDocument()
    expect(within(region).getByText(NOTE)).toBeInTheDocument()
    expect(within(region).getByText('Manual request')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: 'Edit in Day view, Schema Mapping' })).not.toBeInTheDocument()
  })
})

describe('Unassigned and closed', () => {
  const noEdit = (scope) => expect(within(scope).queryByRole('button', { name: /^Edit manual hours/ })).not.toBeInTheDocument()

  test('Month: an unassigned employee keeps the note and Withdraw, with no Edit', async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    server.use(sheet(), calendar([entry()], { ...calendarMilestone, role: null }))
    render(`/timesheet?week=${WEEK}&month=2026-10&day=${WED}`)
    const region = await screen.findByRole('region', { name: 'Wednesday, October 14, 2026' })
    expect(await within(region).findByRole('button', { name: `Withdraw, ${CELL}` })).toBeInTheDocument()
    expect(within(region).getByText("You're no longer assigned to this milestone")).toBeInTheDocument()
    noEdit(region)
  })

  test('Entry details: an unassigned employee can still withdraw but not edit', async () => {
    server.use(sheet({ rows: [{ ...mapping, role: null }] }))
    render(`/timesheet?week=${WEEK}&entry=m1:${WED}`)
    const p = await screen.findByRole('complementary', { name: 'Entry details' })
    expect(within(p).getByRole('button', { name: `Withdraw, ${CELL}` })).toBeInTheDocument()
    noEdit(p)
  })

  test('Month: a closed project row shows the manual line with no actions', async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    server.use(sheet(), calendar([entry()], { ...calendarMilestone, project: { ...project, status: 'on_hold' } }))
    render(`/timesheet?week=${WEEK}&month=2026-10&day=${WED}`)
    const region = await screen.findByRole('region', { name: 'Wednesday, October 14, 2026' })
    expect(await within(region).findByText('Forgot to start the timer')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /^(Edit|Withdraw|Fix)/ })).not.toBeInTheDocument()
  })
})

describe('Day view note', () => {
  test("a stored note for a manual cell never replaces the request's note", async () => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ drafts: {}, notes: { 'm1|2026-10-14': 'A stale note typed earlier' } }))
    server.use(sheet())
    asDay(`/timesheet?week=${WEEK}&day=${WED}`)
    expect(await screen.findByRole('textbox', { name: 'Work note, Schema Mapping' })).toHaveValue(NOTE)
  })
})

describe('Typing never reaches a manual cell', () => {
  test('restored typing for a manual cell is dropped; only the typed cell is sent', async () => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ drafts: { 'm1|2026-10-14': '9', 'm2|2026-10-13': '3' }, notes: {} }))
    const puts = []
    server.use(sheet({ rows: [mapping, build], entries: [entry()] }), http.put(`${API}/time-entries`, async ({ request }) => {
      puts.push(await request.json())
      return HttpResponse.json(body({ rows: [mapping, build] }))
    }))
    const user = userEvent.setup()
    render()
    expect(await screen.findByLabelText('Build, Tue Oct 13')).toHaveValue('3')
    const submit = await screen.findByRole('button', { name: 'Submit 1 change' })
    expect(screen.getByRole('group', { name: `${CELL}: 2h, manual request` })).toBeInTheDocument()
    await user.click(submit)
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].entries).toHaveLength(1)
    expect(puts[0].entries[0]).toMatchObject({ milestone_id: 'm2', work_date: '2026-10-13' })
  })
})

describe('Privacy', () => {
  test('editing and withdrawing in Week, Day and Month send only the owner requests', async () => {
    const seen = []
    server.events.on('request:start', ({ request }) => { seen.push({ method: request.method, url: new URL(request.url) }) })
    server.use(sheet(), calendar(), saveManual(),
      http.delete(`${API}/manual-hours/e1`, () => new HttpResponse(null, { status: 204 })))
    const user = userEvent.setup()
    const edit = async (name) => {
      await user.click(await screen.findByRole('button', { name }))
      await screen.findByRole('dialog', { name: 'Edit manual hours' })
      await user.clear(screen.getByRole('textbox', { name: /^Hours/ }))
      await user.type(screen.getByRole('textbox', { name: /^Hours/ }), '3')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))
      await screen.findByText('Sent 3h on Schema Mapping (Wed 14 Oct) for review')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    const week = render()
    await edit(`Edit manual hours, ${CELL}`)
    week.unmount()
    const day = asDay(`/timesheet?week=${WEEK}&day=${WED}`)
    await edit(`Edit manual hours, ${CELL}`)
    day.unmount()
    localStorage.setItem(VIEW_KEY, 'month')
    const month = render(`/timesheet?week=${WEEK}&month=2026-10&day=${WED}`)
    await user.click(await screen.findByRole('button', { name: `Withdraw, ${CELL}` }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Withdraw these hours?' })).getByRole('button', { name: 'Withdraw' }))
    await screen.findByText('Withdrew 2h on Schema Mapping (Wed 14 Oct)')
    month.unmount()

    const manual = seen.filter((r) => r.url.pathname.endsWith('/manual-hours') || r.url.pathname.includes('/manual-hours/'))
    expect(manual.map((r) => `${r.method} ${r.url.pathname.replace(API, '')}`).sort())
      .toEqual(['DELETE /manual-hours/e1', 'PUT /manual-hours/e1', 'PUT /manual-hours/e1'])
    expect(seen.filter((r) => r.url.pathname.includes('/time-entries')).every((r) => !r.url.searchParams.has('user'))).toBe(true)
    expect(seen.some((r) => r.url.pathname.includes('/approvals'))).toBe(false)
  })
})
