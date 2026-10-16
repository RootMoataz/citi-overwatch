import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const VIEW_KEY = 'overwatch.timesheet.view'
const rows = [{ milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true }]
const RANGES = {
  '2026-09': { start: '2026-08-31', end: '2026-10-04' },
  '2026-10': { start: '2026-09-28', end: '2026-11-01' },
}

const sheet = () => http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK,
  user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries: [], totals: { logged: 0, approved: 0 } }))
const calendarMilestone = { id: 'm1', name: 'Schema Mapping', start_date: '2026-10-01', end_date: '2026-12-18', status: 'in_progress',
  display_status: 'in_progress', progress_percent: 40, project: { id: 'p1', name: 'Apollo', status: 'active' }, role: 'primary' }
const calendarEntry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: '2026-10-13', hours: 6, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: '', tracked_hours: 0, label: 'Pending approval', ...overrides })
const calendar = ({ entries = [], locks = [] } = {}) => http.get(`${API}/time-entries/calendar`, ({ request }) => {
  const month = new URL(request.url).searchParams.get('month')
  return HttpResponse.json({ month, range: RANGES[month], user: { id: users.employee.id, name: 'Eli Employee' },
    milestones: entries.length ? [calendarMilestone] : [], entries, drafts: [], locks })
})
const renderSheet = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />, { user: users.employee, route, path: '/timesheet' })
const dayBox = (name) => screen.findByRole('button', { name })
const panel = (name) => screen.findByRole('region', { name })
const editInDayView = async (user, name) => user.click(within(await panel(name)).getByRole('button', { name: /^Edit in Day view/ }))
const viewToggle = (name) => screen.getByRole('button', { name })

// "Today" is Wednesday 14 Oct 2026; only Date is faked, so requests run normally.
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0))
  server.use(sheet(), calendar())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Timesheet Month view', () => {
  test('the Month toggle shows the month and is remembered', async () => {
    const first = renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    await user.click(viewToggle('Month'))
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^submit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next week/i })).not.toBeInTheDocument()
    expect(localStorage.getItem(VIEW_KEY)).toBe('month')
    first.unmount()
    renderSheet('/timesheet')
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    expect(viewToggle('Month')).toHaveAttribute('aria-pressed', 'true')
  })

  test("Month opens on the selected day's month with that day selected, and a new month drops ?day=", async () => {
    renderSheet('/timesheet?week=2026-09-28&day=2026-10-01')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Month' }))
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('month=2026-10'))
    expect(await panel('Thursday 1 October 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('month=2026-09')
    expect(screen.getByTestId('location')).not.toHaveTextContent('day=')
    expect(await panel('Tuesday 1 September 2026')).toBeInTheDocument()
  })

  test('Month opens on the month in the URL', async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    renderSheet(`/timesheet?week=${WEEK}&month=2026-09`)
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
  })

  test('a shared ?month= link opens the Month view whatever view is stored', async () => {
    localStorage.setItem(VIEW_KEY, 'week')
    renderSheet('/timesheet?month=2026-09')
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(viewToggle('Month')).toHaveAttribute('aria-pressed', 'true')
  })

  test.each([
    ['?week=2026-10-12', 'Wed Oct 14'],
    ['?week=2026-10-12&day=2026-10-13', 'Tue Oct 13'],
    ['?day=2026-10-13', 'Tue Oct 13'],
  ])('a link with week or day (%s) opens Day when Month is the stored view', async (query, label) => {
    localStorage.setItem(VIEW_KEY, 'month')
    renderSheet(`/timesheet${query}`)
    expect(await screen.findByLabelText(`Schema Mapping, ${label}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^submit/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'October 2026' })).not.toBeInTheDocument()
  })

  test('a link with week keeps a stored Week view', async () => {
    localStorage.setItem(VIEW_KEY, 'week')
    renderSheet(`/timesheet?week=${WEEK}`)
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(viewToggle('Week')).toHaveAttribute('aria-pressed', 'true')
  })

  test('leaving Month drops ?month= so a reload keeps the chosen view', async () => {
    const first = renderSheet('/timesheet?month=2026-10')
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    await user.click(viewToggle('Day'))
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(screen.getByTestId('location')).not.toHaveTextContent('month=')
    const search = screen.getByTestId('location').textContent
    first.unmount()
    renderSheet(`/timesheet${search.includes('?') ? search.slice(search.indexOf('?')) : ''}`)
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'October 2026' })).not.toBeInTheDocument()
  })

  test('Back to that week also drops ?month=', async () => {
    renderSheet(`/timesheet?week=${WEEK}`)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.click(viewToggle('Month'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('month=2026-10'))
    await user.click(screen.getByRole('button', { name: 'Back to that week' }))
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toHaveValue('6')
    expect(screen.getByTestId('location')).not.toHaveTextContent('month=')
    expect(screen.getByTestId('location')).toHaveTextContent(`week=${WEEK}`)
  })

  test('clicking a day selects it, keeps ?day= in the URL and shows its panel', async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    renderSheet('/timesheet?month=2026-10&day=2026-10-20')
    const user = userEvent.setup()
    expect(await panel('Tuesday 20 October 2026')).toBeInTheDocument()
    await user.click(await dayBox(/^Tue 13 Oct/))
    expect(await panel('Tuesday 13 October 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Tue 13 Oct/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent('month=2026-10&day=2026-10-13')
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    expect(localStorage.getItem(VIEW_KEY)).toBe('month')
    // A faded day of the next or previous month moves the month with it.
    await user.click(screen.getByRole('button', { name: /^Wed 30 Sep/ }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(await panel('Wednesday 30 September 2026')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('month=2026-09&day=2026-09-30')
  })

  test('?day= outside the month in the URL falls back to today', async () => {
    renderSheet('/timesheet?month=2026-10&day=2026-09-02')
    expect(await panel('Wednesday 14 October 2026')).toBeInTheDocument()
  })

  test('Edit in Day view opens the Day view on that date', async () => {
    server.use(calendar({ entries: [calendarEntry()] }))
    localStorage.setItem(VIEW_KEY, 'month')
    renderSheet('/timesheet?month=2026-10')
    const user = userEvent.setup()
    await user.click(await dayBox(/^Tue 13 Oct/))
    await editInDayView(user, 'Tuesday 13 October 2026')
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`week=${WEEK}&day=2026-10-13`)
    expect(localStorage.getItem(VIEW_KEY)).toBe('day')
    expect(screen.queryByRole('heading', { name: 'October 2026' })).not.toBeInTheDocument()
  })

  test('a day with no hours still offers Edit in Day view', async () => {
    renderSheet('/timesheet?month=2026-10&day=2026-10-13')
    const user = userEvent.setup()
    expect(within(await panel('Tuesday 13 October 2026')).getByText('No hours')).toBeInTheDocument()
    await editInDayView(user, 'Tuesday 13 October 2026')
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toBeInTheDocument()
  })

  test('a timer-locked line shows the lock and Request a change, which opens the existing dialog with that cell', async () => {
    let sent = null
    server.use(
      calendar({ entries: [calendarEntry({ work_date: '2026-10-14', hours: 4, tracked_hours: 4 })],
        locks: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 4, draft_hours: 0, tracked_hours: 4, request: null }] }),
      http.post(`${API}/time-edit-requests`, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ id: 'r1', status: 'pending' }, { status: 201 })
      }),
    )
    renderSheet('/timesheet?month=2026-10')
    const user = userEvent.setup()
    const card = within(await panel('Wednesday 14 October 2026')).getByRole('heading', { name: 'Schema Mapping' }).closest('li')
    expect(within(card).getByRole('img', { name: 'Locked' })).toBeInTheDocument()
    expect(within(card).getByText('Timer hours are locked; your manager approves any change')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Request a change, Schema Mapping' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request a change' })
    expect(dialog).toHaveTextContent('Schema Mapping holds 4h from your timer.')
    await user.type(within(dialog).getByLabelText(/Hours you want instead/), '3')
    await user.type(within(dialog).getByLabelText(/Why\?/), 'The timer ran over lunch')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent).toEqual({ milestone_id: 'm1', work_date: '2026-10-14', requested_hours: '3', reason: 'The timer ran over lunch' })
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })

  test('opening a day in another week with unsaved edits asks first, and Cancel keeps the edits', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.click(viewToggle('Month'))
    await user.click(await dayBox(/^Mon 19 Oct/))
    await editInDayView(user, 'Monday 19 October 2026')
    const dialog = await screen.findByRole('dialog', { name: 'Discard 1 unsaved change?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to that week' }))
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toHaveValue('6')

    await user.click(viewToggle('Month'))
    await user.click(await dayBox(/^Mon 19 Oct/))
    await editInDayView(user, 'Monday 19 October 2026')
    await user.click(within(await screen.findByRole('dialog', { name: 'Discard 1 unsaved change?' })).getByRole('button', { name: 'Discard' }))
    expect(await screen.findByLabelText('Schema Mapping, Mon Oct 19')).toHaveValue('')
    expect(screen.getByTestId('location')).toHaveTextContent('week=2026-10-19&day=2026-10-19')
  })

  test('opening a day in the current week keeps unsaved edits without asking', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.click(viewToggle('Month'))
    await user.click(await dayBox(/^Tue 13 Oct/))
    await editInDayView(user, 'Tuesday 13 October 2026')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    expect(screen.getByTestId('location')).toHaveTextContent('day=2026-10-13')
  })

  test('unsaved edits show a line in the Month view and Back to that week returns', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.click(viewToggle('Month'))
    expect(await screen.findByText('You have 1 unsaved change in the week of Mon 12 Oct.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to that week' }))
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toHaveValue('6')
    expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument()
  })

  test('a blocked localStorage still opens the page in the Day view', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toBeInTheDocument()
    await user.click(viewToggle('Month'))
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })

  test('Month opened from a past week selects that week\'s Monday, not the 1st', async () => {
    renderSheet('/timesheet?week=2026-09-14')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Month' }))
    expect(await panel('Monday 14 September 2026')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('month=2026-09')
  })
})
