import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderWithProviders } from '../test/render.jsx'
import { bold } from '../test/bold.js'
import Timeline from './Timeline.jsx'

const range = { start: '2026-07-15', end: '2026-10-20' }

const ms = (overrides) => ({
  start_date: '2026-08-01', end_date: '2026-08-31', status: 'not_started', display_status: 'not_started',
  priority: 'medium', predecessors: [], progress_percent: null, assignees: [], is_assignee: false,
  logged_hours: 0, estimated_hours: null, working_days: null, completed_at: null, ...overrides,
})
const row = (name) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) })
// A bar label whose waiting or kicked-back state is bold spans two elements: match the innermost one holding all of it.
const wholeText = (text) => (_, el) => el.textContent === text && [...el.children].every((c) => c.textContent !== text)

// "Today" is Thursday 15 Oct 2026; only Date is faked, because faking every timer makes userEvent hang.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0))
})
afterEach(() => vi.useRealTimers())

describe('Timeline', () => {
  test('shows a month label for every month start in the range', () => {
    renderWithProviders(<Timeline items={[ms({ id: 'm1', name: 'Build' })]} range={range} />)
    for (const month of ['Aug', 'Sep', 'Oct']) expect(screen.getByText(month, { exact: true })).toBeInTheDocument()
    expect(screen.queryByText('Jul', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('Jul 15, 2026')).toBeInTheDocument()
    expect(screen.getByText('Oct 20, 2026')).toBeInTheDocument()
  })

  test('a range that crosses the year names the new year on January', () => {
    renderWithProviders(<Timeline items={[ms({ id: 'm1', name: 'Build' })]} range={{ start: '2026-11-10', end: '2027-02-20' }} />)
    for (const label of ['Dec', 'Jan 2027', 'Feb']) expect(screen.getByText(label, { exact: true })).toBeInTheDocument()
    expect(screen.queryByText('Nov', { exact: true })).not.toBeInTheDocument()
  })

  test('labels each bar with its dates and state', () => {
    renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Build', start_date: '2026-08-15', end_date: '2026-10-23', status: 'in_progress', display_status: 'in_progress', progress_percent: 60 }),
      ms({ id: 'm2', name: 'Plan', start_date: '2026-07-20', end_date: '2026-08-10', status: 'completed', display_status: 'completed', completed_at: '2026-08-09T10:00:00Z' }),
      ms({ id: 'm3', name: 'Draft', start_date: '2026-09-01', end_date: '2026-10-18', status: 'in_progress', display_status: 'in_progress' }),
      ms({ id: 'm4', name: 'Review', start_date: '2026-09-10', end_date: '2026-10-19', status: 'ready_for_review', display_status: 'ready_for_review' }),
      ms({ id: 'm5', name: 'Launch', start_date: '2026-10-01', end_date: '2026-10-20' }),
      ms({ id: 'm6', name: 'Stuck', start_date: '2026-10-05', end_date: '2026-10-20', status: 'blocked', display_status: 'blocked' }),
    ]} />)
    expect(screen.getByText('Aug 15 – Oct 23 · 60% done')).toBeInTheDocument()
    expect(screen.getByText('Jul 20 – Aug 10 · Done')).toBeInTheDocument()
    expect(screen.getByText('Sep 1 – Oct 18 · In progress')).toBeInTheDocument()
    expect(screen.getByText('Sep 10 – Oct 19 · Ready for review')).toBeInTheDocument()
    expect(screen.getByText('Oct 1 – Oct 20 · Not started')).toBeInTheDocument()
    expect(screen.getByText(wholeText('Oct 5 – Oct 20 · Blocked'))).toBeInTheDocument()
    expect(row('Build')).toHaveAccessibleName('Build, Aug 15, 2026 to Oct 23, 2026, In progress, 60% done, Medium priority')
    expect(row('Plan')).toHaveAccessibleName('Plan, Jul 20, 2026 to Aug 10, 2026, Completed, Medium priority')
  })

  test('marks an unfinished milestone past its end date as overdue', () => {
    renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Build', start_date: '2026-08-01', end_date: '2026-09-30', status: 'in_progress', display_status: 'in_progress',
        progress_percent: 40, priority: 'high' }),
      ms({ id: 'm2', name: 'Plan', start_date: '2026-07-20', end_date: '2026-08-10', status: 'completed', display_status: 'completed' }),
      ms({ id: 'm3', name: 'Ship', start_date: '2026-10-01', end_date: '2026-10-15', status: 'in_progress', display_status: 'in_progress' }),
    ]} />)
    // Exactly one: the finished milestone and the one ending today are not late.
    expect(screen.getAllByText('⚠ Overdue')).toHaveLength(1)
    // The mark sits in its own element, outside the text that ellipsis can cut, and never shrinks.
    const mark = screen.getByText('⚠ Overdue')
    const dates = screen.getByText('Aug 1 – Sep 30 · 40% done')
    expect(dates).not.toContainElement(mark)
    expect(mark.parentElement).toBe(dates.parentElement)
    expect(mark).toHaveStyle({ flexShrink: '0' })
    expect(row('Build')).toHaveAccessibleName('Build, Aug 1, 2026 to Sep 30, 2026, In progress, 40% done, overdue, High priority')
    expect(row('Plan')).not.toHaveAccessibleName(/overdue/)
    expect(row('Ship')).not.toHaveAccessibleName(/overdue/)
  })

  test('tags my milestones with You and adds Your milestone to the legend', () => {
    const { unmount } = renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Build', is_assignee: true }),
      ms({ id: 'm2', name: 'Plan' }),
    ]} />)
    expect(within(row('Build')).getByText('You')).toBeInTheDocument()
    expect(within(row('Plan')).queryByText('You')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Status colours' })).getByText('Your milestone')).toBeInTheDocument()
    unmount()

    renderWithProviders(<Timeline range={range} items={[ms({ id: 'm2', name: 'Plan' })]} />)
    expect(screen.queryByText('Your milestone')).not.toBeInTheDocument()
    expect(screen.queryByText('You', { exact: true })).not.toBeInTheDocument()
  })

  test('waiting milestones name what they wait on', () => {
    renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Discovery', status: 'in_progress', display_status: 'in_progress' }),
      ms({ id: 'm2', name: 'Mapping', status: 'completed', display_status: 'completed' }),
      ms({ id: 'm3', name: 'Cutover', start_date: '2026-09-01', end_date: '2026-10-19', display_status: 'waiting', predecessors: ['m1', 'm2'] }),
    ]} />)
    // Mapping is done, so only Discovery is still holding Cutover up; the caption under the name lists both.
    expect(screen.getByText(wholeText('Sep 1 – Oct 19 · Waiting on Discovery'))).toBeInTheDocument()
    expect(within(row('Cutover')).getByText('after Discovery, Mapping')).toBeInTheDocument()
    expect(row('Cutover')).toHaveAccessibleName(/Waiting on dependencies/)
  })

  test('a milestone waiting on several others says "+1" on its bar, and keeps the full list in its name and tooltip', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Discovery', status: 'in_progress', display_status: 'in_progress' }),
      ms({ id: 'm2', name: 'Mapping', status: 'in_progress', display_status: 'in_progress' }),
      ms({ id: 'm3', name: 'Cutover', start_date: '2026-09-01', end_date: '2026-10-19', display_status: 'waiting', predecessors: ['m1', 'm2'] }),
    ]} />)
    expect(screen.getByText(wholeText('Sep 1 – Oct 19 · Waiting on Discovery +1'))).toBeInTheDocument()
    expect(row('Cutover')).toHaveAccessibleName(/Waiting on dependencies, waiting on Discovery, Mapping/)
    await user.hover(row('Cutover'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Waiting on Discovery, Mapping')
  })

  test('waiting and blocked bars and legend swatches are striped, the others plain', () => {
    const { container } = renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Wait', display_status: 'waiting' }),
      ms({ id: 'm2', name: 'Stuck', status: 'blocked', display_status: 'blocked' }),
      ms({ id: 'm3', name: 'Plain' }),
    ]} />)
    const bars = container.querySelectorAll('.bar')
    expect(bars[0].style.backgroundImage || getComputedStyle(bars[0]).backgroundImage).toContain('repeating-linear-gradient')
    expect(getComputedStyle(bars[1]).backgroundImage).toContain('repeating-linear-gradient')
    expect(getComputedStyle(bars[2]).backgroundImage).not.toContain('repeating-linear-gradient')
  })

  test('your own milestone is "yours" in its row name', () => {
    renderWithProviders(<Timeline range={range} items={[ms({ id: 'm1', name: 'Build', is_assignee: true }), ms({ id: 'm2', name: 'Plan' })]} />)
    expect(row('Build')).toHaveAccessibleName(/, Medium priority, yours$/)
    expect(row('Plan')).not.toHaveAccessibleName(/yours/)
  })

  test('January keeps its label, and so the year, when a long range thins the month labels', () => {
    renderWithProviders(<Timeline range={{ start: '2025-11-10', end: '2027-03-01' }} items={[ms({ id: 'm1', name: 'Build' })]} />)
    expect(screen.getByText('Jan 2026', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Jan 2027', { exact: true })).toBeInTheDocument()
  })

  test('focus shows the tooltip with people and hours against the estimate', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm2', name: 'Schema Mapping', start_date: '2026-09-01', end_date: '2026-10-30', status: 'in_progress', display_status: 'in_progress',
        progress_percent: 35, predecessors: ['m1'], priority: 'high', working_days: 43, logged_hours: 86, estimated_hours: 120,
        assignees: [{ id: 'u1', name: 'Ada Lovelace' }, { id: 'u2', name: 'Eli Employee' }] }),
      ms({ id: 'm1', name: 'Discovery' }),
    ]} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    const mapping = row('Schema Mapping')
    expect(mapping).toHaveFocus()
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Schema Mapping')
    expect(tip).toHaveTextContent('Sep 1, 2026 – Oct 30, 2026 · 43 working days')
    expect(tip).toHaveTextContent('In progress · 35% done')
    expect(tip).toHaveTextContent('Runs after Discovery')
    expect(tip).toHaveTextContent('People: Ada Lovelace, Eli Employee')
    expect(tip).toHaveTextContent('86h logged of 120h estimated')
    // The tooltip describes the row; it must not replace the row's own name.
    expect(mapping).toHaveAccessibleName(/^Schema Mapping, Sep 1, 2026 to Oct 30, 2026, In progress, 35% done/)
  })

  test('the tooltip says when nobody is assigned and no hours are logged', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Timeline range={range} items={[ms({ id: 'm1', name: 'Discovery' })]} />)
    await user.tab()
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Nobody assigned')
    expect(tip).not.toHaveTextContent('logged')
  })

  test('click and Enter call onOpen with the milestone', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const build = ms({ id: 'm1', name: 'Build' })
    const plan = ms({ id: 'm2', name: 'Plan' })
    renderWithProviders(<Timeline range={range} items={[build, plan]} onOpen={onOpen} />)
    expect(row('Build')).toHaveAttribute('tabindex', '0')
    await user.tab()
    expect(row('Build')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenLastCalledWith(build)
    await user.click(row('Plan'))
    expect(onOpen).toHaveBeenLastCalledWith(plan)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  test('Space opens like Enter', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const build = ms({ id: 'm1', name: 'Build' })
    renderWithProviders(<Timeline range={range} items={[build]} onOpen={onOpen} />)
    await user.tab()
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledWith(build)
  })

  test('click and Enter do nothing without onOpen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Timeline range={range} items={[ms({ id: 'm1', name: 'Build' })]} />)
    await user.click(row('Build'))
    await user.keyboard('{Enter}')
    expect(row('Build')).toBeInTheDocument()
  })

  test('a one-day range and a milestone outside the range render without NaN', () => {
    const { container, unmount } = renderWithProviders(<Timeline range={{ start: '2026-10-05', end: '2026-10-05' }} items={[
      ms({ id: 'm1', name: 'Same day', start_date: '2026-10-05', end_date: '2026-10-05', status: 'in_progress', display_status: 'in_progress', progress_percent: 50 }),
      ms({ id: 'm2', name: 'Later', start_date: '2026-12-01', end_date: '2026-12-20' }),
      ms({ id: 'm3', name: 'Earlier', start_date: '2026-01-01', end_date: '2026-02-01' }),
      ms({ id: 'm4', name: 'Straddles', start_date: '2026-09-20', end_date: '2026-10-30' }),
    ]} />)
    expect(container.innerHTML).not.toContain('NaN')
    // Clipped, not dropped.
    expect(within(screen.getByRole('list', { name: 'Milestone timeline' })).getAllByRole('listitem')).toHaveLength(4)
    unmount()

    const alone = renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Only one', start_date: '2026-06-01', end_date: '2026-12-31', status: 'in_progress', display_status: 'in_progress', progress_percent: 0 }),
    ]} />)
    expect(alone.container.innerHTML).not.toContain('NaN')
    expect(screen.getByText('Jun 1 – Dec 31 · 0% done')).toBeInTheDocument()
  })
  test("layout=\"compact\" names each state under the milestone, with no legend and no 'after' line", () => {
    renderWithProviders(<Timeline layout="compact" range={range} items={[
      ms({ id: 'm1', name: 'Plan', start_date: '2026-07-20', end_date: '2026-08-10', status: 'completed', display_status: 'completed' }),
      ms({ id: 'm2', name: 'Build', start_date: '2026-09-01', end_date: '2026-10-19', status: 'in_progress', display_status: 'in_progress',
        progress_percent: 40, predecessors: ['m1'] }),
    ]} />)
    expect(within(row('Plan')).getByText('Completed')).toBeInTheDocument()
    expect(within(row('Build')).getByText('In progress')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Status colours' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^after /)).not.toBeInTheDocument()
    // The month axis and the Today line stay.
    expect(screen.getByText('Aug', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Today', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Sep 1 – Oct 19')).toBeInTheDocument()
  })

  test('layout="detailed" numbers each row, shows its state chip and adds a Dependency column', () => {
    renderWithProviders(<Timeline layout="detailed" range={range} items={[
      ms({ id: 'm1', name: 'Plan', start_date: '2026-07-20', end_date: '2026-08-10', status: 'completed', display_status: 'completed' }),
      ms({ id: 'm2', name: 'Build', start_date: '2026-09-01', end_date: '2026-10-19', status: 'in_progress', display_status: 'in_progress',
        predecessors: ['m1'] }),
    ]} />)
    expect(screen.getByText('Milestone')).toBeInTheDocument()
    expect(screen.getByText('Dependency')).toBeInTheDocument()
    expect(within(row('Plan')).getByText('1')).toBeInTheDocument()
    expect(within(row('Plan')).getByText('Completed')).toBeInTheDocument()
    expect(within(row('Plan')).getByText('None')).toBeInTheDocument()
    expect(within(row('Build')).getByText('2')).toBeInTheDocument()
    expect(within(row('Build')).getByText('In progress')).toBeInTheDocument()
    expect(within(row('Build')).getByText('After Plan')).toBeInTheDocument()
    expect(screen.queryByText(/^after /)).not.toBeInTheDocument()   // the Dependency column replaces the "after" line
    expect(screen.getByText('Sep 1 – Oct 19')).toBeInTheDocument()   // the chip carries the state, so the bar shows dates only
    expect(screen.getByRole('list', { name: 'Status colours' })).toBeInTheDocument()
  })

  test('layout="detailed": the chip of a waiting row says just "Waiting" (bold), so names stay on one line; its name keeps the full words', () => {
    renderWithProviders(<Timeline layout="detailed" range={range} items={[
      ms({ id: 'm1', name: 'Plan', status: 'in_progress', display_status: 'in_progress' }),
      ms({ id: 'm2', name: 'Hypercare', display_status: 'waiting', predecessors: ['m1'] }),
    ]} />)
    expect(within(row('Hypercare')).getByText('Waiting')).toBeInTheDocument()
    expect(within(row('Hypercare')).queryByText('Waiting on dependencies')).not.toBeInTheDocument()
    expect(bold(row('Hypercare'), { hidden: true })).toContain('Waiting')   // (its default dates are past, so it is overdue too)
    expect(row('Hypercare')).toHaveAccessibleName(/Waiting on dependencies/)
  })

  test('bare: drawn straight in its card, with no frame or padding of its own', () => {
    const { unmount } = renderWithProviders(<Timeline range={range} items={[ms({ id: 'm1', name: 'Plan' })]} />)
    expect(screen.getByRole('list', { name: 'Milestone timeline' }).closest('.MuiPaper-outlined')).not.toBeNull()
    unmount()
    renderWithProviders(<Timeline bare range={range} items={[ms({ id: 'm1', name: 'Plan' })]} />)
    expect(screen.getByRole('list', { name: 'Milestone timeline' }).closest('.MuiPaper-outlined')).toBeNull()
  })

  test('`all` keeps numbers and dependency names when only some rows are shown', () => {
    const plan = ms({ id: 'm1', name: 'Plan', status: 'completed', display_status: 'completed' })
    const build = ms({ id: 'm2', name: 'Build', predecessors: ['m1'] })
    renderWithProviders(<Timeline layout="detailed" range={range} items={[build]} all={[plan, build]} />)
    expect(screen.queryByRole('listitem', { name: /^Plan,/ })).not.toBeInTheDocument()
    expect(within(row('Build')).getByText('2')).toBeInTheDocument()
    expect(within(row('Build')).getByText('After Plan')).toBeInTheDocument()
  })

  test('the default layout keeps the legend and the after line', () => {
    renderWithProviders(<Timeline range={range} items={[
      ms({ id: 'm1', name: 'Plan', status: 'completed', display_status: 'completed' }),
      ms({ id: 'm2', name: 'Build', predecessors: ['m1'] }),
    ]} />)
    expect(screen.getByRole('list', { name: 'Status colours' })).toBeInTheDocument()
    expect(screen.getByText('after Plan')).toBeInTheDocument()
  })
})

describe('Timeline: the critical details are bold', () => {
  // A row's drawing is aria-hidden (its words are in the row's name), so the bold query includes hidden elements.
  const boldInRow = (name) => bold(row(name), { hidden: true })
  const items = [
    ms({ id: 'm1', name: 'Build', start_date: '2026-08-01', end_date: '2026-09-30', status: 'in_progress', display_status: 'in_progress' }),
    ms({ id: 'm2', name: 'Stuck', start_date: '2026-10-05', end_date: '2026-10-20', status: 'blocked', display_status: 'blocked' }),
    ms({ id: 'm3', name: 'Wait', start_date: '2026-10-01', end_date: '2026-10-20', display_status: 'waiting', predecessors: ['m1'] }),
    ms({ id: 'm4', name: 'Plan', start_date: '2026-07-20', end_date: '2026-08-10', status: 'completed', display_status: 'completed' }),
  ]

  test('the overdue mark, a kicked-back state and "Waiting on …" are bold; the dates and other states are not', () => {
    renderWithProviders(<Timeline range={range} items={items} />)
    expect(boldInRow('Build')).toEqual(['⚠ Overdue'])
    expect(boldInRow('Stuck')).toEqual(['Blocked'])
    expect(boldInRow('Wait')).toEqual(['Waiting on Build'])
    expect(boldInRow('Plan')).toEqual([])
  })

  test('compact: the state word under the name is bold for waiting and kicked back', () => {
    renderWithProviders(<Timeline layout="compact" range={range} items={items} />)
    expect(boldInRow('Stuck')).toEqual(['Blocked – needs review'])
    expect(boldInRow('Wait')).toEqual(['Waiting on dependencies'])
    expect(boldInRow('Plan')).toEqual([])
  })
})
