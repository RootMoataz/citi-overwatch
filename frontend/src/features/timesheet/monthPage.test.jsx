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
const calendar = () => http.get(`${API}/time-entries/calendar`, ({ request }) => {
  const month = new URL(request.url).searchParams.get('month')
  return HttpResponse.json({ month, range: RANGES[month], user: { id: users.employee.id, name: 'Eli Employee' }, milestones: [], entries: [], drafts: [] })
})
const renderSheet = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />, { user: users.employee, route, path: '/timesheet' })
const dayBox = (name) => screen.findByRole('button', { name })
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
    renderSheet()
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    expect(viewToggle('Month')).toHaveAttribute('aria-pressed', 'true')
  })

  test("Month opens on the selected day's month and keeps it in the URL", async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    renderSheet('/timesheet?week=2026-09-28&day=2026-10-01')
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('month=2026-10'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('month=2026-09')
  })

  test('Month opens on the month in the URL', async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    renderSheet(`/timesheet?week=${WEEK}&month=2026-09`)
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
  })

  test('clicking a day in the month opens it in the Day view', async () => {
    localStorage.setItem(VIEW_KEY, 'month')
    renderSheet()
    const user = userEvent.setup()
    await user.click(await dayBox(/^Tue 13 Oct/))
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`week=${WEEK}&day=2026-10-13`)
    expect(localStorage.getItem(VIEW_KEY)).toBe('day')
    expect(screen.queryByRole('heading', { name: 'October 2026' })).not.toBeInTheDocument()
  })

  test('opening a day in another week with unsaved edits asks first, and Cancel keeps the edits', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Schema Mapping, Wed Oct 14'), '6')
    await user.click(viewToggle('Month'))
    await user.click(await dayBox(/^Mon 19 Oct/))
    const dialog = await screen.findByRole('dialog', { name: 'Discard 1 unsaved change?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to that week' }))
    expect(await screen.findByLabelText('Schema Mapping, Wed Oct 14')).toHaveValue('6')

    await user.click(viewToggle('Month'))
    await user.click(await dayBox(/^Mon 19 Oct/))
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
})
