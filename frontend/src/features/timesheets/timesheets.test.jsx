import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { ApprovalsRedirect } from '../../app/App.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { hasPhoneTarget } from '../../test/cssRules.js'
import { setViewport } from '../../test/setup.js'
import { bold } from '../../test/bold.js'
import TimesheetsPage from './TimesheetsPage.jsx'

const downloads = vi.hoisted(() => [])
vi.mock('../../lib/csv.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadCsv: (filename, csv) => downloads.push({ filename, csv }),
}))

const eli = { id: users.employee.id, name: 'Eli Employee' }
const ana = { id: 'u-ana', name: 'Ana Ruiz' }
const item = (id, person, workDate, hours, extra = {}) => ({
  entry: { id, user_id: person.id, milestone_id: 'm1', project_id: 'p1', work_date: workDate, hours, status: 'pending',
    over_40: false, edited_after_decision: false, rejection_reason: null, note: '', label: 'Pending approval',
    changed_after_hr_submission: false, ...extra },
  label: 'Pending approval', user: person, milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' },
  week_logged_total: 24, delegated_from: null,
})
const queue = [
  item('e1', eli, '2026-10-12', 8), item('e2', eli, '2026-10-13', 8), item('e3', eli, '2026-10-05', 6),
  item('e4', ana, '2026-10-12', 4, { changed_after_hr_submission: true, edited_after_decision: true }),
]
const weeks = [
  { user: { ...eli, username: 'employee.demo' }, week_start: '2026-10-05', entry_count: 5, hours: 40, projects: ['Apollo'],
    hr_submitted: true, hr_submitted_count: 5, hr_submitted_at: '2026-10-13T10:00:00Z', hr_changed_count: 0 },
  { user: { ...ana, username: 'ana.ruiz' }, week_start: '2026-10-05', entry_count: 5, hours: 20, projects: ['Apollo'],
    hr_submitted: false, hr_submitted_count: 4, hr_submitted_at: '2026-10-13T10:00:00Z', hr_changed_count: 1 },
]
const submissions = [
  { id: 's2', period_start: '2026-10-05', period_end: '2026-10-11', submitted_at: '2026-10-13T10:00:00Z',
    submitted_by: { id: 'u-admin', name: 'Avery Admin' }, entry_count: 26, correction_count: 1, people: 6, total_hours: 180,
    total_cost: 9500, resubmission_of: { id: 's1', period_start: '2026-09-28', period_end: '2026-10-04' } },
  { id: 's1', period_start: '2026-09-28', period_end: '2026-10-04', submitted_at: '2026-10-06T10:00:00Z',
    submitted_by: { id: 'u-admin', name: 'Avery Admin' }, entry_count: 25, correction_count: 0, people: 6, total_hours: 178,
    total_cost: 9400, resubmission_of: null },
]
const changes = [{ entry_id: 'e4', user: { ...ana, username: 'ana.ruiz' }, work_date: '2026-10-01', hours: 6,
  previous_hours: 4, status: 'approved', ready: true, changed_at: '2026-10-14T09:00:00Z',
  previous_submission: { id: 's1', period_start: '2026-09-28', period_end: '2026-10-04' },
  project: { id: 'p1', name: 'Apollo' }, milestone: { id: 'm1', name: 'Schema Mapping' } }]
const preview = { period_start: '2026-10-05', period_end: '2026-10-11', entry_count: 12, total_hours: 90, total_cost: 4500,
  people: 4, pending_count: 2, corrections_ready: 1, corrections_waiting: 0 }

function api({ approvals = queue } = {}) {
  const seen = { approved: [], submitted: [], weeksAsked: [] }
  server.use(
    http.get(`${API}/approvals`, () => HttpResponse.json(approvals)),
    http.post(`${API}/approvals/approve-week`, async ({ request }) => {
      const body = await request.json()
      seen.approved.push(body)
      return HttpResponse.json({ approved: body.entries.length, user_id: eli.id, week_start: '2026-10-12' })
    }),
    http.get(`${API}/timesheets/approved`, ({ request }) => {
      seen.weeksAsked.push(Object.fromEntries(new URL(request.url).searchParams))
      return HttpResponse.json(weeks)
    }),
    http.get(`${API}/hr-submissions`, () => HttpResponse.json(submissions)),
    http.get(`${API}/hr-submissions/preview`, () => HttpResponse.json(preview)),
    http.get(`${API}/hr-submissions/changes`, () => HttpResponse.json(changes)),
    http.post(`${API}/hr-submissions`, async ({ request }) => {
      seen.submitted.push(await request.json())
      return HttpResponse.json(submissions[0], { status: 201 })
    }),
    http.get(`${API}/hr-submissions/s2/entries`, () => HttpResponse.json({ submission: submissions[0], entries: [
      { id: 'e9', user: { ...eli, username: 'employee.demo' }, work_date: '2026-10-06', hours: 8, hourly_rate: 50, cost: 400,
        is_correction: false, previous_hours: null, corrects: null },
      { id: 'e4', user: { ...ana, username: 'ana.ruiz' }, work_date: '2026-10-01', hours: 6, hourly_rate: 47.12, cost: 282.72,
        is_correction: true, previous_hours: 4, corrects: submissions[1] }] })),
  )
  return seen
}

const open = (user, route = '/timesheets') => renderAsUser(<TimesheetsPage />, { user, route, path: '/timesheets' })
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent)

describe('Timesheets: To review', () => {
  test('phones: the tabs swipe with no scroll arrows and Approve week is a 44 px target', async () => {
    api()
    setViewport(375)
    open(users.manager)
    const week = await screen.findByRole('region', { name: /eli employee, week of oct 12, 2026/i })
    expect(hasPhoneTarget(within(week).getByRole('button', { name: 'Approve week' }))).toBe(true)
    expect(screen.getByRole('tablist').closest('.MuiTabs-root').querySelector('.MuiTabs-scrollButtons')).toBeNull()
  })

  test('pending hours are grouped by person and week, and a whole week is approved in one click', async () => {
    const seen = api()
    open(users.manager)
    const user = userEvent.setup()
    const week = (await screen.findByRole('region', { name: /eli employee, week of oct 12, 2026/i }))
    expect(within(week).getByText(/2 entries · 16h waiting/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /eli employee, week of oct 5, 2026/i })).toBeInTheDocument()
    await user.click(within(week).getByRole('button', { name: 'Approve week' }))
    await waitFor(() => expect(seen.approved).toEqual([{ entries: [{ id: 'e1', expected_hours: 8 }, { id: 'e2', expected_hours: 8 }] }]))
    expect(await screen.findByText('Approved the week (2 entries)')).toBeInTheDocument()
  })

  test('hours changed after an HR submission say so', async () => {
    api()
    open(users.manager)
    const week = await screen.findByRole('region', { name: /ana ruiz, week of oct 12, 2026/i })
    expect(within(week).getByText('Changed after HR submission — re-send')).toBeInTheDocument()
  })

  test("a filter from an alert shows one person's hours, with a way back to everyone", async () => {
    api()
    open(users.manager, `/timesheets?user=${eli.id}`)
    expect(await screen.findByRole('button', { name: /show everyone/i })).toBeInTheDocument()
  })
})

const SAME = { code: 'SAME_HOURS_DAILY', severity: 'warn', message: 'Same 8h on 4 weekdays this week on Schema Mapping' }
const LATE = { code: 'BACKDATED', severity: 'info', message: 'Logged 10 days after the day worked' }
const flaggedQueue = [
  { ...item('e1', eli, '2026-10-12', 8, { source: 'tracked', tracked_hours: 8, note: 'Mapped the address fields' }), flags: [SAME, LATE] },
  { ...item('e2', eli, '2026-10-13', 8, { source: 'manual', tracked_hours: 0 }), flags: [SAME],
    progress_update: { body: 'Address mapping is 80% done', created_at: '2026-10-13T20:00:00Z' } },
  { ...item('e5', ana, '2026-10-12', 4, { source: 'manual', tracked_hours: 0, note: 'Reviewed the test load' }), flags: [] },
]

describe('Timesheets: proof of work, tracked share and red flags', () => {
  test('each entry shows its source, its proof and its red flags; each week its tracked share and flag count', async () => {
    api({ approvals: flaggedQueue })
    open(users.manager)
    const user = userEvent.setup()
    const week = await screen.findByRole('region', { name: /eli employee, week of oct 12, 2026/i })
    expect(within(week).getByText(/Tracked 50% · Manual 50%/)).toBeInTheDocument()
    expect(within(week).getByText('⚠ 3 red flags')).toBeInTheDocument()
    expect(within(week).getByText('Tracked')).toBeInTheDocument()
    expect(within(week).getByText('“Mapped the address fields”')).toBeInTheDocument()
    expect(within(week).getByText('Progress update: Address mapping is 80% done')).toBeInTheDocument()
    expect(within(week).getAllByText('⚠ Repeated hours')).toHaveLength(2)
    await user.hover(within(week).getByText('⚠ Backdated'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Logged 10 days after the day worked')
    const ana_ = screen.getByRole('region', { name: /ana ruiz, week of oct 12, 2026/i })
    expect(within(ana_).getByText(/Tracked 0% · Manual 100%/)).toBeInTheDocument()
    expect(within(ana_).queryByText(/red flag/)).not.toBeInTheDocument()
  })

  test('"Only flagged" keeps the person-weeks with a red flag', async () => {
    api({ approvals: flaggedQueue })
    open(users.manager)
    const user = userEvent.setup()
    await screen.findByRole('region', { name: /ana ruiz, week of oct 12, 2026/i })
    await user.click(screen.getByRole('switch', { name: 'Only flagged' }))
    expect(screen.getByRole('region', { name: /eli employee, week of oct 12, 2026/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /ana ruiz/i })).not.toBeInTheDocument()
  })

  test('"Only flagged" with nothing flagged says so', async () => {
    api({ approvals: [{ ...item('e5', ana, '2026-10-12', 4), flags: [] }] })
    open(users.manager)
    await screen.findByRole('region', { name: /ana ruiz/i })
    await userEvent.click(screen.getByRole('switch', { name: 'Only flagged' }))
    expect(screen.getByText('No red flags')).toBeInTheDocument()
  })

  test('the CSV carries the source and the flags', async () => {
    api({ approvals: flaggedQueue })
    downloads.length = 0
    open(users.manager)
    await screen.findByRole('region', { name: /eli employee/i })
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].csv).toContain('Source,Tracked hours,Red flags')
    expect(downloads[0].csv).toContain('Tracked,8,Repeated hours; Backdated')
  })

  test('approved weeks show how much came from timers', async () => {
    api()
    server.use(http.get(`${API}/timesheets/approved`, () => HttpResponse.json([{ ...weeks[0], tracked_hours: 27.2 }])))
    open(users.manager, '/timesheets?tab=approved')
    const table = await screen.findByRole('table', { name: /approved weeks/i })
    expect(within(table).getByText('Tracked 68% · Manual 32%')).toBeInTheDocument()
  })
})

describe('Timesheets tabs by role', () => {
  test('managers review and see approved weeks, without costs or HR submission', async () => {
    const seen = api()
    open(users.manager)
    const user = userEvent.setup()
    await screen.findByRole('region', { name: /eli employee, week of oct 12/i })
    await waitFor(() => expect(tabNames()).toEqual(['To review', 'Manual hours 0', 'Approved']))
    await user.click(screen.getByRole('tab', { name: 'Approved' }))
    const table = await screen.findByRole('table', { name: /approved weeks/i })
    expect(within(table).getByText('Submitted to HR')).toBeInTheDocument()
    expect(within(table).getByText('Changed after HR submission — re-send')).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Cost' })).not.toBeInTheDocument()
    expect(seen.weeksAsked.at(-1)).toHaveProperty('from')
  })

  test('admins also get HR submission: preview, corrections and one confirm to submit', async () => {
    const seen = api()
    open(users.admin, '/timesheets?tab=hr')
    const user = userEvent.setup()
    expect(await screen.findByRole('tab', { name: /HR submission/ })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(tabNames()).toEqual(['To review', 'Manual hours 0', 'Approved', 'HR submission']))
    expect(await screen.findByText(/12 approved entries · 90h · \$4,500 · 4 people/)).toBeInTheDocument()
    expect(screen.getByText(/2 entries in this period still wait for approval/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /include 1 changed entry ready to re-send/i })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Needs re-submission (1)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit to HR' }))
    const dialog = await screen.findByRole('dialog', { name: /submit .* to hr/i })
    await user.click(within(dialog).getByRole('button', { name: 'Submit to HR' }))
    await waitFor(() => expect(seen.submitted).toHaveLength(1))
    expect(seen.submitted[0]).toMatchObject({ include_corrections: true })
    expect(seen.submitted[0].period_start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('the public demo admin sees HR submission but its submit button is disabled', async () => {
    api()
    open(users.demoAdmin, '/timesheets?tab=hr')
    expect(await screen.findByText(/12 approved entries/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit to HR' })).toBeDisabled()
  })

  test('admins download a payroll CSV from a submission row', async () => {
    api()
    downloads.length = 0
    open(users.admin, '/timesheets?tab=hr')
    const user = userEvent.setup()
    const table = await screen.findByRole('table', { name: /hr submissions/i })
    const row = within(table).getByRole('button', { name: 'Payroll CSV for Oct 5, 2026 – Oct 11, 2026' }).closest('tr')
    expect(within(row).getByText('Submitted to HR (export ready)')).toBeInTheDocument()
    expect(within(row).getByText(/re-sends changes to sep 28, 2026/i)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /payroll csv/i }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].filename).toMatch(/^scout-payroll-2026-10-05-to-2026-10-11-/)
    expect(downloads[0].csv).toContain('Ana Ruiz,u-ana,ana.ruiz,2026-10-05,2026-10-11,Correction,6,4,282.72,1,2026-09-28 to 2026-10-04')
  })

  test('executives only read the HR submissions: no review, no submit, no payroll download', async () => {
    let asked = false
    api()
    server.use(http.get(`${API}/approvals`, () => { asked = true; return HttpResponse.json([]) }),
      http.get(`${API}/manual-hours`, () => { asked = true; return HttpResponse.json([]) }))
    open(users.executive)
    const table = await screen.findByRole('table', { name: /hr submissions/i })
    expect(tabNames()).toEqual(['HR submissions'])
    expect(within(table).getAllByText('Submitted to HR (export ready)')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /submit to hr/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /payroll csv/i })).not.toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
    expect(asked).toBe(false)
  })
})

test('the old /approvals address opens Timesheets with the same filters', async () => {
  renderAsUser(<Routes><Route path="/approvals" element={<ApprovalsRedirect />} /><Route path="/timesheets" element={<p>timesheets</p>} /></Routes>,
    { user: users.manager, route: `/approvals?user=${eli.id}` })
  expect(await screen.findByText('timesheets')).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent(`/timesheets?user=${eli.id}`)
})

describe('Timesheets: the critical details are bold', () => {

  test("a person-week's waiting entries and an overtime request are bold; a plain pending entry is not", async () => {
    const overtime = 'Pending (Overtime requested from Eli Employee)'
    api({ approvals: [
      { ...item('e1', eli, '2026-10-12', 8, { over_40: true }), label: overtime },
      item('e2', eli, '2026-10-13', 8),
      item('e5', ana, '2026-10-12', 4),
    ] })
    open(users.manager)
    const week = await screen.findByRole('region', { name: /eli employee, week of oct 12, 2026/i })
    expect(bold(week)).toEqual(['2 entries · 16h waiting', overtime])
    expect(bold(screen.getByRole('region', { name: /ana ruiz, week of oct 12, 2026/i }))).toEqual(['1 entry · 4h waiting'])
  })

  test('HR submission: the entries still waiting for approval are bold', async () => {
    api()
    open(users.admin, '/timesheets?tab=hr')
    await screen.findByText(/12 approved entries · 90h/)
    const alert = screen.getAllByRole('alert').find((a) => /still wait for approval/.test(a.textContent))
    expect(bold(alert)).toEqual(['2 entries in this period still wait for approval'])
  })
})
