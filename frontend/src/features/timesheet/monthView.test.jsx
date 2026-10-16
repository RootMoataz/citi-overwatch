import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, delay, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import MonthView from './MonthView.jsx'

const RANGES = {
  '2026-09': { start: '2026-08-31', end: '2026-10-04' },
  '2026-10': { start: '2026-09-28', end: '2026-11-01' },
  '2026-11': { start: '2026-10-26', end: '2026-12-06' },
}
const milestone = (id, name, overrides) => ({ id, name, start_date: '2026-10-13', end_date: '2026-10-15', status: 'in_progress',
  display_status: 'in_progress', progress_percent: 40, project: { id: 'p1', name: 'Apollo', status: 'active' }, role: 'primary', ...overrides })
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: '2026-10-14', hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: '', label: 'Pending approval', ...overrides })
const m1 = milestone('m1', 'Schema Mapping', { start_date: '2026-10-12', end_date: '2026-10-16' })
const m2 = milestone('m2', 'Build', { start_date: '2026-10-13', end_date: '2026-10-16' })
const m3 = milestone('m3', 'Cutover')
const m4 = milestone('m4', 'Hypercare')

function calendar({ milestones = [m1, m2, m3], entries = [], drafts = [] } = {}) {
  return http.get(`${API}/time-entries/calendar`, ({ request }) => {
    const month = new URL(request.url).searchParams.get('month')
    return HttpResponse.json({ month, range: RANGES[month], user: { id: users.employee.id, name: 'Eli Employee' }, milestones, entries, drafts })
  })
}

const onMonthChange = vi.fn()
const onOpenDay = vi.fn()
const render = (month = '2026-10') => renderAsUser(<MonthView month={month} onMonthChange={onMonthChange} onOpenDay={onOpenDay} />,
  { user: users.employee, route: '/timesheet' })
const day = (name) => screen.findByRole('button', { name })

// "Today" is Wednesday 14 Oct 2026; only Date is faked, so requests run normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0))
  onMonthChange.mockClear()
  onOpenDay.mockClear()
  server.use(calendar())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setViewport(1280)
})

const mixedDay = {
  entries: [entry({ id: 'a', milestone_id: 'm1', hours: 6, status: 'approved' }), entry({ id: 'b', milestone_id: 'm2', hours: 2 }),
    entry({ id: 'c', milestone_id: 'm3', hours: 3, status: 'rejected' })],
  drafts: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 1.5 }],
}

describe('Month view day boxes', () => {
  test("a day box names its date, total and each milestone's hours with status", async () => {
    server.use(calendar(mixedDay))
    render()
    expect(await day('Wed 14 Oct, today, 8 hours, Schema Mapping 6 hours approved, Schema Mapping 1.5 hours from timer, Build 2 hours pending, Cutover 3 hours rejected'))
      .toBeInTheDocument()
  })

  test('a day with only a timer draft counts zero hours', async () => {
    server.use(calendar({ drafts: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 1.5 }] }))
    render()
    expect(await day('Wed 14 Oct, today, 0 hours, Schema Mapping 1.5 hours from timer')).toBeInTheDocument()
  })

  test('rejected hours are shown struck through and not counted', async () => {
    server.use(calendar({ entries: mixedDay.entries }))
    render()
    const box = await day(/^Wed 14 Oct/)
    expect(within(box).getByText('Cutover 3h')).toHaveStyle('text-decoration: line-through')
    expect(within(box).getByText('Build 2h')).not.toHaveStyle('text-decoration: line-through')
    expect(within(box).getByText('8h')).toBeInTheDocument()
  })

  test('days outside the month dim only the date number, not the lines', async () => {
    server.use(calendar({ entries: [entry({ work_date: '2026-09-30', hours: 3 })] }))
    render()
    const box = await day(/^Wed 30 Sep, 3 hours/)
    expect(box).not.toHaveStyle('opacity: 0.5')
    expect(within(box).getByText('Schema Mapping 3h')).not.toHaveStyle('opacity: 0.5')
  })

  test('a day over 24 hours says so', async () => {
    server.use(calendar({ entries: [entry({ hours: 20 }), entry({ id: 'e2', milestone_id: 'm2', hours: 6 })] }))
    render()
    const box = await day('Wed 14 Oct, today, 26 hours, over 24 hours, Schema Mapping 20 hours pending, Build 6 hours pending')
    expect(within(box).getByText('26h')).toHaveStyle('color: rgb(179, 38, 30)')
  })

  test('an overtime day says so', async () => {
    server.use(calendar({ entries: [entry({ over_40: true, label: 'Pending (Overtime requested from Eli Employee)' })] }))
    render()
    const box = await day('Wed 14 Oct, today, 8 hours, overtime, Schema Mapping 8 hours pending')
    expect(within(box).getByText('Overtime')).toBeInTheDocument()
  })

  test("only today's box says today", async () => {
    render()
    expect(await day('Wed 14 Oct, today, 0 hours')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mon 19 Oct, 0 hours' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /, today,/ })).toHaveLength(1)
  })

  test("a day's lines follow the bars' order, with a timer draft right after its milestone's saved hours", async () => {
    server.use(calendar({
      milestones: [m2, m1, m3],
      entries: [entry({ id: 'a', milestone_id: 'm3', hours: 1 }), entry({ id: 'b', milestone_id: 'm1', hours: 2 }), entry({ id: 'c', milestone_id: 'm2', hours: 3 })],
      drafts: [{ milestone_id: 'm2', work_date: '2026-10-14', hours: 0.5 }],
    }))
    render()
    expect(await day('Wed 14 Oct, today, 6 hours, Build 3 hours pending, Build 0.5 hours from timer, Schema Mapping 2 hours pending, Cutover 1 hour pending'))
      .toBeInTheDocument()
  })

  test('1 hour is singular', async () => {
    server.use(calendar({ entries: [entry({ hours: 1 })] }))
    render()
    expect(await day('Wed 14 Oct, today, 1 hour, Schema Mapping 1 hour pending')).toBeInTheDocument()
  })

  test('a past weekday with no hours says No hours; weekends and future days say nothing', async () => {
    render()
    expect(await day('Tue 13 Oct, no hours')).toHaveTextContent('No hours')
    expect(screen.getAllByText('No hours')).toHaveLength(9) // Oct 1-2, 5-9, 12-13
    expect(screen.getByRole('button', { name: 'Sat 10 Oct, 0 hours' })).not.toHaveTextContent('No hours')
    expect(screen.getByRole('button', { name: 'Mon 19 Oct, 0 hours' })).not.toHaveTextContent('No hours')
    expect(screen.getByRole('button', { name: 'Wed 30 Sep, 0 hours' })).not.toHaveTextContent('No hours')
  })

  test('a busy day shows 3 lines and +1 more but names all 4', async () => {
    const four = [m1, m2, m3, m4]
    server.use(calendar({ milestones: four, entries: four.map((m, i) => entry({ id: `x${i}`, milestone_id: m.id, hours: 1 })) }))
    render()
    const box = await day(/^Wed 14 Oct, today, 4 hours/)
    expect(box).toHaveAccessibleName(/Hypercare 1 hour pending/)
    expect(within(box).getByText('Cutover 1h')).toBeInTheDocument()
    expect(within(box).queryByText('Hypercare 1h')).not.toBeInTheDocument()
    expect(within(box).getByText('+1 more')).toBeInTheDocument()
  })

  test('clicking a day calls onOpenDay with its date', async () => {
    render()
    await userEvent.click(await day('Mon 19 Oct, 0 hours'))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-19')
  })
})

describe('Month view bars', () => {
  test('milestone bars link to the milestone and carry their dates and state', async () => {
    render()
    const bar = await screen.findByRole('link', { name: 'Build, Oct 13 to Oct 16, In progress' })
    expect(bar).toHaveAttribute('href', '/projects/p1?tab=milestones&milestone=m2')
  })

  test('a bar 3 or more columns wide shows its state after the name; a narrower one shows the name only', async () => {
    const short = milestone('m8', 'Sign-off', { start_date: '2026-10-14', end_date: '2026-10-15' })
    server.use(calendar({ milestones: [m2, short] }))
    render()
    const wide = await screen.findByRole('link', { name: 'Build, Oct 13 to Oct 16, In progress' })
    expect(wide).toHaveTextContent('Build · In progress')
    const narrow = screen.getByRole('link', { name: 'Sign-off, Oct 14 to Oct 15, In progress' })
    expect(narrow).toHaveTextContent(/^Sign-off/)
    expect(narrow).not.toHaveTextContent('In progress')
  })

  test('a bar ending this week marks its due day, and an unfinished one past its end is overdue', async () => {
    server.use(calendar({ milestones: [m2, milestone('m5', 'Discovery', { start_date: '2026-09-28', end_date: '2026-10-02' })] }))
    render()
    expect(await day('Fri 16 Oct, 0 hours, due: Build')).toBeInTheDocument()
    const late = screen.getByRole('link', { name: 'Discovery, Sep 28 to Oct 2, In progress, overdue' })
    expect(within(late).getByText('Overdue')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'Build, Oct 13 to Oct 16, In progress' })).getByText('Due')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fri 2 Oct, no hours, due: Discovery' })).toBeInTheDocument()
  })

  test('a fourth overlapping milestone goes behind 1 more milestone this week', async () => {
    server.use(calendar({ milestones: [m1, m2, m3, m4] }))
    render()
    const more = await screen.findByRole('button', { name: '1 more milestone this week' })
    expect(screen.queryByRole('link', { name: /^Hypercare/ })).not.toBeInTheDocument()
    await userEvent.click(more)
    const list = await screen.findByRole('list', { name: 'More milestones this week' })
    expect(within(list).getByRole('link', { name: 'Hypercare, Oct 13 to Oct 15, In progress' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /^Hypercare/ })).toHaveLength(1) // only the popover's
  })

  test('hidden milestones are counted in the plural too', async () => {
    const five = [m1, m2, m3, m4, milestone('m6', 'Retro')]
    server.use(calendar({ milestones: five }))
    render()
    expect(await screen.findByRole('button', { name: '2 more milestones this week' })).toBeInTheDocument()
  })

  test('a logged-but-unassigned milestone still gets a bar and named lines', async () => {
    const help = milestone('m7', 'Support', { role: null, start_date: '2026-10-14', end_date: '2026-10-14' })
    server.use(calendar({ milestones: [help], entries: [entry({ milestone_id: 'm7', hours: 2 })] }))
    render()
    expect(await screen.findByRole('link', { name: 'Support, Oct 14 to Oct 14, In progress' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Support 2 hours pending/ })).toBeInTheDocument()
  })
})

describe('Month view header, loading and states', () => {
  test("the header totals the month's pending and approved hours", async () => {
    server.use(calendar({ entries: [
      entry({ id: 'a', work_date: '2026-10-05', hours: 10 }), entry({ id: 'b', work_date: '2026-10-14', hours: 6, status: 'approved' }),
      entry({ id: 'c', work_date: '2026-10-15', hours: 2 }), entry({ id: 'd', work_date: '2026-10-06', hours: 0.1 }),
      entry({ id: 'e', work_date: '2026-10-07', hours: 0.2 }), entry({ id: 'f', work_date: '2026-09-30', hours: 5 }),
      entry({ id: 'g', work_date: '2026-10-08', hours: 4, status: 'rejected' })] }))
    render()
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    expect(await screen.findByText('18.3h logged in October')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'October 2026' })).toBeInTheDocument()
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByRole('columnheader', { name: d })).toBeInTheDocument()
    }
  })

  test('Previous month, Next month and This month call onMonthChange', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onMonthChange).toHaveBeenLastCalledWith('2026-09')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onMonthChange).toHaveBeenLastCalledWith('2026-11')
    await user.click(screen.getByRole('button', { name: 'This month' }))
    expect(onMonthChange).toHaveBeenLastCalledWith('2026-10')
  })

  test("a new month shows a loading grid, never the previous month's hours", async () => {
    function Harness() {
      const [month, setMonth] = useState('2026-10')
      return <MonthView month={month} onMonthChange={setMonth} onOpenDay={onOpenDay} />
    }
    // October answers at once; November never does.
    server.use(http.get(`${API}/time-entries/calendar`, async ({ request }) => {
      const month = new URL(request.url).searchParams.get('month')
      if (month === '2026-11') await delay('infinite')
      return HttpResponse.json({ month, range: RANGES[month], user: { id: users.employee.id, name: 'Eli Employee' },
        milestones: [m1, m2, m3], ...mixedDay })
    }))
    renderAsUser(<Harness />, { user: users.employee, route: '/timesheet' })
    expect(await day(/^Wed 14 Oct/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading the calendar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Wed 14 Oct/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/logged in/)).not.toBeInTheDocument()
  })

  test('an empty month still draws the grid and says Nothing assigned to you this month', async () => {
    server.use(calendar({ milestones: [] }))
    render()
    expect(await screen.findByText('Nothing assigned to you this month')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'October 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mon 19 Oct, 0 hours' })).toBeInTheDocument()
  })

  test('a failed load shows the error with a retry', async () => {
    server.use(http.get(`${API}/time-entries/calendar`, () => HttpResponse.json({ error: { message: 'Calendar broke' } }, { status: 500 })))
    render()
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar broke')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  test('the legend draws Due and Overdue as the grid does', async () => {
    server.use(calendar({ milestones: [m2, milestone('m5', 'Discovery', { start_date: '2026-09-28', end_date: '2026-10-02' })] }))
    render()
    await screen.findByRole('table')
    const legend = screen.getByRole('list', { name: 'Legend' })
    const bar = screen.getByRole('link', { name: 'Build, Oct 13 to Oct 16, In progress' })
    expect(within(legend).getByText('Due')).toHaveStyle({ fontWeight: '700' })
    expect(within(bar).getByText('Due')).toHaveStyle({ fontWeight: '700' })
    expect(within(legend).getByText('Overdue').closest('li')).toHaveTextContent('⚠ Overdue')
    expect(within(legend).queryByText(/Milestone with hours that day/)).not.toBeInTheDocument() // phones only
  })

  test('the legend names every style', async () => {
    render()
    await screen.findByRole('table')
    const legend = screen.getByRole('list', { name: 'Legend' })
    for (const item of ['Approved', 'Pending', 'Rejected', 'From timer', 'Due', 'Overdue']) {
      expect(within(legend).getByText(item)).toBeInTheDocument()
    }
    const states = screen.getByRole('list', { name: 'Milestone states' })
    for (const item of ['Not started', 'In progress', 'Ready for review', 'Completed', 'Waiting (striped)', 'Blocked (striped)']) {
      expect(within(states).getByText(item)).toBeInTheDocument()
    }
  })
})

describe('Month view on a phone', () => {
  test('tapping a day shows its details and Open this day opens it', async () => {
    setViewport(390)
    server.use(calendar(mixedDay))
    const user = userEvent.setup()
    render()
    // Today is selected by default.
    const region = await screen.findByRole('region', { name: 'Wednesday 14 October 2026' })
    expect(within(region).getByText('Schema Mapping 6h')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Oct 13 to Oct 16/ })).not.toBeInTheDocument() // no bars on a phone

    await user.click(screen.getByRole('button', { name: /^Fri 16 Oct/ }))
    const friday = await screen.findByRole('region', { name: 'Friday 16 October 2026' })
    expect(within(friday).getByText('Build').closest('li')).toHaveTextContent('Due')
    await user.click(within(friday).getByRole('button', { name: 'Open this day' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-16')
    await waitFor(() => expect(onMonthChange).not.toHaveBeenCalled())
  })

  test('the legend explains the dots and a day shows only the overtime mark', async () => {
    setViewport(390)
    server.use(calendar({ entries: [entry({ over_40: true })] }))
    render()
    await screen.findByRole('table')
    expect(within(screen.getByRole('list', { name: 'Legend' })).getByText('Milestone with hours that day (coloured by state)')).toBeInTheDocument()
    const box = await day('Wed 14 Oct, today, 8 hours, overtime, Schema Mapping 8 hours pending')
    expect(within(box).queryByText('Overtime')).not.toBeInTheDocument()
    expect(box).toHaveTextContent('⚠')
  })

  test('with today outside the month the 1st is selected', async () => {
    setViewport(390)
    render('2026-11')
    expect(await screen.findByRole('region', { name: 'Sunday 1 November 2026' })).toBeInTheDocument()
  })
})
