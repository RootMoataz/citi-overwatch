import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import RequestsPage from './RequestsPage.jsx'

const pending = {
  id: 'r1', name: 'Orion Analytics', description: 'Dashboards', proposed_start: '2026-11-01',
  proposed_end: '2027-03-31', proposed_budget: 75000, reason: null, status: 'pending',
  department: { id: 'd1', name: 'Technology' }, work_mode: 'pull',
  requested_by: { id: users.manager.id, name: 'Morgan Manager' }, decision_comment: null, project_id: null,
  created_at: '2026-10-13T10:00:00Z',
}
const departments = () => http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd1', name: 'Technology' }] }))

describe('RequestsPage', () => {
  test('a request card shows what the project starts with, not a reason', async () => {
    server.use(http.get(`${API}/project-requests`, () => HttpResponse.json([pending, {
      ...pending, id: 'r0', name: 'Legacy', reason: 'Written before reasons were dropped', department: null, work_mode: 'push' }])))
    renderAsUser(<RequestsPage />, { user: users.admin, route: '/requests', path: '/requests' })
    const card = (await screen.findByText('Orion Analytics')).closest('[data-request]')
    expect(within(card).getByText(/Technology/)).toBeInTheDocument()
    expect(within(card).getByText(/Pull mode/)).toBeInTheDocument()
    expect(within(card).getByText('Dashboards')).toBeInTheDocument()
    expect(screen.queryByText(/Written before reasons were dropped/)).not.toBeInTheDocument()
  })

  test('admin approves in one step (one confirm) and lands on the new project', async () => {
    let approvals = 0
    server.use(
      http.get(`${API}/project-requests`, () => HttpResponse.json([pending])),
      http.post(`${API}/project-requests/r1/approve`, async ({ request }) => {
        approvals += 1
        expect(await request.json()).toEqual({ template: true }) // Technology has a template: ticked by default
        return HttpResponse.json({
          request: { ...pending, status: 'approved', project_id: 'p-new' }, project: { id: 'p-new', name: 'Orion Analytics' } })
      }),
    )
    renderAsUser(<RequestsPage />, { user: users.admin, route: '/requests', path: '/requests' })
    const user = userEvent.setup()
    const card = (await screen.findByText('Orion Analytics')).closest('[data-request]')
    await user.click(within(card).getByRole('button', { name: 'Approve & create project' }))
    const dialog = await screen.findByRole('dialog', { name: /create orion analytics/i })
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument() // nothing to fill in
    expect(within(dialog).getByRole('checkbox', { name: 'Start from the Technology template' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Approve & create project' }))
    expect(await screen.findByText('project page p-new')).toBeInTheDocument()
    expect(approvals).toBe(1)
  })

  test('the department template can be left off, and a request without a department is approved with no body', async () => {
    const bodies = []
    server.use(
      http.get(`${API}/project-requests`, () => HttpResponse.json([pending, { ...pending, id: 'r2', name: 'Vega', department: null }])),
      http.post(`${API}/project-requests/:id/approve`, async ({ request, params }) => {
        bodies.push([params.id, await request.text()])
        return HttpResponse.json({ request: { ...pending, id: params.id, status: 'approved' }, project: { id: `p-${params.id}`, name: 'x' } })
      }),
    )
    const user = userEvent.setup()
    const { unmount } = renderAsUser(<RequestsPage />, { user: users.admin, route: '/requests', path: '/requests' })
    let card = (await screen.findByText('Orion Analytics')).closest('[data-request]')
    await user.click(within(card).getByRole('button', { name: 'Approve & create project' }))
    let dialog = await screen.findByRole('dialog', { name: /create orion analytics/i })
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Start from the Technology template' }))
    await user.click(within(dialog).getByRole('button', { name: 'Approve & create project' }))
    expect(await screen.findByText('project page p-r1')).toBeInTheDocument()
    unmount()
    renderAsUser(<RequestsPage />, { user: users.admin, route: '/requests', path: '/requests' })
    card = (await screen.findByText('Vega')).closest('[data-request]')
    await user.click(within(card).getByRole('button', { name: 'Approve & create project' }))
    dialog = await screen.findByRole('dialog', { name: /create vega/i })
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve & create project' }))
    expect(await screen.findByText('project page p-r2')).toBeInTheDocument()
    expect(bodies).toEqual([['r1', ''], ['r2', '']])
  })

  test('reject takes an optional short note', async () => {
    const bodies = []
    server.use(
      http.get(`${API}/project-requests`, () => HttpResponse.json([pending, { ...pending, id: 'r2', name: 'Vega' }])),
      http.post(`${API}/project-requests/:id/reject`, async ({ request, params }) => {
        const body = await request.json()
        bodies.push(body)
        return HttpResponse.json({ ...pending, id: params.id, status: 'rejected', decision_comment: body.comment ?? null })
      }),
    )
    renderAsUser(<RequestsPage />, { user: users.admin, route: '/requests', path: '/requests' })
    const user = userEvent.setup()
    let card = (await screen.findByText('Orion Analytics')).closest('[data-request]')
    await user.click(within(card).getByRole('button', { name: /reject/i }))
    let dialog = await screen.findByRole('dialog', { name: /reject this request/i })
    expect(within(dialog).getByLabelText(/note \(optional\)/i)).not.toBeRequired()
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(bodies).toEqual([{}]))
    card = screen.getByText('Vega').closest('[data-request]')
    await user.click(within(card).getByRole('button', { name: /reject/i }))
    dialog = await screen.findByRole('dialog', { name: /reject this request/i })
    await user.type(within(dialog).getByLabelText(/note \(optional\)/i), 'Not this quarter')
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(bodies[1]).toEqual({ comment: 'Not this quarter' }))
  })

  test('manager submits a request without a reason, choosing department and work mode', async () => {
    let posted = null
    const list = []
    server.use(
      departments(),
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
    expect(within(dialog).queryByLabelText(/reason/i)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^name/i), 'Orion Analytics')
    await user.type(within(dialog).getByLabelText(/proposed start/i), '2026-11-01')
    await user.type(within(dialog).getByLabelText(/proposed end/i), '2027-03-31')
    await user.click(within(dialog).getByLabelText(/department/i))
    await user.click(await screen.findByRole('option', { name: 'Technology' }))
    await user.click(within(dialog).getByLabelText(/work mode/i))
    await user.click(await screen.findByRole('option', { name: 'Pull' }))
    await user.click(within(dialog).getByRole('button', { name: /submit request/i }))
    await waitFor(() => expect(posted).toMatchObject({ name: 'Orion Analytics', department_id: 'd1', work_mode: 'pull' }))
    expect(posted).not.toHaveProperty('reason')
    expect(await screen.findByText('Orion Analytics')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
