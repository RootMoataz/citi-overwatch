import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, delay, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import {
  RANGES, calendar, calls, chips, dayBox, entry, m1, m2, m3, m4, milestone, mixedDay, panel, renderMonth as render, setUpMonthTests,
} from '../../test/monthCalendar.jsx'
import MonthView from './MonthView.jsx'

setUpMonthTests()

describe('Month view grid', () => {
  test('no milestone bars or "more milestones" buttons are drawn', async () => {
    server.use(calendar({ milestones: [m1, m2, m3, m4, milestone('m6', 'Retro')], ...mixedDay }))
    render()
    await screen.findByRole('table', { name: 'October 2026' })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /more milestones? this week/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Milestone states' })).not.toBeInTheDocument()
    expect(screen.queryByText(/In progress/)).not.toBeInTheDocument()
  })

  test('a day box shows its total and one chip per line with icon and status word', async () => {
    server.use(calendar({ entries: mixedDay.entries, drafts: [{ milestone_id: 'm1', work_date: '2026-10-13', hours: 1.5 }] }))
    render()
    const box = await dayBox('Wed 14 Oct, today, 8 hours, Schema Mapping 6 hours approved, Build 2 hours pending, Cutover 3 hours needs revision')
    expect(within(box).getByText('8h')).toBeInTheDocument()
    expect(chips(box)).toHaveLength(3)
    const [approved, pending, rejected] = chips(box)
    const tuesday = screen.getByRole('button', { name: 'Tue 13 Oct, 0 hours, Schema Mapping 1.5 hours not submitted' })
    expect(chips(tuesday)).toHaveLength(1)
    const [draft] = chips(tuesday)
    expect(approved).toHaveTextContent('Schema Mapping 6h')
    expect(within(approved).getByRole('img', { name: 'Approved' })).toBeInTheDocument()
    expect(within(pending).getByText('Pending')).toBeInTheDocument()
    expect(pending).toHaveTextContent('Build 2h')
    expect(within(rejected).getByText('Needs revision')).toBeInTheDocument()
    expect(within(rejected).getByText('3h')).toHaveStyle('text-decoration: line-through')
    expect(within(rejected).getByText('Cutover')).not.toHaveStyle('text-decoration: line-through')
    expect(within(draft).getByText('Not submitted')).toBeInTheDocument()
    expect(draft).toHaveStyle('border-style: dashed')
    for (const chip of [approved, draft, pending, rejected]) expect(chip.querySelector('svg')).toBeInTheDocument()
  })

  test('rejected and draft hours are not in the day total', async () => {
    server.use(calendar({
      entries: [entry({ id: 'a', hours: 2, status: 'approved' }), entry({ id: 'b', milestone_id: 'm2', hours: 3, status: 'rejected' }),
        entry({ id: 'c', work_date: '2026-10-13', hours: 4, status: 'rejected' })],
      drafts: [{ milestone_id: 'm3', work_date: '2026-10-14', hours: 1.5 }],
    }))
    render()
    const box = await dayBox(/^Wed 14 Oct, today, 2 hours,/)
    expect(within(box).getByText('2h')).toBeInTheDocument()
    // A day holding only a rejected line counts nothing.
    const tuesday = screen.getByRole('button', { name: 'Tue 13 Oct, 0 hours, Schema Mapping 4 hours needs revision' })
    expect(within(tuesday).getByText('0h')).toBeInTheDocument()
    expect(within(tuesday).getByText('4h')).toHaveStyle('text-decoration: line-through')
  })

  test('a day with an over-40 entry shows "⚠ Over 40h"', async () => {
    server.use(calendar({ entries: [entry({ over_40: true, label: 'Pending (Overtime requested from Eli Employee)' }),
      entry({ id: 'e2', work_date: '2026-10-13', over_40: true, status: 'rejected' })] }))
    render()
    const box = await dayBox('Wed 14 Oct, today, 8 hours, over 40 hours, Schema Mapping 8 hours pending')
    expect(box).toHaveTextContent('⚠ Over 40h')
    // A rejected entry no longer counts toward the week, so it carries no mark.
    expect(screen.getByRole('button', { name: /^Tue 13 Oct/ })).not.toHaveTextContent('Over 40h')
  })

  test('deadline markers count the milestones ending that day (1 / 2, singular / plural)', async () => {
    server.use(calendar({ milestones: [
      milestone('m5', 'Build: frontend', { end_date: '2026-10-23' }), milestone('m6', 'Schema Mapping', { end_date: '2026-10-23' }),
      milestone('m7', 'Cutover', { end_date: '2026-10-16' }),
      // Completed, and logged on without being assigned: neither is a deadline.
      milestone('m8', 'Discovery', { end_date: '2026-10-16', status: 'completed', display_status: 'completed' }),
      milestone('m9', 'Support', { end_date: '2026-10-16', role: null }),
    ] }))
    render()
    const friday = await dayBox('Fri 23 Oct, no hours, 2 milestone deadlines')
    expect(friday).toHaveTextContent('2 milestone deadlines')
    expect(screen.getByRole('button', { name: 'Fri 16 Oct, no hours, 1 milestone deadline' })).toHaveTextContent('1 milestone deadline')
  })

  test('a day with nothing shows an en dash', async () => {
    render()
    expect(within(await dayBox('Mon 19 Oct, no hours')).getByText('–')).toBeInTheDocument()
    // A past weekday reads the same: the old "No hours" note is gone from the grid.
    expect(within(screen.getByRole('button', { name: 'Tue 13 Oct, no hours' })).getByText('–')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText('No hours')).not.toBeInTheDocument()
  })

  test('a day over 24 hours says so in red', async () => {
    server.use(calendar({ entries: [entry({ hours: 20 }), entry({ id: 'e2', milestone_id: 'm2', hours: 6 })] }))
    render()
    const box = await dayBox('Wed 14 Oct, today, 26 hours, over 24 hours, Schema Mapping 20 hours pending, Build 6 hours pending')
    expect(within(box).getByText('26h')).toHaveStyle('color: rgb(179, 38, 30)')
  })

  test("only today's box says today, and 1 hour is singular", async () => {
    server.use(calendar({ entries: [entry({ hours: 1 })] }))
    render()
    expect(await dayBox('Wed 14 Oct, today, 1 hour, Schema Mapping 1 hour pending')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /, today,/ })).toHaveLength(1)
  })

  test("a day's lines follow the milestone list, with a timer draft right after its milestone's saved hours", async () => {
    server.use(calendar({
      milestones: [m2, m1, m3],
      entries: [entry({ id: 'a', milestone_id: 'm3', hours: 1 }), entry({ id: 'b', milestone_id: 'm1', hours: 2 }), entry({ id: 'c', milestone_id: 'm2', hours: 3 })],
      drafts: [{ milestone_id: 'm2', work_date: '2026-10-14', hours: 0.5 }],
    }))
    render()
    expect(await dayBox('Wed 14 Oct, today, 6 hours, Build 3 hours pending, Build 0.5 hours not submitted, Schema Mapping 2 hours pending, Cutover 1 hour pending'))
      .toBeInTheDocument()
  })

  test('a busy day shows 3 chips and +1 more but names all 4', async () => {
    const four = [m1, m2, m3, m4]
    server.use(calendar({ milestones: four, entries: four.map((m, i) => entry({ id: `x${i}`, milestone_id: m.id, hours: 1 })) }))
    render()
    const box = await dayBox(/^Wed 14 Oct, today, 4 hours/)
    expect(box).toHaveAccessibleName(/Hypercare 1 hour pending/)
    expect(chips(box)).toHaveLength(3)
    expect(within(box).getByText('+1 more')).toBeInTheDocument()
  })

  test('days outside the month show their month and dim only the date', async () => {
    server.use(calendar({ entries: [entry({ work_date: '2026-09-30', hours: 3 })] }))
    render()
    const box = await dayBox(/^Wed 30 Sep, 3 hours/)
    expect(within(box).getByText('30 Sep')).toHaveStyle('color: rgba(0, 0, 0, 0.38)')
    expect(chips(box)[0]).toHaveTextContent('Schema Mapping 3h')
    expect(box).not.toHaveStyle('opacity: 0.5')
  })
})

describe('Month view header, legend and states', () => {
  test('the header shows the month total and "Pending + approved · Rejected hours excluded."', async () => {
    server.use(calendar({ entries: [
      entry({ id: 'a', work_date: '2026-10-05', hours: 10 }), entry({ id: 'b', work_date: '2026-10-14', hours: 6, status: 'approved' }),
      entry({ id: 'c', work_date: '2026-10-15', hours: 2 }), entry({ id: 'd', work_date: '2026-10-06', hours: 0.1 }),
      entry({ id: 'e', work_date: '2026-10-07', hours: 0.2 }), entry({ id: 'f', work_date: '2026-09-30', hours: 5 }),
      entry({ id: 'g', work_date: '2026-10-08', hours: 4, status: 'rejected' })] }))
    render()
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    expect(await screen.findByText('18.3h logged in October')).toBeInTheDocument()
    expect(screen.getByText('Pending + approved · Rejected hours excluded.')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'October 2026' })).toBeInTheDocument()
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByRole('columnheader', { name: d })).toBeInTheDocument()
    }
  })

  test('the legend lists the four statuses and the milestone-dates note', async () => {
    render()
    await screen.findByRole('table')
    const legend = screen.getByRole('list', { name: 'Legend' })
    for (const item of ['Approved', 'Pending', 'Needs revision', 'Not submitted', 'Milestone dates appear separately from time-entry status.']) {
      expect(within(legend).getByText(item)).toBeInTheDocument()
    }
    expect(within(legend).queryByText(/Due|Overdue|From timer|Rejected/)).not.toBeInTheDocument()
  })

  test('Previous month, Next month and This month call onMonthChange', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(calls.onMonthChange).toHaveBeenLastCalledWith('2026-09')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(calls.onMonthChange).toHaveBeenLastCalledWith('2026-11')
    await user.click(screen.getByRole('button', { name: 'This month' }))
    expect(calls.onMonthChange).toHaveBeenLastCalledWith('2026-10')
  })

  test("a new month shows a loading grid, never the previous month's hours", async () => {
    function Paging() {
      const [month, setMonth] = useState('2026-10')
      return <MonthView month={month} onMonthChange={setMonth} onSelectDay={calls.onSelectDay} onOpenDay={calls.onOpenDay} onRequest={calls.onRequest} />
    }
    // October answers at once; November never does.
    server.use(http.get(`${API}/time-entries/calendar`, async ({ request }) => {
      const month = new URL(request.url).searchParams.get('month')
      if (month === '2026-11') await delay('infinite')
      return HttpResponse.json({ month, range: RANGES[month], user: { id: users.employee.id, name: 'Eli Employee' },
        milestones: [m1, m2, m3], ...mixedDay })
    }))
    renderAsUser(<Paging />, { user: users.employee, route: '/timesheet' })
    expect(await dayBox(/^Wed 14 Oct/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading the calendar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Wed 14 Oct/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/logged in/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  test('an empty month still draws the grid and says Nothing assigned to you this month', async () => {
    server.use(calendar({ milestones: [] }))
    render()
    expect(await screen.findByText('Nothing assigned to you this month')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'October 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mon 19 Oct, no hours' })).toBeInTheDocument()
  })

  test('a failed load shows the error with a retry', async () => {
    server.use(http.get(`${API}/time-entries/calendar`, () => HttpResponse.json({ error: { message: 'Calendar broke' } }, { status: 500 })))
    render()
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar broke')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('Month view on a phone', () => {
  test('dots are coloured by approval status and the panel sits under the grid', async () => {
    setViewport(390)
    server.use(calendar({ entries: mixedDay.entries }))
    render()
    const box = await dayBox('Wed 14 Oct, today, 8 hours, Schema Mapping 6 hours approved, Build 2 hours pending, Cutover 3 hours needs revision')
    expect(within(box).getByRole('img', { name: 'Approved' })).toHaveStyle('background-color: rgb(30, 125, 69)')
    expect(within(box).getByRole('img', { name: 'Pending' })).toHaveStyle('border: 2px solid rgb(178, 106, 0)')
    expect(within(box).getByRole('img', { name: 'Needs revision' })).toHaveStyle('background-color: rgb(179, 38, 30)')
    // shape as well as colour: filled circle, ring, square
    const shapes = ['Approved', 'Pending', 'Needs revision'].map((n) => within(box).getByRole('img', { name: n }).getAttribute('data-shape'))
    expect(shapes).toEqual(['circle', 'ring', 'square'])
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByTestId('legend-shape').map((e) => e.getAttribute('data-shape')))
      .toEqual(['circle', 'ring', 'square', 'dashed-square'])
    expect(chips(box)).toHaveLength(0) // no chips on a phone, only dots
    expect(within(screen.getByRole('list', { name: 'Legend' })).getByText('Approved')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'October 2026' })
    const region = await panel('Wednesday 14 October 2026')
    expect(table.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(region.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr)' })
    expect(within(region).getByText('Needs revision')).toBeInTheDocument()
  })

  test('on a desktop the panel sits beside the grid', async () => {
    render()
    const region = await panel('Wednesday 14 October 2026')
    expect(region.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr) 340px' })
  })

  test('a phone box shows the deadline and over-40 marks without their words', async () => {
    setViewport(390)
    server.use(calendar({ milestones: [m1, milestone('m5', 'Build: frontend', { end_date: '2026-10-14' })],
      entries: [entry({ over_40: true })] }))
    render()
    const box = await dayBox('Wed 14 Oct, today, 8 hours, over 40 hours, Schema Mapping 8 hours pending, 1 milestone deadline')
    expect(box).toHaveTextContent('⚠')
    expect(box).not.toHaveTextContent('Over 40h')
    expect(box).not.toHaveTextContent('milestone deadline')
  })
})
