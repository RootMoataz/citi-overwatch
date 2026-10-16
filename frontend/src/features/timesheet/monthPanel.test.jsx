import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { server } from '../../test/server.js'
import {
  calendar, calls, cardOf, dayBox, entry, lock, m1, m2, m3, m4, milestone, panel, renderMonth as render, setUpMonthTests,
} from '../../test/monthCalendar.jsx'

setUpMonthTests()

describe('Month view selection and panel', () => {
  test('clicking a day selects it and shows its panel', async () => {
    const user = userEvent.setup()
    render()
    expect(await panel('Wednesday 14 October 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Wed 14 Oct/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /^Mon 19 Oct/ }))
    expect(calls.onSelectDay).toHaveBeenCalledWith('2026-10-19')
    expect(calls.onOpenDay).not.toHaveBeenCalled()
    expect(await panel('Monday 19 October 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Mon 19 Oct/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Wed 14 Oct/ })).toHaveAttribute('aria-pressed', 'false')
  })

  test('the panel lists each line with status, project, hours, timer-linked and source', async () => {
    server.use(calendar({
      milestones: [m1, m2, m3, m4],
      entries: [entry({ id: 'a', hours: 6, status: 'approved' }), entry({ id: 'b', milestone_id: 'm2', hours: 2, tracked_hours: 2 }),
        entry({ id: 'c', milestone_id: 'm3', hours: 3, tracked_hours: 1 })],
      drafts: [{ milestone_id: 'm4', work_date: '2026-10-14', hours: 1.5 }],
      locks: [lock({ milestone_id: 'm2', hours: 2, tracked_hours: 2 }), lock({ milestone_id: 'm3', hours: 3, tracked_hours: 1 }),
        lock({ milestone_id: 'm4', hours: 1.5, draft_hours: 1.5, tracked_hours: 0 })],
    }))
    render()
    const region = await panel('Wednesday 14 October 2026')
    expect(within(region).getByText('Today')).toBeInTheDocument()
    expect(within(region).getByText('11h · 6h approved, 5h pending, 1.5h not submitted')).toBeInTheDocument()

    const mapping = cardOf(region, 'Schema Mapping')
    expect(within(mapping).getByText('Approved')).toBeInTheDocument()
    expect(within(mapping).getByText('Project: Apollo Data Migration')).toBeInTheDocument()
    expect(mapping).toHaveTextContent(/Hours\s*6h/)
    expect(mapping).toHaveTextContent(/Timer-linked entry\s*No/)
    expect(mapping).toHaveTextContent(/Source\s*Manual/)
    expect(within(mapping).queryByRole('img', { name: 'Locked' })).not.toBeInTheDocument()

    const build = cardOf(region, 'Build')
    expect(within(build).getByText('Pending approval')).toBeInTheDocument()
    expect(within(build).getByText('Project: Zephyr Portal')).toBeInTheDocument()
    expect(build).toHaveTextContent(/Timer-linked entry\s*Yes/)
    expect(build).toHaveTextContent(/Source\s*Tracked/)

    expect(cardOf(region, 'Cutover')).toHaveTextContent(/Source\s*Mixed/)

    const hypercare = cardOf(region, 'Hypercare')
    expect(within(hypercare).getByText('Not submitted')).toBeInTheDocument()
    expect(hypercare).toHaveTextContent(/Hours\s*1.5h/)
    expect(hypercare).toHaveTextContent(/Timer-linked entry\s*Yes/)
  })

  test("a rejected line shows the manager's reason and Edit in Day view", async () => {
    server.use(calendar({ entries: [entry({ hours: 3, status: 'rejected', rejection_reason: 'Split this across two milestones' })] }))
    const user = userEvent.setup()
    render()
    expect(await dayBox('Wed 14 Oct, today, 0 hours, Schema Mapping 3 hours needs revision')).toBeInTheDocument()
    const region = await panel('Wednesday 14 October 2026')
    const card = cardOf(region, 'Schema Mapping')
    expect(within(card).getByText('Needs revision')).toBeInTheDocument()
    expect(within(card).getByText('Reason: Split this across two milestones')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Request a change/ })).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Edit in Day view, Schema Mapping' }))
    expect(calls.onOpenDay).toHaveBeenCalledWith('2026-10-14')
  })

  test('a timer-locked line shows the lock and Request a change with that cell', async () => {
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock()] }))
    const user = userEvent.setup()
    render()
    const card = cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')
    expect(within(card).getByRole('img', { name: 'Locked' })).toBeInTheDocument()
    expect(within(card).getByText('Timer hours are locked; your manager approves any change')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /in Day view/ })).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Request a change, Schema Mapping' }))
    expect(calls.onRequest).toHaveBeenCalledWith({ milestoneId: 'm1', date: '2026-10-14', hours: 4, label: 'Schema Mapping' })
  })

  test("a saved manual line sharing a cell with a timer draft says it is locked with the cell's timer hours", async () => {
    server.use(calendar({ entries: [entry({ hours: 2, tracked_hours: 0 })], drafts: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 1.5 }],
      locks: [lock({ hours: 1.5, draft_hours: 1.5, tracked_hours: 0 })] }))
    render()
    const region = await panel('Wednesday 14 October 2026')
    const card = within(region).getAllByRole('listitem').find((li) => li.textContent.includes('Pending approval'))
    expect(card).toHaveTextContent(/Source\s*Manual/)
    expect(within(card).getByText("Locked with this cell's timer hours")).toBeInTheDocument()
  })

  test("a saved manual line sharing a cell with timer hours says its request covers the whole cell", async () => {
    // The cell holds 2h typed and saved plus 1.5h from a stopped timer: a change request is for the cell's 3.5h.
    server.use(calendar({ entries: [entry({ hours: 2, tracked_hours: 0 })], drafts: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 1.5 }],
      locks: [lock({ hours: 3.5, draft_hours: 1.5, tracked_hours: 0 })] }))
    const user = userEvent.setup()
    render()
    const region = await panel('Wednesday 14 October 2026')
    const card = within(region).getAllByRole('listitem').find((li) => li.textContent.includes('Pending approval'))
    expect(within(card).getByText("This request covers the cell's 3.5h, including 1.5h from your timer")).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Request a change, Schema Mapping' }))
    expect(calls.onRequest).toHaveBeenCalledWith({ milestoneId: 'm1', date: '2026-10-14', hours: 3.5, label: 'Schema Mapping' })
  })

  test('a plain timer line does not explain the cell total (its hours are the cell)', async () => {
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock()] }))
    render()
    const card = cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')
    expect(within(card).queryByText(/This request covers/)).not.toBeInTheDocument()
  })

  test('a plain timer line has no cell-sharing note', async () => {
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock()] }))
    render()
    const card = cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')
    expect(within(card).queryByText("Locked with this cell's timer hours")).not.toBeInTheDocument()
  })

  test('the day-level Edit in Day view sits under "Other hours" when cards exist, and alone when none do', async () => {
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock()] }))
    const first = render()
    const region = await panel('Wednesday 14 October 2026')
    expect(within(region).getByText('Other hours')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Edit in Day view' })).toBeInTheDocument()
    first.unmount()
    server.use(calendar({ entries: [] }))
    render()
    const empty = await panel('Wednesday 14 October 2026')
    expect(within(empty).getByRole('button', { name: 'Edit in Day view' })).toBeInTheDocument()
    expect(within(empty).queryByText('Other hours')).not.toBeInTheDocument()
  })

  test('a pending change request shows Change requested, disabled', async () => {
    const request = { id: 'r1', current_hours: 4, requested_hours: 3, reason: 'Timer ran over lunch', status: 'pending' }
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock({ request })] }))
    render()
    const card = cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')
    expect(within(card).getByRole('button', { name: 'Change requested' })).toBeDisabled()
    expect(within(card).queryByRole('button', { name: /^Request a change/ })).not.toBeInTheDocument()
  })

  test("the panel lists that day's milestone dates with Overdue when past and unfinished, and View milestones links to the milestone", async () => {
    server.use(calendar({ milestones: [
      milestone('m5', 'Discovery', { end_date: '2026-10-09' }),
      milestone('m6', 'Build: frontend', { end_date: '2026-10-23', project: { id: 'p2', name: 'Zephyr Portal', status: 'active' } }),
    ] }))
    const user = userEvent.setup()
    render('2026-10', '2026-10-09')
    const past = await panel('Friday 9 October 2026')
    expect(within(past).getByRole('heading', { name: 'Milestone dates' })).toBeInTheDocument()
    const late = within(past).getByText('Discovery · Due Oct 9').closest('li')
    expect(late).toHaveTextContent('Overdue')
    expect(within(late).getByRole('link', { name: 'View milestones, Discovery' })).toHaveAttribute('href', '/projects/p1?tab=milestones&milestone=m5')

    await user.click(screen.getByRole('button', { name: /^Fri 23 Oct/ }))
    const ahead = await panel('Friday 23 October 2026')
    const due = within(ahead).getByText('Build: frontend · Due Oct 23').closest('li')
    expect(due).not.toHaveTextContent('Overdue')
    expect(within(due).getByRole('link', { name: 'View milestones, Build: frontend' })).toHaveAttribute('href', '/projects/p2?tab=milestones&milestone=m6')
    expect(within(ahead).queryByText(/Discovery/)).not.toBeInTheDocument()
  })

  test('a deadline on a day with no hours shows No hours and the milestone date', async () => {
    server.use(calendar({ milestones: [m1, milestone('m5', 'Build: frontend', { end_date: '2026-10-23' }),
      milestone('m6', 'Schema Mapping', { end_date: '2026-10-23' })] }))
    render('2026-10', '2026-10-23')
    expect(await dayBox('Fri 23 Oct, no hours, 2 milestone deadlines')).toHaveAttribute('aria-pressed', 'true')
    const region = await panel('Friday 23 October 2026')
    expect(within(region).getByText('No hours')).toBeInTheDocument()
    expect(within(region).getByText('Build: frontend · Due Oct 23')).toBeInTheDocument()
    expect(within(region).getByText('Schema Mapping · Due Oct 23')).toBeInTheDocument()
    expect(within(region).queryByText('Overdue')).not.toBeInTheDocument()
  })

  test('?day= outside the shown month falls back to today or the 1st', async () => {
    const first = render('2026-10', '2026-09-30')
    expect(await panel('Wednesday 14 October 2026')).toBeInTheDocument()
    first.unmount()
    const second = render('2026-11', '2026-10-14')
    expect(await panel('Sunday 1 November 2026')).toBeInTheDocument()
    second.unmount()
    render('2026-10', '2026-10-45') // not a real date
    expect(await panel('Wednesday 14 October 2026')).toBeInTheDocument()
  })

  test('a timer draft card says it is not submitted and offers its own Edit in Day view; the day caption follows', async () => {
    server.use(calendar({ drafts: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 1.5 }],
      locks: [lock({ hours: 1.5, draft_hours: 1.5, tracked_hours: 0 })] }))
    const user = userEvent.setup()
    render()
    const region = await panel('Wednesday 14 October 2026')
    const card = cardOf(region, 'Schema Mapping')
    expect(within(card).getByText('Not submitted yet — submit it in the Day view')).toBeInTheDocument()
    expect(within(card).queryByText('Timer hours are locked; your manager approves any change')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Request a change/ })).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Edit in Day view, Schema Mapping' }))
    expect(calls.onOpenDay).toHaveBeenCalledWith('2026-10-14')
    expect(within(region).getByText('Submit timer hours or log other hours')).toBeInTheDocument()
    expect(within(region).queryByText('Other hours')).not.toBeInTheDocument()
  })

  test('hours on a milestone the person is no longer assigned to have no dead actions', async () => {
    const gone = milestone('m1', 'Schema Mapping', { role: null })
    server.use(calendar({ milestones: [gone], entries: [entry({ hours: 4, tracked_hours: 4 }), entry({ id: 'x', hours: 2, status: 'rejected' })],
      locks: [lock()] }))
    render()
    const region = await panel('Wednesday 14 October 2026')
    const cards = within(region).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    for (const li of cards) {
      expect(within(li).getByText("You're no longer assigned to this milestone")).toBeInTheDocument()
      expect(within(li).queryByRole('button')).not.toBeInTheDocument()
    }
  })

  test('a pending request shows on a closed project, with the hours asked for', async () => {
    const request = { id: 'r1', current_hours: 4, requested_hours: 1.5, reason: 'Timer ran over lunch', status: 'pending' }
    const closed = milestone('m1', 'Schema Mapping', { project: { id: 'p1', name: 'Apollo Data Migration', status: 'completed' } })
    server.use(calendar({ milestones: [closed], entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock({ request })] }))
    render()
    const card = cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')
    expect(within(card).getByRole('button', { name: /^Change requested/ })).toBeDisabled()
    expect(within(card).getByText('You asked for 1.5h')).toBeInTheDocument()
  })

  test('the source comes from the entry when the API sends it', async () => {
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 0, source: 'mixed' })] }))
    render()
    expect(cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')).toHaveTextContent(/Source\s*Mixed/)
  })

  test('the panel summary flags a day holding an over-40 entry', async () => {
    server.use(calendar({ entries: [entry({ over_40: true })] }))
    render()
    const region = await panel('Wednesday 14 October 2026')
    expect(within(region).getByText('Over 40h this week')).toBeInTheDocument()
  })

  test('a keyboard selection on a day of another month focuses that day\'s panel heading once the month has loaded', async () => {
    const user = userEvent.setup()
    render('2026-10', undefined, { follow: true })
    await panel('Wednesday 14 October 2026')
    screen.getByRole('button', { name: /^Mon 28 Sep/ }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Monday 28 September 2026' })).toHaveFocus())
  })

  test('after selecting a day with the keyboard focus moves to the panel heading; a click leaves it', async () => {
    const user = userEvent.setup()
    render()
    await panel('Wednesday 14 October 2026')
    const box = screen.getByRole('button', { name: /^Mon 19 Oct/ })
    await user.click(box)
    expect(box).toHaveFocus()
    screen.getByRole('button', { name: /^Tue 20 Oct/ }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { name: 'Tuesday 20 October 2026' })).toHaveFocus()
    screen.getByRole('button', { name: /^Wed 21 Oct/ }).focus()
    await user.keyboard(' ')
    expect(screen.getByRole('heading', { name: 'Wednesday 21 October 2026' })).toHaveFocus()
  })
})

describe('Month view keyboard: one tab stop, arrow keys between days', () => {
  const day = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
  const tabbable = () => screen.getAllByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w+/ })
    .filter((b) => b.tabIndex === 0)

  test('the grid is a single tab stop on the selected day; Tab moves on past the grid', async () => {
    const user = userEvent.setup()
    render()
    await panel('Wednesday 14 October 2026')
    expect(tabbable()).toEqual([day('Wed 14 Oct')])
    screen.getByRole('button', { name: 'Next month' }).focus()
    await user.tab()
    expect(day('Wed 14 Oct')).toHaveFocus()
    await user.tab()
    expect(document.activeElement.closest('table')).toBeNull()
  })

  test('arrows move between days, Home and End to the week ends; the tab stop follows and nothing is selected', async () => {
    const user = userEvent.setup()
    render()
    await panel('Wednesday 14 October 2026')
    day('Wed 14 Oct').focus()
    for (const [key, name] of [['{ArrowRight}', 'Thu 15 Oct'], ['{ArrowDown}', 'Thu 22 Oct'], ['{ArrowLeft}', 'Wed 21 Oct'],
      ['{ArrowUp}', 'Wed 14 Oct'], ['{Home}', 'Mon 12 Oct'], ['{End}', 'Sun 18 Oct']]) {
      await user.keyboard(key)
      expect(day(name)).toHaveFocus()
      expect(tabbable()).toEqual([day(name)])
    }
    expect(calls.onSelectDay).not.toHaveBeenCalled()
    expect(day('Wed 14 Oct')).toHaveAttribute('aria-pressed', 'true')
    // Browser shortcuts are left alone (Alt+Left is Back).
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    expect(day('Sun 18 Oct')).toHaveFocus()
  })

  test('Enter or Space selects the focused day and moves focus to its panel heading', async () => {
    const user = userEvent.setup()
    render()
    await panel('Wednesday 14 October 2026')
    day('Wed 14 Oct').focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(calls.onSelectDay).toHaveBeenLastCalledWith('2026-10-15')
    expect(screen.getByRole('heading', { name: 'Thursday 15 October 2026' })).toHaveFocus()
    day('Thu 15 Oct').focus()
    await user.keyboard('{ArrowRight} ')
    expect(calls.onSelectDay).toHaveBeenLastCalledWith('2026-10-16')
  })

  test('PageDown and PageUp open the next and previous month with focus on the same date', async () => {
    const user = userEvent.setup()
    render('2026-10', undefined, { follow: true })
    await panel('Wednesday 14 October 2026')
    day('Wed 14 Oct').focus()
    await user.keyboard('{PageDown}')
    expect(calls.onMonthChange).toHaveBeenLastCalledWith('2026-11')
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    await waitFor(() => expect(day('Sat 14 Nov')).toHaveFocus())
    expect(tabbable()).toEqual([day('Sat 14 Nov')])
    await user.keyboard('{PageUp}')
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    await waitFor(() => expect(day('Wed 14 Oct')).toHaveFocus())
  })

  test('Page Up and Page Down go by the month shown, also from a day of the month before or after in the grid', async () => {
    const user = userEvent.setup()
    render('2026-10', undefined, { follow: true })
    await panel('Wednesday 14 October 2026')
    // 28 Sep leads the October grid: Page Up is September (the month before October), not August.
    day('Mon 28 Sep').focus()
    await user.keyboard('{PageUp}')
    expect(calls.onMonthChange).toHaveBeenLastCalledWith('2026-09')
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    await waitFor(() => expect(day('Mon 28 Sep')).toHaveFocus())
    // 4 Oct trails the September grid: Page Down is October, on the 4th.
    day('Sun 4 Oct').focus()
    await user.keyboard('{PageDown}')
    expect(calls.onMonthChange).toHaveBeenLastCalledWith('2026-10')
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    await waitFor(() => expect(day('Sun 4 Oct')).toHaveFocus())
    // 1 Nov trails the October grid: Page Down is November, on the 1st.
    day('Sun 1 Nov').focus()
    await user.keyboard('{PageDown}')
    expect(calls.onMonthChange).toHaveBeenLastCalledWith('2026-11')
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    await waitFor(() => expect(day('Sun 1 Nov')).toHaveFocus())
  })

  test('an arrow past the edge of the grid opens the next month there', async () => {
    const user = userEvent.setup()
    render('2026-10', undefined, { follow: true })
    await panel('Wednesday 14 October 2026')
    day('Sun 1 Nov').focus()
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    await waitFor(() => expect(day('Mon 2 Nov')).toHaveFocus())
  })

  test('the grid keeps its table semantics and the days keep their names', async () => {
    render()
    await panel('Wednesday 14 October 2026')
    const table = screen.getByRole('table', { name: 'October 2026' })
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(within(table).getAllByRole('cell')).toHaveLength(35)
    expect(table).toHaveAccessibleDescription(/arrow keys/i)
  })
})
