import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../test/server.js'
import { renderAsUser, users } from '../test/render.jsx'
import NotificationBell from './NotificationBell.jsx'

function bell(notification, user) {
  server.use(
    http.get(`${API}/notifications`, () => HttpResponse.json([notification])),
    http.post(`${API}/notifications/${notification.id}/read`, () => HttpResponse.json({ id: notification.id, read: true })),
  )
  renderAsUser(<NotificationBell />, { user, route: '/', path: '/' })
}

describe('the manual hours bells', () => {
  test('a request for review opens Manual hours filtered to the person', async () => {
    bell({ id: 'n1', type: 'MANUAL_HOURS_SUBMITTED', week_start: '2026-10-12', payload: {}, subject_user: { id: 'u-ben', name: 'Ben Okafor' },
      message: 'Ben logged 2h on Schema Mapping (Wed 14 Oct) without the timer: Forgot to start the timer' }, users.manager)
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const item = await screen.findByRole('menuitem', { name: /Ben logged 2h on Schema Mapping/ })
    expect(within(item).getByText('Review it in Manual hours')).toBeInTheDocument()
    await userEvent.click(item)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/timesheets?tab=manual&user=u-ben'))
  })

  test('an approval opens the timesheet of that week', async () => {
    bell({ id: 'n2', type: 'MANUAL_HOURS_APPROVED', week_start: '2026-10-12', payload: {}, subject_user: { id: 'u-emp', name: 'Eli Employee' },
      message: 'Kim approved your 2h of manual hours on Schema Mapping (Wed 14 Oct)' }, users.employee)
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const item = await screen.findByRole('menuitem', { name: /Kim approved your 2h of manual hours/ })
    expect(within(item).getByText('Open your timesheet for that week')).toBeInTheDocument()
    await userEvent.click(item)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/timesheet?week=2026-10-12'))
  })
})
