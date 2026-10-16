import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import MyWeekPage from './MyWeekPage.jsx'

const freeze = (iso) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}
// Thursday 15 Oct 2026, noon in New York. Only Date is faked: faking every timer makes userEvent hang.
beforeEach(() => freeze('2026-10-15T16:00:00Z'))
afterEach(() => {
  vi.useRealTimers()
  server.events.removeAllListeners()
  localStorage.clear()
})

const manager = { id: 'u-mgr', name: 'Morgan Manager', first_name: 'Morgan', job_title: 'Delivery Manager',
  department: { id: 'd1', name: 'Technology' }, is_archived: false }
const thisWeek = (o = {}) => ({ week_start: '2026-10-12', logged: 19.75, overtime: 0, planned: 30, ...o })
const full = (week = thisWeek()) => ({
  user: { id: 'u-emp', name: 'Eli Employee', role: 'employee', manager },
  this_week: week, all_time: { logged: 300, approved: 280 }, projects: [], skills: [], milestones: [], coming_up: [],
})
const past = { week_start: '2026-10-05', logged: 12.5, overtime: 0, planned: 36 }
const slim = (week) => ({ user: { id: 'u-emp' }, this_week: week })

const calls = []
function serve({ profile = full(), weekly = () => slim(past), weeklyStatus = 200 } = {}) {
  calls.length = 0
  server.use(
    http.get(`${API}/users/u-emp/profile`, ({ request }) => {
      const url = new URL(request.url)
      calls.push(url.search)
      if (url.searchParams.get('sections') === 'this_week') {
        return weeklyStatus === 200 ? HttpResponse.json(weekly(url.searchParams.get('week')))
          : HttpResponse.json({ error: { code: 'X', message: 'Could not load that week' } }, { status: weeklyStatus })
      }
      return HttpResponse.json(profile)
    }),
    http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [{ id: 'u-mgr', name: 'Morgan Manager' }], can_group: false })),
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: '2026-10-12', user: { id: 'u-emp' }, entries: [],
      totals: { logged: 0, approved: 0 }, rows: [] })),
  )
}
const render = (route = '/') => renderAsUser(<MyWeekPage />, { user: users.employee, route })
const picker = () => screen.getByRole('group', { name: "Week shown in This week's hours" })
const hoursCard = (name = "This week's hours") => screen.findByRole('region', { name })

describe('header and week picker', () => {
  test('the title and the greeting', async () => {
    serve()
    render()
    expect(await screen.findByRole('heading', { level: 1, name: 'My week' })).toBeInTheDocument()
    expect(screen.getByText('Hello, Eli. Your work and hours in one place.')).toBeInTheDocument()
  })

  test('this week: the range reads out and Next and This week are disabled', async () => {
    serve()
    render()
    await hoursCard()
    expect(within(picker()).getByText('Oct 12 – 18, 2026')).toBeInTheDocument()
    expect(within(picker()).getByRole('button', { name: 'Next week' })).toBeDisabled()
    expect(within(picker()).getByRole('button', { name: 'This week' })).toBeDisabled()
    expect(within(picker()).getByRole('button', { name: 'Previous week' })).toBeEnabled()
  })

  test('Previous week sets ?week=, asks for that week alone, retitles the card and points the timesheet link at it', async () => {
    serve()
    render()
    await hoursCard()
    await userEvent.click(within(picker()).getByRole('button', { name: 'Previous week' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/?week=2026-10-05')
    const card = await hoursCard('Hours · week of Oct 5')
    expect(await within(card).findByText('12.5h logged')).toBeInTheDocument()
    expect(calls).toContain('?week=2026-10-05&sections=this_week')
    expect(within(card).getByRole('link', { name: 'Open my timesheet' })).toHaveAttribute('href', '/timesheet?week=2026-10-05')
    expect(within(picker()).getByText('Oct 5 – 11, 2026')).toBeInTheDocument()
    expect(within(picker()).getByRole('button', { name: 'Next week' })).toBeEnabled()
  })

  test('This week drops ?week= and needs no sections request', async () => {
    serve()
    render('/?week=2026-10-05')
    await hoursCard('Hours · week of Oct 5')
    calls.length = 0
    await userEvent.click(within(picker()).getByRole('button', { name: 'This week' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    const card = await hoursCard()
    expect(await within(card).findByText('19.75h logged')).toBeInTheDocument()
    expect(calls.filter((c) => c.includes('sections'))).toEqual([])
  })

  test('Next week steps forward to the current week', async () => {
    serve()
    render('/?week=2026-10-05')
    await hoursCard('Hours · week of Oct 5')
    await userEvent.click(within(picker()).getByRole('button', { name: 'Next week' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  test('a week of another year spells the year out in the title', async () => {
    serve({ weekly: () => slim({ week_start: '2025-12-29', logged: 1, overtime: 0, planned: 2 }) })
    render('/?week=2025-12-29')
    expect(await hoursCard('Hours · week of Dec 29, 2025')).toBeInTheDocument()
  })

  test('Sunday evening in New York, after the UTC date rolled to Monday: still the week of Oct 12', async () => {
    freeze('2026-10-19T02:00:00Z')
    serve({ profile: full(thisWeek({ week_start: '2026-10-19' })), weekly: () => slim(thisWeek({ logged: 7 })) })
    render()
    const card = await hoursCard()
    expect(within(picker()).getByText('Oct 12 – 18, 2026')).toBeInTheDocument()
    expect(within(picker()).getByRole('button', { name: 'Next week' })).toBeDisabled()
    expect(await within(card).findByText('7h logged')).toBeInTheDocument()
    expect(calls).toContain('?week=2026-10-12&sections=this_week')
  })

  test.each(['2026-11-02', 'garbage'])('a typed ?week=%s shows this week and names no future week', async (typed) => {
    const asked = []
    server.events.on('request:start', ({ request }) => asked.push(request.url))
    serve()
    render(`/?week=${typed}`)
    await hoursCard()
    expect(within(picker()).getByText('Oct 12 – 18, 2026')).toBeInTheDocument()
    expect(within(picker()).getByRole('button', { name: 'Next week' })).toBeDisabled()
    expect(asked.filter((u) => u.includes('2026-11-02'))).toEqual([])
  })

  test('a mid-week date in ?week= is read as its Monday', async () => {
    serve()
    render('/?week=2026-10-07')
    expect(await hoursCard('Hours · week of Oct 5')).toBeInTheDocument()
  })
})

describe("This week's hours", () => {
  test('the figures, the scale, the caption and the way into the timesheet', async () => {
    serve()
    render()
    const card = await hoursCard()
    expect(within(card).getByText('Pending + approved')).toBeInTheDocument()
    expect(within(card).getByText('19.75h logged')).toBeInTheDocument()
    expect(within(card).getByText('/ 40h weekly reference')).toBeInTheDocument()
    const bar = within(card).getByRole('progressbar', { name: 'Hours logged this week' })
    expect(bar).toHaveAttribute('aria-valuetext', '19.75h of 40h, 30h planned')
    expect(bar).toHaveAttribute('data-over', 'false')
    for (const text of ['0h', '30h planned', '40h', 'Planned', 'Logged', '30h', '19.75h']) {
      expect(within(card).getByText(text)).toBeInTheDocument()
    }
    expect(within(card).getByText('Logged hours include pending and approved entries.')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open my timesheet' })).toHaveAttribute('href', '/timesheet?week=2026-10-12')
    expect(within(card).queryByText(/over 40h/)).not.toBeInTheDocument()
  })

  test('an earlier week names itself on the bar', async () => {
    serve()
    render('/?week=2026-10-05')
    const card = await hoursCard('Hours · week of Oct 5')
    expect(await within(card).findByRole('progressbar', { name: 'Hours logged in the week of Oct 5' })).toBeInTheDocument()
  })

  test('past 40h the bar says so in words as well', async () => {
    serve({ profile: full(thisWeek({ logged: 45, overtime: 5 })) })
    render()
    const card = await hoursCard()
    expect(within(card).getByText('5h over 40h (sent to your manager as overtime)')).toBeInTheDocument()
    expect(within(card).getByRole('progressbar', { name: 'Hours logged this week' })).toHaveAttribute('data-over', 'true')
  })

  test('a failed week shows the error with Try again inside the card, and retrying loads it', async () => {
    serve({ weeklyStatus: 500 })
    render('/?week=2026-10-05')
    const card = await hoursCard('Hours · week of Oct 5')
    const alert = await within(card).findByRole('alert')
    expect(alert).toHaveTextContent('Could not load that week')
    serve()
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await within(card).findByText('12.5h logged')).toBeInTheDocument()
  })

  test('it collapses and remembers under week', async () => {
    serve()
    render()
    const card = await hoursCard()
    await userEvent.click(within(card).getByRole('button', { name: "This week's hours" }))
    expect(within(card).getByRole('button', { name: "This week's hours" })).toHaveAttribute('aria-expanded', 'false')
    expect(JSON.parse(localStorage.getItem('overwatch.myweek.sections'))).toEqual({ week: true })
  })
})

describe('Your manager', () => {
  test('the card, the message link and its collapse', async () => {
    serve()
    render()
    const card = await screen.findByRole('region', { name: 'Your manager' })
    expect(within(card).getByText('Morgan Manager')).toBeInTheDocument()
    expect(within(card).getByText('Delivery Manager · Technology')).toBeInTheDocument()
    expect(await within(card).findByRole('link', { name: 'Message Morgan' })).toHaveAttribute('href', '/messages?to=u-mgr')
    await userEvent.click(within(card).getByRole('button', { name: 'Your manager' }))
    expect(JSON.parse(localStorage.getItem('overwatch.myweek.sections'))).toEqual({ manager: true })
  })
})

describe('phones', () => {
  test('one column in the order: focus, hours, groups, claim, manager', async () => {
    setViewport(375)
    serve({ profile: { ...full(), milestones: [{ id: 'm1', name: 'Build', status: 'in_progress', display_status: 'in_progress',
      difficulty: 'hard', priority: 'high', start_date: '2026-10-01', end_date: '2026-11-30', waiting_on: [], progress_percent: 10,
      is_archived: false, role: 'primary', project: { id: 'p1', name: 'Apollo', status: 'active', is_archived: false }, can_open: true }] } })
    render()
    await screen.findByRole('region', { name: 'Your manager' })
    await screen.findByRole('region', { name: 'Available to claim · 0' })
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles).toEqual(['Your focus', "This week's hours", 'In progress (1)', 'Available to claim · 0', 'Your manager'])
  })
})

describe('privacy and states', () => {
  test('an employee only ever asks for their own data', async () => {
    const asked = []
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url)))
    serve()
    render()
    await hoursCard()
    await userEvent.click(within(picker()).getByRole('button', { name: 'Previous week' }))
    await hoursCard('Hours · week of Oct 5')
    await waitFor(() => expect(asked.some((u) => u.searchParams.get('sections'))).toBe(true))
    const paths = asked.map((u) => u.pathname.replace(API, ''))
    for (const path of paths.filter((p) => /^\/users\/[^/]+/.test(p) && p !== '/users/u-mgr/avatar')) {
      expect(path.split('/')[2]).toBe('u-emp')
    }
    expect(paths.filter((p) => p.startsWith('/approvals') || p.startsWith('/allocations'))).toEqual([])
    expect(asked.filter((u) => u.pathname.endsWith('/time-entries') && u.searchParams.has('user'))).toEqual([])
  })

  test('a profile error shows the error with Try again', async () => {
    server.use(http.get(`${API}/users/u-emp/profile`, () => HttpResponse.json({ error: { code: 'X', message: 'Profile broke' } }, { status: 500 })),
      http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
      http.get(`${API}/time-entries`, () => HttpResponse.json({ entries: [], totals: {}, rows: [] })))
    render()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Profile broke')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
