import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const MON = WEEK
const TUE = '2026-10-13'
const WED = '2026-10-14'
const THU = '2026-10-15'
const FRI = '2026-10-16'
const REASON = 'Please add a clearer breakdown of the work completed.'
const NOTE = 'Mapped customer records and validated source fields.'
const VIEW_KEY = 'overwatch.timesheet.view'
const rows = [
  { milestone: { id: 'm2', name: 'Build', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
  { milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
]
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: MON, hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: '', source: 'manual', tracked_hours: 0,
  label: 'Pending approval', ...overrides })
// The mockup's week: Mon 0.25, Tue 7.75 and Fri 7.75 approved; Wed 8 rejected; Thu 4 pending, locked by a timer.
const mockEntries = [
  entry({ id: 'a', work_date: MON, hours: 0.25, status: 'approved', label: 'Approved' }),
  entry({ id: 'b', work_date: TUE, hours: 7.75, status: 'approved', label: 'Approved', note: 'Wrote the field mapping rules' }),
  entry({ id: 'c', work_date: WED, hours: 8, status: 'rejected', label: 'Rejected', rejection_reason: REASON, note: NOTE }),
  entry({ id: 'd', work_date: THU, hours: 4, status: 'pending', source: 'tracked', tracked_hours: 4, note: 'Ran the import dry run' }),
  entry({ id: 'f', work_date: FRI, hours: 7.75, status: 'approved', label: 'Approved' }),
]
const thuLock = { milestone_id: 'm1', work_date: THU, hours: 4, draft_hours: 0, tracked_hours: 4, request: null }

const sheetBody = ({ sheetRows = rows, entries = mockEntries, locks = [thuLock] } = {}) => ({ week_start: WEEK,
  user: { id: users.employee.id, name: 'Eli Employee' }, rows: sheetRows, entries, drafts: [], locks,
  totals: { logged: 19.75, approved: 15.75, draft: 0 } })
const sheet = (options) => http.get(`${API}/time-entries`, () => HttpResponse.json(sheetBody(options)))
const recordPuts = (puts) => http.put(`${API}/time-entries`, async ({ request }) => {
  puts.push(await request.json())
  return HttpResponse.json(sheetBody())
})

const renderSheet = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />,
  { user: users.employee, route, path: '/timesheet' })
// History: the page before ('/before'), then the timesheet. Back is the browser's Back button.
function Back() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>Back</button>
}
const renderWithBack = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<><TimesheetPage /><Back /></>,
  { user: users.employee, entries: ['/before', route], path: '/timesheet' })

const location = () => screen.getByTestId('location').textContent
const search = () => new URLSearchParams(location().split('?')[1] ?? '')
const statusLine = (name) => screen.findByRole('button', { name })
const panel = () => screen.findByRole('complementary', { name: 'Entry details' })
const gone = () => waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
const WED_LINE = 'Needs revision, details for Schema Mapping, Wed Oct 14'

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

describe('Entry details: opening', () => {
  test("a saved cell's status line opens the panel with the date, milestone, status, hours, note, feedback and source", async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    const line = await statusLine(WED_LINE)
    expect(line).toHaveAttribute('data-entry', 'm1:2026-10-14')
    expect(line).toHaveStyle({ minHeight: '44px' })
    await user.click(line)
    expect(search().get('entry')).toBe('m1:2026-10-14')
    const region = await panel()
    expect(within(region).getByRole('heading', { level: 2, name: 'Entry details' })).toBeInTheDocument()
    expect(within(region).getByText('Wed, Oct 14, 2026')).toBeInTheDocument()
    expect(within(region).getByRole('heading', { level: 3, name: 'Schema Mapping' })).toBeInTheDocument()
    expect(within(region).getByText('Needs revision')).toBeInTheDocument()
    expect(within(region).getByLabelText('Hours')).toHaveValue('8')
    expect(within(region).getByLabelText('Work note')).toHaveValue(NOTE)
    expect(within(region).getByText(`10-500 characters · ${NOTE.length}/500`)).toBeInTheDocument()
    expect(within(region).getByRole('group', { name: 'Manager feedback' })).toHaveTextContent(REASON)
    expect(within(region).getByLabelText('Source')).toHaveValue('Manual')
    expect(within(region).queryByText(/from a timer/)).not.toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Save & resubmit' })).toBeEnabled()
    expect(within(region).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })

  test('Manager feedback shows only on the rejected entry', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine('Approved, details for Schema Mapping, Tue Oct 13'))
    const region = await panel()
    expect(within(region).getByText('Tue, Oct 13, 2026')).toBeInTheDocument()
    expect(within(region).getByText('Approved')).toBeInTheDocument()
    expect(within(region).queryByText('Manager feedback')).not.toBeInTheDocument()
    expect(within(region).queryByText(REASON)).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: 'Save & resubmit' })).not.toBeInTheDocument()
  })

  test('an unsaved typed cell has no status line; the grid keeps no Edited chip, source chip or Resubmit', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Mon Oct 12'), '2')
    const table = screen.getByRole('table')
    expect(within(table).queryByRole('button', { name: /details for Build, Mon Oct 12/ })).not.toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Add work note, Build, Mon Oct 12' })).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /^Resubmit/ })).not.toBeInTheDocument()
    expect(within(table).queryByText('Manual')).not.toBeInTheDocument()
    expect(within(table).queryByText('Tracked')).not.toBeInTheDocument()
  })
})

describe('Entry details: saving', () => {
  test('Save & resubmit sends that cell alone; other unsaved typing stays unsaved and counted (Review Focus 5)', async () => {
    const puts = []
    server.use(sheet(), recordPuts(puts))
    renderSheet()
    const user = userEvent.setup()
    const tue = await screen.findByLabelText('Schema Mapping, Tue Oct 13')
    await user.clear(tue)
    await user.type(tue, '9')
    expect(screen.getByTestId('week-total')).toHaveTextContent('21h counted of 40h')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    await user.click(await statusLine(WED_LINE))
    await user.click(within(await panel()).getByRole('button', { name: 'Save & resubmit' }))
    await gone()
    expect(puts).toEqual([{ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WED, hours: 8 }] }])
    expect(await screen.findByText('Hours saved and sent for approval')).toBeInTheDocument()
    expect(search().has('entry')).toBe(false)
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(screen.getByTestId('week-total')).toHaveTextContent('21h counted of 40h')
    expect(puts).toHaveLength(1)
  })

  test('a failed Save & resubmit shows the error in the panel and keeps it open', async () => {
    server.use(sheet(), http.put(`${API}/time-entries`, () => HttpResponse.json({ error: {
      code: 'PROJECT_NOT_OPEN', message: 'This project is not open for logging.', request_id: 'r9' } }, { status: 409 })))
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine(WED_LINE))
    const region = await panel()
    await user.click(within(region).getByRole('button', { name: 'Save & resubmit' }))
    expect(await within(region).findByRole('alert')).toHaveTextContent('This project is not open for logging.')
    expect(screen.getByRole('complementary', { name: 'Entry details' })).toBeInTheDocument()
    expect(search().get('entry')).toBe('m1:2026-10-14')
  })

  test('a short work note shows its error and disables Save & resubmit', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine(WED_LINE))
    const region = await panel()
    const note = within(region).getByLabelText('Work note')
    await user.clear(note)
    await user.type(note, 'Too short')
    expect(within(region).getByText('At least 10 characters · 9/500')).toBeInTheDocument()
    expect(note).toHaveAttribute('aria-invalid', 'true')
    expect(within(region).getByRole('button', { name: 'Save & resubmit' })).toBeDisabled()
  })

  test('Done keeps the edits as unsaved changes: approved hours warn, the grid follows, and nothing is sent', async () => {
    const puts = []
    server.use(sheet(), recordPuts(puts))
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine('Approved, details for Schema Mapping, Tue Oct 13'))
    const region = await panel()
    const warning = 'Changing approved hours sends them back for approval.'
    expect(within(region).queryByText(warning)).not.toBeInTheDocument()
    const hours = within(region).getByLabelText('Hours')
    expect(hours).toHaveValue('7.75')
    await user.clear(hours)
    await user.type(hours, '9')
    expect(within(region).getByText(warning)).toBeInTheDocument()
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    await user.click(within(region).getByRole('button', { name: 'Done' }))
    await gone()
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    expect(puts).toEqual([])
  })
})

describe('Entry details: timer locks, closed rows and the Day view', () => {
  test('a timer-locked entry shows its hours read-only with Request a change, and its Source is Tracked', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine('Pending, details for Schema Mapping, Thu Oct 15'))
    const region = await panel()
    expect(within(region).getByText('Pending approval')).toBeInTheDocument()
    const hours = within(region).getByLabelText('Hours')
    expect(hours).toHaveValue('4')
    expect(hours).toHaveAttribute('readonly')
    expect(within(region).getByText("Timer hours can't be edited — request a change")).toBeInTheDocument()
    expect(within(region).getByLabelText('Source')).toHaveValue('Tracked')
    expect(within(region).getByText('4h from a timer')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'Request a change' }))
    expect(await screen.findByRole('dialog', { name: 'Request a change' })).toBeInTheDocument()
  })

  test('a waiting change request reads in full, in the Day view and in the panel, never cut short', async () => {
    localStorage.setItem(VIEW_KEY, 'day')
    server.use(sheet({ locks: [{ ...thuLock, request: { id: 'r1', requested_hours: 1.5, reason: 'Ran over lunch', status: 'pending' } }] }))
    renderSheet(`/timesheet?week=${WEEK}&day=${THU}`)
    const user = userEvent.setup()
    const chip = await screen.findByText('Change requested: 1.5h')
    expect(chip).toHaveStyle({ whiteSpace: 'normal' })
    await user.click(screen.getByRole('button', { name: 'Details for Schema Mapping, Thu Oct 15' }))
    const region = await panel()
    expect(within(region).getByText('Change requested: 1.5h')).not.toHaveStyle({ whiteSpace: 'nowrap' })
    expect(within(region).queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument()
  })

  test('a rejected entry on an on-hold project is read-only: disabled fields, the reason it is closed, and Done only', async () => {
    const onHold = { milestone: { id: 'm3', name: 'Cutover', status: 'in_progress' },
      project: { id: 'p2', name: 'Atlas', status: 'on_hold' }, open: false }
    server.use(sheet({ sheetRows: [...rows, onHold], entries: [...mockEntries, entry({ id: 'g', milestone_id: 'm3',
      project_id: 'p2', work_date: WED, hours: 3, status: 'rejected', label: 'Rejected', rejection_reason: 'Wrong project', note: NOTE })] }))
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine('Needs revision, details for Cutover, Wed Oct 14'))
    const region = await panel()
    expect(within(region).getByText('Project on hold — logging paused')).toBeInTheDocument()
    expect(within(region).getByLabelText('Hours')).toBeDisabled()
    expect(within(region).getByLabelText('Work note')).toBeDisabled()
    expect(within(region).getByRole('group', { name: 'Manager feedback' })).toHaveTextContent('Wrong project')
    expect(within(region).getByRole('button', { name: 'Done' })).toBeEnabled()
    expect(within(region).queryByRole('button', { name: 'Save & resubmit' })).not.toBeInTheDocument()
  })

  test("the Day view's Details opens the same panel, only on rows with a saved entry that day", async () => {
    localStorage.setItem(VIEW_KEY, 'day')
    server.use(sheet())
    renderSheet(`/timesheet?week=${WEEK}&day=${WED}`)
    const user = userEvent.setup()
    const details = await screen.findByRole('button', { name: 'Details for Schema Mapping, Wed Oct 14' })
    expect(screen.queryByRole('button', { name: /^Details for Build/ })).not.toBeInTheDocument()
    await user.click(details)
    expect(search().get('entry')).toBe('m1:2026-10-14')
    const region = await panel()
    expect(within(region).getByText('Wed, Oct 14, 2026')).toBeInTheDocument()
    expect(within(region).getByRole('group', { name: 'Manager feedback' })).toHaveTextContent(REASON)
    await user.click(within(region).getByRole('button', { name: 'Close' }))
    await gone()
    expect(screen.getByRole('button', { name: 'Details for Schema Mapping, Wed Oct 14' })).toHaveFocus()
  })

  test('switching views drops the entry and closes the panel', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine(WED_LINE))
    await panel()
    await user.click(screen.getByRole('button', { name: 'Day' }))
    await gone()
    expect(search().has('entry')).toBe(false)
  })
})

describe('Entry details: the URL, history and focus', () => {
  test('a deep link opens on load; Esc closes it and focus returns to its status line', async () => {
    server.use(sheet())
    renderSheet(`/timesheet?week=${WEEK}&entry=m1:2026-10-14`)
    const region = await panel()
    expect(within(region).getByText('Wed, Oct 14, 2026')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    await gone()
    expect(search().has('entry')).toBe(false)
    expect(search().get('week')).toBe(WEEK)
    expect(screen.getByRole('button', { name: WED_LINE })).toHaveFocus()
  })

  test('after an open from the grid, Back closes it', async () => {
    server.use(sheet())
    renderWithBack()
    const user = userEvent.setup()
    await user.click(await statusLine(WED_LINE))
    await panel()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await gone()
    expect(location()).toBe(`/timesheet?week=${WEEK}`)
  })

  test('switching to another entry replaces the history entry: Close, then Back leaves the page', async () => {
    server.use(sheet())
    renderWithBack()
    const user = userEvent.setup()
    await user.click(await statusLine(WED_LINE))
    await panel()
    await user.click(screen.getByRole('button', { name: 'Approved, details for Schema Mapping, Tue Oct 13' }))
    expect(within(await panel()).getByText('Tue, Oct 13, 2026')).toBeInTheDocument()
    expect(search().get('entry')).toBe('m1:2026-10-13')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await gone()
    expect(location()).toBe(`/timesheet?week=${WEEK}`)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(location()).toBe('/before')
  })

  test.each([
    ['a day of another week', 'm1:2026-10-21'],
    ['a typo', 'zzz'],
    ['an empty cell', 'm2:2026-10-12'],
    ['an unlisted milestone', 'm9:2026-10-14'],
  ])('an entry param naming %s opens no panel and is removed with replace (Review Focus 4)', async (_, value) => {
    const errors = vi.spyOn(console, 'error')
    server.use(sheet())
    renderWithBack(`/timesheet?week=${WEEK}&entry=${value}`)
    await statusLine(WED_LINE)
    await waitFor(() => expect(search().has('entry')).toBe(false))
    expect(search().get('week')).toBe(WEEK)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByText('Entry details')).not.toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
    // Replaced, not pushed: one step back is the page before.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }))
    expect(location()).toBe('/before')
  })

  test('on a phone the panel is a full-screen modal dialog', async () => {
    setViewport(375)
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await user.click(await statusLine(WED_LINE))
    const dialog = await screen.findByRole('dialog', { name: 'Entry details' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('Wed, Oct 14, 2026')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})

describe('Entry details: retargeted from the grid', () => {
  test('cells show the status words; Edited and Overtime are chips in the panel and the reason is in Manager feedback', async () => {
    server.use(sheet({ locks: [], entries: [
      entry({ id: 'e1', over_40: true, label: 'Pending (Overtime requested from Eli Employee)' }),
      entry({ id: 'e2', work_date: TUE, edited_after_decision: true }),
      entry({ id: 'e3', work_date: WED, status: 'rejected', label: 'Rejected', rejection_reason: 'Wrong milestone' }),
    ] }))
    renderSheet()
    const user = userEvent.setup()
    const table = await screen.findByRole('table')
    expect(await within(table).findByText('Overtime')).toBeInTheDocument()
    expect(within(table).queryByText('Edited')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pending, Overtime, details for Schema Mapping, Mon Oct 12' }))
    const region = await panel()
    expect(within(region).getByText('Pending approval')).toBeInTheDocument()
    expect(within(region).getByText('Overtime')).toBeInTheDocument()
    expect(within(region).queryByText('Edited')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pending, details for Schema Mapping, Tue Oct 13' }))
    expect(await within(region).findByText('Tue, Oct 13, 2026')).toBeInTheDocument()
    expect(within(region).getByText('Edited')).toBeInTheDocument()
    expect(within(region).queryByText('Overtime')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Needs revision, details for Schema Mapping, Wed Oct 14' }))
    expect(await within(region).findByRole('group', { name: 'Manager feedback' })).toHaveTextContent('Wrong milestone')
  })

  test('the panel says where the hours came from (Mixed, with the timer share), and the grid keeps the note button', async () => {
    server.use(sheet({ locks: [], entries: [entry({ source: 'manual' }),
      entry({ id: 'e2', work_date: TUE, source: 'mixed', tracked_hours: 3, note: 'Reviewed the mapping' })] }))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Edit work note, Schema Mapping, Tue Oct 13' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pending, details for Schema Mapping, Tue Oct 13' }))
    const region = await panel()
    expect(within(region).getByLabelText('Source')).toHaveValue('Mixed')
    expect(within(region).getByText('3h from a timer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pending, details for Schema Mapping, Mon Oct 12' }))
    expect(await within(region).findByText('Mon, Oct 12, 2026')).toBeInTheDocument()
    expect(within(region).getByLabelText('Source')).toHaveValue('Manual')
  })
})
