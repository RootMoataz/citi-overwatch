import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import MyWeekPage from '../home/MyWeekPage.jsx'
import PersonProfilePage from './PersonProfilePage.jsx'
import YourManagerCard from './YourManagerCard.jsx'

describe('Your manager', () => {
  const manager = { id: 'u-mgr', name: 'Morgan Manager', first_name: 'Morgan', last_name: 'Manager',
    job_title: 'Delivery Manager', department: { id: 'd1', name: 'Technology' }, is_archived: false }

  test('shows who it is and messages them in one press', async () => {
    server.use(http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [{ id: 'u-mgr', name: 'Morgan Manager' }],
      can_group: false })))
    renderAsUser(<YourManagerCard manager={manager} />, { user: users.employee })
    const card = screen.getByRole('region', { name: 'Your manager' })
    expect(within(card).getByText('Morgan Manager')).toBeInTheDocument()
    expect(within(card).getByText('Delivery Manager · Technology')).toBeInTheDocument()
    const button = await within(card).findByRole('link', { name: 'Message Morgan' })
    expect(button).toHaveAttribute('href', '/messages?to=u-mgr')
    await userEvent.click(button)
    expect(screen.getByTestId('location')).toHaveTextContent('/messages?to=u-mgr')
  })

  test('shows nothing without a manager', () => {
    renderAsUser(<YourManagerCard manager={null} />, { user: users.employee })
    expect(screen.queryByRole('region', { name: 'Your manager' })).not.toBeInTheDocument()
  })
})

describe('where the card shows', () => {
  const profile = (manager) => ({ user: { id: 'u-emp', name: 'Eli Employee', role: 'employee', manager },
    this_week: { week_start: '2026-10-12', logged: 8, overtime: 0, planned: 40 }, all_time: { logged: 8, approved: 0 },
    projects: [], milestones: [], skills: [] })
  const manager = { id: 'u-mgr', name: 'Morgan Manager', first_name: 'Morgan', job_title: 'Delivery Manager', department: null,
    is_archived: false }

  test('on My week, with one press to message the manager', async () => {
    server.use(http.get(`${API}/users/u-emp/profile`, () => HttpResponse.json(profile(manager))),
      http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [{ id: 'u-mgr', name: 'Morgan Manager' }], can_group: false })),
      http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })))
    renderAsUser(<MyWeekPage />, { user: users.employee })
    const card = await screen.findByRole('region', { name: 'Your manager' })
    expect(await within(card).findByRole('link', { name: 'Message Morgan' })).toHaveAttribute('href', '/messages?to=u-mgr')
  })

  test('on your own profile only', async () => {
    server.use(http.get(`${API}/users/:id/profile`, () => HttpResponse.json(profile(manager))))
    const { unmount } = renderAsUser(<PersonProfilePage />, { user: users.employee, route: '/people/u-emp/profile', path: '/people/:id/profile' })
    expect(await screen.findByRole('region', { name: 'Your manager' })).toBeInTheDocument()
    expect(screen.getByText('Reports to')).toBeInTheDocument() // the small row stays
    unmount()
    renderAsUser(<PersonProfilePage />, { user: users.manager, route: '/people/u-emp/profile', path: '/people/:id/profile' })
    expect(await screen.findByText('Reports to')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Your manager' })).not.toBeInTheDocument()
  })
})
