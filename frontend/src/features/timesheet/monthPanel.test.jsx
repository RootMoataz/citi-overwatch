import { screen, within } from '@testing-library/react'
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
    expect(within(card).queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Edit in Day view' }))
    expect(calls.onOpenDay).toHaveBeenCalledWith('2026-10-14')
  })

  test('a timer-locked line shows the lock and Request a change with that cell', async () => {
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock()] }))
    const user = userEvent.setup()
    render()
    const card = cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')
    expect(within(card).getByRole('img', { name: 'Locked' })).toBeInTheDocument()
    expect(within(card).getByText('Timer hours are locked; your manager approves any change')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Edit in Day view' })).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Request a change' }))
    expect(calls.onRequest).toHaveBeenCalledWith({ milestoneId: 'm1', date: '2026-10-14', hours: 4, label: 'Schema Mapping' })
  })

  test('a pending change request shows Change requested, disabled', async () => {
    const request = { id: 'r1', current_hours: 4, requested_hours: 3, reason: 'Timer ran over lunch', status: 'pending' }
    server.use(calendar({ entries: [entry({ hours: 4, tracked_hours: 4 })], locks: [lock({ request })] }))
    render()
    const card = cardOf(await panel('Wednesday 14 October 2026'), 'Schema Mapping')
    expect(within(card).getByRole('button', { name: 'Change requested' })).toBeDisabled()
    expect(within(card).queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument()
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
    expect(within(late).getByRole('link', { name: 'View milestones' })).toHaveAttribute('href', '/projects/p1?tab=milestones&milestone=m5')

    await user.click(screen.getByRole('button', { name: /^Fri 23 Oct/ }))
    const ahead = await panel('Friday 23 October 2026')
    const due = within(ahead).getByText('Build: frontend · Due Oct 23').closest('li')
    expect(due).not.toHaveTextContent('Overdue')
    expect(within(due).getByRole('link', { name: 'View milestones' })).toHaveAttribute('href', '/projects/p2?tab=milestones&milestone=m6')
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
})
