import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import { projectView } from '../projects/viewer.js'
import MilestonesTab from './MilestonesTab.jsx'

// The milestone panel's Approvals tab (spec §4.4): pending entries by person and week, one approve per person-week,
// request changes with one reason, and the budget impact. It took over the Details tab's pending-hours block.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const project = {
  id: 'p1', name: 'Apollo', start_date: '2026-07-15', predicted_end_date: '2026-12-27', status: 'active',
  manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [],
}
const gia = { id: 'u-gia', name: 'Gia Rossi' }
const build = {
  id: 'm2', name: 'Build: frontend', project_id: 'p1', description: '', status: 'completed', display_status: 'completed',
  blocked: false, predecessors: [], assignees: [gia], supporting_ids: [], is_assignee: false, completed_at: null,
  is_archived: false, difficulty: 'medium', priority: 'medium', objective: '', completion_criteria: '', required_skills: [],
  progress_percent: null, open_kickback: null, can_post_update: false, can_kick_back: false, can_resolve_kickback: false,
  can_claim: false, start_date: '2026-08-15', end_date: '2026-10-23', logged_hours: 118, estimated_hours: 264,
}

const OVER = { code: 'OVER_PLAN', severity: 'warn', message: 'Logged 34h this week against 30h planned' }
const SAME = { code: 'SAME_HOURS_DAILY', severity: 'warn', message: 'Same 8.5h on 4 weekdays this week on Build: frontend' }
const LATE = { code: 'BACKDATED', severity: 'info', message: 'Logged 10 days after the day worked' }

const item = (id, workDate, hours, entry = {}, extra = {}) => ({
  entry: { id, user_id: gia.id, milestone_id: 'm2', project_id: 'p1', work_date: workDate, hours, status: 'pending',
    over_40: false, edited_after_decision: false, changed_after_hr_submission: false, rejection_reason: null,
    note: 'Fixed layout issues from the design review', source: 'manual', tracked_hours: 0, ...entry },
  label: 'Pending approval', user: gia, milestone: { id: 'm2', name: 'Build: frontend' }, project: { id: 'p1', name: 'Apollo' },
  week_logged_total: 34, delegated_from: null, flags: [OVER, SAME], ...extra,
})
// The mockup's seven entries, 58h. The server lists the newer week first here: the tab still shows the oldest week first.
const queue = () => [
  item('e5', '2026-10-12', 8, { source: 'mixed', tracked_hours: 6 }, { flags: [OVER] }),
  item('e6', '2026-10-13', 8, { source: 'tracked', tracked_hours: 8 }, { flags: [OVER] }),
  item('e7', '2026-10-14', 8, { source: 'tracked', tracked_hours: 8 }, { flags: [OVER, LATE] }),
  item('e1', '2026-10-06', 8.5),
  item('e2', '2026-10-07', 8.5),
  item('e3', '2026-10-08', 8.5),
  item('e4', '2026-10-09', 8.5, { note: '' },
    { progress_update: { body: 'Built the account settings screens', created_at: '2026-10-09T20:00:00Z' } }),
]

const breakdown = (id, hours) => ({
  entry_id: id, hours, hourly_rate: null, request_cost: hours * 50, milestone_cost: 1000, milestone_cost_after: 1000 + hours * 50,
  budget: 250000, consumed: 21745, remaining: 228255, remaining_before: 228255, remaining_after: 228255 - hours * 50,
  pct_of_remaining: 0.2, forecast: 61000, forecast_over_budget: false, weeks_remaining: 10,
})

let listed
let seen
/**
 * `approve(body, n)` may answer the n-th approve-week itself, and `reject(id, n)` the n-th reject; otherwise the entries
 * are decided and leave the list.
 */
function api({ list = queue(), approve, reject } = {}) {
  listed = list
  seen = { approved: [], rejected: [], approvals: [] }
  server.use(
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([build])),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([])),
    http.get(`${API}/skills`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/approvals`, ({ request }) => {
      seen.approvals.push(new URL(request.url).search)
      return HttpResponse.json(listed)
    }),
    http.post(`${API}/approvals/approve-week`, async ({ request }) => {
      const body = await request.json()
      seen.approved.push(body)
      const answer = await approve?.(body, seen.approved.length)
      if (answer) return answer
      const ids = new Set(body.entries.map((e) => e.id))
      listed = listed.filter((i) => !ids.has(i.entry.id))
      return HttpResponse.json({ approved: body.entries.length, user_id: gia.id, week_start: '2026-10-05' })
    }),
    http.post(`${API}/time-entries/:id/reject`, async ({ request, params }) => {
      seen.rejected.push({ id: params.id, body: await request.json() })
      const answer = await reject?.(params.id, seen.rejected.length)
      if (answer) return answer
      listed = listed.filter((i) => i.entry.id !== params.id)
      return HttpResponse.json({ id: params.id, status: 'rejected' })
    }),
    http.get(`${API}/time-entries/:id/breakdown`, ({ params }) => {
      const found = listed.find((i) => i.entry.id === params.id)
      return HttpResponse.json(breakdown(params.id, found?.entry.hours ?? 1))
    }),
  )
}

function renderPanel(user = users.manager, route = '?milestone=m2&panel=approvals') {
  const view = projectView(user, project)
  return renderAsUser(<MilestonesTab project={project} manage={view.manage} user={user} view={view} />, { user, route: `/m${route}` })
}
const panel = () => screen.findByRole('complementary', { name: 'Build: frontend' })
const OCT5 = 'Gia Rossi · Week of Oct 5, 2026 · 4 entries · 34h'
const OCT12 = 'Gia Rossi · Week of Oct 12, 2026 · 3 entries · 24h'
const box = (name) => screen.getByRole('checkbox', { name: `Select Gia Rossi, ${name}` })
const selectAll = (title) => screen.getByRole('checkbox', { name: `Select all: ${title}` })
const footerButton = (name) => screen.getByRole('button', { name })
const STALE = 'These hours changed since you loaded them. Refresh and check again.'
const staleAnswer = () => HttpResponse.json({ error: { code: 'STALE_ENTRY', message: STALE } }, { status: 409 })
const ada = { id: 'u-ada', name: 'Ada Lovelace' }

describe('Approvals tab: heading, tab count and groups', () => {
  test('the tab shows its count; the heading counts entries and hours and warns that completion approves nothing', async () => {
    api()
    renderPanel()
    const c = await panel()
    expect(await within(c).findByText('7 entries · 58h awaiting approval')).toBeInTheDocument()
    expect(within(c).getByRole('tab', { name: 'Approvals (7)' })).toHaveAttribute('aria-selected', 'true')
    expect(within(c).getByText('Milestone completion does not approve time entries.')).toBeInTheDocument()
    expect(seen.approvals).toContain('?milestone=m2')
  })

  test('nothing pending reads "Nothing waiting", and the tab has no count', async () => {
    api({ list: [] })
    renderPanel()
    const c = await panel()
    expect(await within(c).findByText('Nothing waiting')).toBeInTheDocument()
    expect(within(c).getByRole('tab', { name: 'Approvals' })).toBeInTheDocument()
    expect(within(c).queryByText(/awaiting approval/)).not.toBeInTheDocument()
  })

  test('one group per person and week, oldest week first, each with its source share', async () => {
    api()
    renderPanel()
    const c = await panel()
    await within(c).findByText('7 entries · 58h awaiting approval')
    const groups = within(c).getAllByRole('region', { name: /^Gia Rossi · Week of/ })
    const older = within(c).getByRole('region', { name: OCT5 })
    expect(groups).toEqual([older, within(c).getByRole('region', { name: OCT12 })])
    expect(within(older).getByRole('heading', { name: OCT5 })).toBeInTheDocument()
    // Collapsed, only the group's share chip is left: Manual for the hand-typed week, Mixed for 22h of 24h tracked.
    await userEvent.click(within(older).getByRole('button', { name: OCT5 }))
    await userEvent.hover(within(older).getByText('Manual'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Tracked 0% · Manual 100%')
    const newer = within(c).getByRole('region', { name: OCT12 })
    await userEvent.click(within(newer).getByRole('button', { name: OCT12 }))
    await userEvent.hover(within(newer).getByText('Mixed'))
    expect(await screen.findByText('Tracked 92% · Manual 8%')).toBeInTheDocument()
  })

  test("the week's share chip is reachable from the keyboard", async () => {
    api()
    renderPanel()
    const c = await panel()
    const toggle = await within(c).findByRole('button', { name: OCT12 })
    toggle.focus()   // the group's toggle; its share chip is the next tab stop
    await userEvent.tab()
    expect(document.activeElement).toHaveTextContent('Mixed')
    // jsdom has no :focus-visible, so the tooltip itself stays shut here; the share is the chip's description either way.
    expect(document.activeElement).toHaveAccessibleDescription('Tracked 92% · Manual 8%')
  })

  test('a group collapses and expands', async () => {
    api()
    renderPanel()
    const c = await panel()
    const toggle = await within(c).findByRole('button', { name: OCT5 })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(box('Oct 6, 2026, 8.5h')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' })).not.toBeInTheDocument()
    expect(box('Oct 12, 2026, 8h')).toBeInTheDocument()   // the other group stays open
    await userEvent.click(toggle)
    expect(box('Oct 6, 2026, 8.5h')).toBeInTheDocument()
  })

  test("a group's select-all selects only its own entries", async () => {
    api()
    renderPanel()
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: `Select all: ${OCT12}` }))
    expect(box('Oct 12, 2026, 8h')).toBeChecked()
    expect(box('Oct 13, 2026, 8h')).toBeChecked()
    expect(box('Oct 14, 2026, 8h')).toBeChecked()
    expect(box('Oct 6, 2026, 8.5h')).not.toBeChecked()
    expect(selectAll(OCT5)).not.toBeChecked()
    expect(screen.getByText('3 selected · 24h')).toBeInTheDocument()
    await userEvent.click(selectAll(OCT12))
    expect(box('Oct 12, 2026, 8h')).not.toBeChecked()
    expect(screen.getByText('Select entries to review')).toBeInTheDocument()
  })

  test('a delegated group says whose manager it is from', async () => {
    api({ list: [item('e1', '2026-10-06', 8.5, {}, { delegated_from: { id: 'u-mgr', name: 'Morgan Manager' } })] })
    renderPanel(users.admin)
    const c = await panel()
    const group = await within(c).findByRole('region', { name: 'Gia Rossi · Week of Oct 5, 2026 · 1 entry · 8.5h' })
    expect(within(group).getByText('Delegated from Morgan Manager')).toBeInTheDocument()
  })
})

describe('Approvals tab: rows', () => {
  test('date, hours, source, the note or the day\'s update, and the flags with the server\'s message', async () => {
    api()
    renderPanel()
    const c = await panel()
    const table = await within(c).findByRole('table', { name: `Entries of ${OCT5}` })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['', 'Date and Hours', 'Source', 'Work note', 'Flags'])
    const row = within(table).getByRole('row', { name: /Oct 6, 2026/ })
    const when = within(row).getAllByRole('cell')[1]   // one column: the date with the hours under it
    expect(within(when).getByText('Oct 6, 2026')).toBeInTheDocument()
    expect(within(when).getByText('8.5h')).toBeInTheDocument()
    expect(within(row).getByText('Manual')).toBeInTheDocument()
    expect(within(row).getByText('Fixed layout issues from the design review')).toBeInTheDocument()
    expect(within(row).getByText('⚠ Repeated hours')).toBeInTheDocument()
    expect(within(row).getByText('⚠ Over plan')).toBeInTheDocument()
    const update = within(table).getByRole('row', { name: /Oct 9, 2026/ })
    expect(within(update).getByText('Update: Built the account settings screens')).toBeInTheDocument()
    await userEvent.hover(within(row).getByText('⚠ Repeated hours'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(SAME.message)
  })

  test("overtime, edited and changed-after-HR entries carry the same cues as the Timesheets queue", async () => {
    const OVERTIME = 'Pending (Overtime requested from Gia Rossi)'
    api({ list: [
      item('e1', '2026-10-06', 8.5, { over_40: true }, { label: OVERTIME, week_logged_total: 44 }),
      item('e2', '2026-10-07', 8.5, { edited_after_decision: true }, { week_logged_total: 44 }),
      item('e3', '2026-10-08', 8.5, { changed_after_hr_submission: true }, { week_logged_total: 44, flags: [] }),
    ] })
    renderPanel()
    await panel()
    const title = 'Gia Rossi · Week of Oct 5, 2026 · 3 entries · 25.5h'
    const group = await screen.findByRole('region', { name: title })
    expect(within(group).getByText('44h this week')).toBeInTheDocument()   // the person's whole week, in the header
    const table = within(group).getByRole('table', { name: `Entries of ${title}` })
    const over = within(table).getByRole('row', { name: /Oct 6, 2026/ })
    const chip = within(over).getByText('Overtime')
    expect(chip.closest('[data-tone]')).toHaveAttribute('data-tone', 'warning')
    await userEvent.hover(chip)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(OVERTIME)
    expect(within(over).queryByText('Edited')).not.toBeInTheDocument()
    expect(within(within(table).getByRole('row', { name: /Oct 7, 2026/ })).getByText('Edited')).toBeInTheDocument()
    const hr = within(table).getByRole('row', { name: /Oct 8, 2026/ })
    expect(within(hr).getByText('Changed after HR submission — re-send')).toBeInTheDocument()
    expect(within(hr).queryByText('Overtime')).not.toBeInTheDocument()
  })

  test('on a phone the cards carry the same cues', async () => {
    setViewport(375)
    api({ list: [item('e1', '2026-10-06', 8.5, { over_40: true, edited_after_decision: true },
      { label: 'Pending (Overtime requested from Gia Rossi)' })] })
    renderPanel()
    const sheet = await screen.findByRole('dialog', { name: 'Build: frontend' })
    const cards = await within(sheet).findByRole('list', { name: /^Entries of Gia Rossi/ })
    const card = within(cards).getByRole('listitem')
    expect(within(card).getByText('Overtime')).toBeInTheDocument()
    expect(within(card).getByText('Edited')).toBeInTheDocument()
    expect(within(sheet).getByText('34h this week')).toBeInTheDocument()
  })

  test('warn flags show in the warning colour, info flags neutral', async () => {
    api()
    renderPanel()
    await panel()
    const table = await screen.findByRole('table', { name: `Entries of ${OCT12}` })
    const row = within(table).getByRole('row', { name: /Oct 14, 2026/ })
    expect(within(row).getByLabelText(`Red flag: ${OVER.message}`)).toHaveAttribute('data-tone', 'warning')
    expect(within(row).getByLabelText(`Red flag: ${LATE.message}`)).toHaveAttribute('data-tone', 'neutral')
  })

  test('on a phone the entries are cards, and the select-all sits in the group header', async () => {
    setViewport(375)
    api()
    renderPanel()
    const sheet = await screen.findByRole('dialog', { name: 'Build: frontend' })
    const cards = await within(sheet).findByRole('list', { name: `Entries of ${OCT5}` })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(4)
    expect(within(sheet).queryByRole('table')).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: `Select all: ${OCT5}` }))
    expect(within(sheet).getByText('4 selected · 34h')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Approve 34h' })).toBeEnabled()
  })

  test("on a phone the footer is the last thing in the sheet and sticks flush to the bottom of its scroller", async () => {
    setViewport(375)
    api()
    renderPanel()
    const sheet = await screen.findByRole('dialog', { name: 'Build: frontend' })
    const footer = await within(sheet).findByRole('group', { name: 'Review selected entries' })
    expect(getComputedStyle(footer).position).toBe('sticky')
    expect(getComputedStyle(footer).bottom).toBe('-16px')   // the sheet's scroller has 16 px of padding
    const after = [...sheet.querySelectorAll('*')]
      .filter((el) => !footer.contains(el) && footer.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(after).toEqual([])
  })
})

describe('Approvals tab: footer and approving', () => {
  test('nothing selected: "Select entries to review" and the three buttons disabled; two selected: their count and hours', async () => {
    api()
    renderPanel()
    await panel()
    expect(await screen.findByText('Select entries to review')).toBeInTheDocument()
    expect(footerButton('View budget impact')).toBeDisabled()
    expect(footerButton('Request changes')).toBeDisabled()
    expect(footerButton('Approve')).toBeDisabled()
    const footer = screen.getByRole('group', { name: 'Review selected entries' })
    expect(getComputedStyle(footer).position).toBe('sticky')
    expect(getComputedStyle(footer).bottom).toBe('0px')
    await userEvent.click(box('Oct 6, 2026, 8.5h'))
    await userEvent.click(box('Oct 7, 2026, 8.5h'))
    expect(screen.getByText('2 selected · 17h')).toBeInTheDocument()
    expect(footerButton('View budget impact')).toBeEnabled()
    expect(footerButton('Request changes')).toBeEnabled()
    expect(footerButton('Approve 17h')).toBeEnabled()
  })

  test('Approve sends one approve-week per person-week, one after another, each with only its selected entries; one toast', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    api({ approve: async (_body, n) => { if (n === 1) await gate } })
    renderPanel()
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(box('Oct 7, 2026, 8.5h'))
    await userEvent.click(selectAll(OCT12))
    expect(screen.getByText('5 selected · 41h')).toBeInTheDocument()
    await userEvent.click(footerButton('Approve 41h'))
    // The second week waits for the first one's answer.
    await waitFor(() => expect(seen.approved).toHaveLength(1))
    await new Promise((resolve) => { setTimeout(resolve, 150) })
    expect(seen.approved).toHaveLength(1)
    expect(screen.queryByText(/^Approved/)).not.toBeInTheDocument()
    release()
    expect(await screen.findByText('Approved 41h for Gia Rossi')).toBeInTheDocument()
    expect(seen.approved).toEqual([
      { entries: [{ id: 'e1', expected_hours: 8.5 }, { id: 'e2', expected_hours: 8.5 }] },
      { entries: [{ id: 'e5', expected_hours: 8 }, { id: 'e6', expected_hours: 8 }, { id: 'e7', expected_hours: 8 }] },
    ])
    expect(screen.queryByText('Approved 17h for Gia Rossi')).not.toBeInTheDocument()
    expect(await screen.findByText('2 entries · 17h awaiting approval')).toBeInTheDocument()
    expect(screen.getByText('Select entries to review')).toBeInTheDocument()
  })

  test("approving two people's weeks names both in the one toast", async () => {
    api({ list: [item('e1', '2026-10-06', 8.5), { ...item('a1', '2026-10-07', 3.5), user: ada }] })
    renderPanel()
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace, Oct 7, 2026, 3.5h' }))
    await userEvent.click(footerButton('Approve 12h'))
    expect(await screen.findByText('Approved 12h for Gia Rossi and Ada Lovelace')).toBeInTheDocument()
    expect(seen.approved).toHaveLength(2)
  })

  test('nothing approved: the error, and no success toast', async () => {
    api({ approve: () => staleAnswer() })
    renderPanel()
    const c = await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(footerButton('Approve 8.5h'))
    expect(await within(c).findByRole('alert')).toHaveTextContent(STALE)
    expect(screen.queryByText(/^Approved/)).not.toBeInTheDocument()
  })

  test("a stale week shows the server's message, the other week's approval stands, and the list refreshes", async () => {
    api({
      approve: (_body, n) => {
        if (n !== 2) return undefined
        // Gia edited Oct 12 from 8h to 7h after the manager loaded the list.
        listed = listed.map((i) => (i.entry.id === 'e5' ? { ...i, entry: { ...i.entry, hours: 7 } } : i))
        return staleAnswer()
      },
    })
    renderPanel()
    const c = await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(box('Oct 7, 2026, 8.5h'))
    await userEvent.click(selectAll(OCT12))
    await userEvent.click(footerButton('Approve 41h'))
    expect(await within(c).findByRole('alert')).toHaveTextContent(STALE)
    expect(await screen.findByText('Approved 17h for Gia Rossi')).toBeInTheDocument()
    expect(seen.approved).toHaveLength(2)
    // The refetch: Oct 6 and 7 are gone, Oct 12 shows its new hours.
    expect(await within(c).findByText('5 entries · 40h awaiting approval')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' })).not.toBeInTheDocument()
    // The changed entry leaves the selection: the manager ticks it again after checking the new hours.
    expect(box('Oct 12, 2026, 7h')).not.toBeChecked()
    expect(box('Oct 13, 2026, 8h')).toBeChecked()
    // Review Focus 5: the selection counts only what is still listed, at the hours shown.
    expect(screen.getByText('2 selected · 16h')).toBeInTheDocument()
    expect(footerButton('Approve 16h')).toBeEnabled()
  })

  test('the demo admin may approve and request changes: nothing here is demo-disabled', async () => {
    // backend app/public_demo.py lists POST /approvals/approve-week and POST /time-entries/{id}/reject as allowed.
    api()
    renderPanel(users.demoAdmin)
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    expect(footerButton('Request changes')).toBeEnabled()
    expect(footerButton('Approve 8.5h')).toBeEnabled()
    await userEvent.click(footerButton('Approve 8.5h'))
    expect(await screen.findByText('Approved 8.5h for Gia Rossi')).toBeInTheDocument()
    expect(seen.approved).toEqual([{ entries: [{ id: 'e1', expected_hours: 8.5 }] }])
    expect(screen.queryByText(/disabled in the public demo/i)).not.toBeInTheDocument()
  })
})

describe('Approvals tab: request changes', () => {
  test('one reason for every selected entry; an empty reason sends nothing; one toast', async () => {
    api()
    renderPanel()
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(box('Oct 7, 2026, 8.5h'))
    await userEvent.click(footerButton('Request changes'))
    const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    expect(within(dialog).getByText('Tell the employee why')).toBeInTheDocument()
    expect(seen.rejected).toEqual([])
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Missing notes')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    await waitFor(() => expect(seen.rejected).toEqual([
      { id: 'e1', body: { reason: 'Missing notes', expected_hours: 8.5 } },
      { id: 'e2', body: { reason: 'Missing notes', expected_hours: 8.5 } },
    ]))
    expect(await screen.findByText('Requested changes on 2 entries')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request changes' })).not.toBeInTheDocument())
    expect(screen.queryByText('Hours rejected')).not.toBeInTheDocument()
  })

  test('one reject fails: one toast for the one that went through, and the error in the panel', async () => {
    api({ reject: (_id, n) => (n === 2 ? staleAnswer() : undefined) })
    renderPanel()
    const c = await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(box('Oct 7, 2026, 8.5h'))
    await userEvent.click(footerButton('Request changes'))
    const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Missing notes')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    expect(await screen.findByText('Requested changes on 1 entry')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request changes' })).not.toBeInTheDocument())
    expect(await within(c).findByRole('alert')).toHaveTextContent(STALE)
    expect(seen.rejected.map((r) => r.id)).toEqual(['e1', 'e2'])
  })

  test('nothing rejected: the dialog stays open with the reason and the error', async () => {
    const DOWN = 'The server had a problem. Try again.'
    api({ reject: () => HttpResponse.json({ error: { code: 'INTERNAL', message: DOWN } }, { status: 500 }) })
    renderPanel()
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(footerButton('Request changes'))
    const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Missing notes')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(DOWN)
    expect(screen.getByRole('dialog', { name: 'Request changes' })).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Reason' })).toHaveValue('Missing notes')
    expect(within(dialog).getByRole('button', { name: 'Request changes' })).toBeEnabled()
    expect(screen.queryByText(/^Requested changes/)).not.toBeInTheDocument()
  })

  test('Cancel closes the dialog and sends nothing', async () => {
    api()
    renderPanel()
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(footerButton('Request changes'))
    const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request changes' })).not.toBeInTheDocument())
    expect(seen.rejected).toEqual([])
  })
})

describe('Approvals tab: budget impact', () => {
  test('one entry shows its breakdown; two show each cost and the total', async () => {
    api()
    renderPanel()
    await panel()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Gia Rossi, Oct 6, 2026, 8.5h' }))
    await userEvent.click(footerButton('View budget impact'))
    let dialog = await screen.findByRole('dialog', { name: 'Budget impact' })
    const one = await within(dialog).findByRole('table', { name: 'Budget impact of approving' })
    expect(within(one).getByText('$425.00')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Budget impact' })).not.toBeInTheDocument())

    await userEvent.click(box('Oct 12, 2026, 8h'))
    await userEvent.click(footerButton('View budget impact'))
    dialog = await screen.findByRole('dialog', { name: 'Budget impact' })
    const several = within(dialog).getByRole('table', { name: 'Budget impact of the selected entries' })
    expect(within(several).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Entry', 'Hours', 'Cost'])
    const total = within(several).getByRole('row', { name: /Total/ })
    expect(await within(total).findByText('$825.00')).toBeInTheDocument()   // only once every cost is in
    expect(total).toHaveTextContent('16.5h')
    expect(within(within(several).getByRole('row', { name: /Oct 6, 2026/ })).getByText('$425.00')).toBeInTheDocument()
    expect(within(within(several).getByRole('row', { name: /Oct 12, 2026/ })).getByText('$400.00')).toBeInTheDocument()
  })

  test('above 20 selected the button is disabled and says why', async () => {
    const days = Array.from({ length: 21 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10)
      return item(`d${i}`, day, 1, { note: `Day ${i}` }, { flags: [] })
    })
    api({ list: days })
    renderPanel()
    const c = await panel()
    await within(c).findByText('21 entries · 21h awaiting approval')
    for (const title of ['Gia Rossi · Week of Sep 28, 2026 · 7 entries · 7h', 'Gia Rossi · Week of Oct 5, 2026 · 7 entries · 7h',
      'Gia Rossi · Week of Oct 12, 2026 · 7 entries · 7h']) await userEvent.click(selectAll(title))
    expect(screen.getByText('21 selected · 21h')).toBeInTheDocument()
    expect(footerButton('View budget impact')).toBeDisabled()
    await userEvent.hover(screen.getByLabelText('Select 20 entries or fewer to see the budget impact'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Select 20 entries or fewer to see the budget impact')
    expect(footerButton('Approve 21h')).toBeEnabled()
  })
})
