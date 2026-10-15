import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import PersonProfilePage from './PersonProfilePage.jsx'

const profile = ({ salary } = {}) => ({
  user: { id: 'u-ada', name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace', job_title: 'Analyst', role: 'employee',
    is_archived: false, manager: { id: 'u-mgr', name: 'Morgan Manager' }, ...(salary == null ? {} : { salary }) },
  this_week: { week_start: '2026-10-12', logged: 46, overtime: 6, planned: 45 },
  all_time: { logged: 52, approved: 30 },
  projects: [
    { id: 'p1', name: 'Apollo', status: 'active', start_date: '2026-01-01', predicted_end_date: '2026-12-31', is_archived: false,
      planned_hours_per_week: 30, on_team: true, logged_hours: 34, approved_hours: 24, can_open: true },
    { id: 'p9', name: 'Done', status: 'completed', start_date: '2025-01-01', predicted_end_date: '2025-06-30', is_archived: false,
      planned_hours_per_week: 10, on_team: true, logged_hours: 6, approved_hours: 6, can_open: false }],
  milestones: [
    { id: 'm1', name: 'Review', status: 'in_progress', start_date: '2026-10-01', end_date: '2026-10-31', is_archived: false,
      role: 'supporting', project: { id: 'p1', name: 'Apollo' }, logged_hours: 12, approved_hours: 0, can_open: true,
      difficulty: 'easy' }],
})

const renderProfile = (viewer, body, status = 200) => {
  server.use(http.get(`${API}/users/u-ada/profile`, () => (status === 200 ? HttpResponse.json(body)
    : HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status }))))
  return renderAsUser(<PersonProfilePage />, { user: viewer, route: '/people/u-ada/profile', path: '/people/:id/profile' })
}

describe('PersonProfilePage', () => {
  test('admins see the salary, this week, all-time totals and the history', async () => {
    renderProfile(users.admin, profile({ salary: 90000 }))
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Annual salary')).toBeInTheDocument()
    expect(screen.getByText('$90,000')).toBeInTheDocument()
    expect(screen.getByText('Morgan Manager')).toBeInTheDocument()
    const overtime = screen.getByText('Overtime this week').parentElement
    expect(within(overtime).getByText('6h')).toBeInTheDocument()
    expect(within(overtime).getByText('Over 40h this week')).toBeInTheDocument()
    const projects = screen.getByRole('table', { name: /projects ada lovelace has been on/i })
    expect(within(projects).getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/p1')
    expect(within(projects).getByText('Done')).not.toHaveAttribute('href')   // can't open it: plain text
    expect(within(projects).getByText('Completed')).toBeInTheDocument()
    const milestones = screen.getByRole('table', { name: /milestones ada lovelace has worked on/i })
    const row = within(milestones).getByRole('rowheader', { name: 'Review' }).closest('tr')
    expect(within(row).getByText('Supporting')).toBeInTheDocument()
    expect(within(row).getByText('12h')).toBeInTheDocument()
    expect(within(row).getByLabelText('Difficulty: Easy')).toBeInTheDocument()
  })

  test('managers never see a salary', async () => {
    renderProfile(users.manager, profile())
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('Annual salary')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  test('someone the viewer may not see shows a not-available state', async () => {
    renderProfile(users.employee, null, 404)
    expect(await screen.findByText('Profile not available')).toBeInTheDocument()
  })

  test('shows the department the person is in', async () => {
    const body = profile()
    renderProfile(users.admin, { ...body, user: { ...body.user, department: { id: 'd1', name: 'Technology' } } })
    const label = await screen.findByText('Department')
    expect(within(label.parentElement).getByText('Technology')).toBeInTheDocument()
  })
})
