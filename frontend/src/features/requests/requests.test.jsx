import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import RequestsPage from './RequestsPage.jsx'

const pending = {
  id: 'r1', name: 'Orion Analytics', description: 'Dashboards', proposed_start: '2026-11-01',
  proposed_end: '2027-03-31', proposed_budget: 75000, reason: 'Visibility', status: 'pending',
  requested_by: { id: users.manager.id, name: 'Morgan Manager' }, decision_comment: null, project_id: null,
  created_at: '2026-10-13T10:00:00Z',
}

describe('RequestsPage', () => {
  test('admin approves a request and is routed to the new project', async () => {
    server.use(
      http.get(`${API}/project-requests`, () => HttpResponse.json([pending])),
      http.post(`${API}/project-requests/r1/approve`, () => HttpResponse.json({
        request: { ...pending, status: 'approved', project_id: 'p-new' }, project: { id: 'p-new', name: 'Orion Analytics' } })),
    )
    renderAsUser(<RequestsPage />, { user: users.admin, route: '/requests', path: '/requests' })
    const card = (await screen.findByText('Orion Analytics')).closest('[data-request]')
    await userEvent.click(within(card).getByRole('button', { name: /approve/i }))
    expect(await screen.findByText('project page p-new')).toBeInTheDocument()
  })

  test('reject requires a comment', async () => {
    let body = null
    server.use(
      http.get(`${API}/project-requests`, () => HttpResponse.json([pending])),
      http.post(`${API}/project-requests/r1/reject`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ...pending, status: 'rejected', decision_comment: body.comment })
      }),
    )
    renderAsUser(<RequestsPage />, { user: users.admin, route: '/requests', path: '/requests' })
    const user = userEvent.setup()
    const card = (await screen.findByText('Orion Analytics')).closest('[data-request]')
    await user.click(within(card).getByRole('button', { name: /reject/i }))
    const dialog = await screen.findByRole('dialog', { name: /reject this request/i })
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    expect(await within(dialog).findByText('Add a comment for the requester')).toBeInTheDocument()
    expect(body).toBeNull()
    await user.type(within(dialog).getByLabelText(/comment/i), 'Not this quarter')
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(body).toEqual({ comment: 'Not this quarter' }))
  })

  test('manager submits a request and sees it listed', async () => {
    let posted = null
    const list = []
    server.use(
      http.get(`${API}/project-requests`, () => HttpResponse.json(list)),
      http.post(`${API}/project-requests`, async ({ request }) => {
        posted = await request.json()
        list.push({ ...pending, ...posted, id: 'r2' })
        return HttpResponse.json(list.at(-1), { status: 201 })
      }),
    )
    renderAsUser(<RequestsPage />, { user: users.manager, route: '/requests', path: '/requests' })
    const user = userEvent.setup()
    expect(await screen.findByText(/you haven't requested any projects/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /request a project/i }))
    const dialog = await screen.findByRole('dialog', { name: /request a project/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Orion Analytics')
    await user.type(within(dialog).getByLabelText(/proposed start/i), '2026-11-01')
    await user.type(within(dialog).getByLabelText(/proposed end/i), '2027-03-31')
    await user.type(within(dialog).getByLabelText(/reason/i), 'Visibility')
    await user.click(within(dialog).getByRole('button', { name: /submit request/i }))
    await waitFor(() => expect(posted).toMatchObject({ name: 'Orion Analytics', reason: 'Visibility' }))
    expect(await screen.findByText('Orion Analytics')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
