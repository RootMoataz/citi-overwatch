import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import Layout from '../../app/Layout.jsx'
import RequireAuth from '../../auth/RequireAuth.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../../test/render.jsx'
import DepartmentsPage from './DepartmentsPage.jsx'

const departments = [
  { id: 'd1', name: 'Technology', is_archived: false, user_count: 7, project_count: 2 },
  { id: 'd2', name: 'Operations', is_archived: false, user_count: 0, project_count: 0 },
  { id: 'd9', name: 'Legacy', is_archived: true, user_count: 1, project_count: 0 },
]

const renderPage = () => renderAsUser(<DepartmentsPage />, { user: users.admin, route: '/departments', path: '/departments' })

describe('DepartmentsPage', () => {
  test('lists active and archived departments with their people and project counts', async () => {
    let asked = null
    server.use(http.get(`${API}/departments`, ({ request }) => {
      asked = new URL(request.url).searchParams.get('include_archived')
      return HttpResponse.json({ items: departments })
    }))
    renderPage()
    const table = await screen.findByRole('table', { name: /departments/i })
    expect(asked).toBe('true')
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    const tech = screen.getByRole('row', { name: /technology/i })
    expect(tech).toHaveTextContent('7')
    expect(tech).toHaveTextContent('2')
    expect(screen.getByRole('row', { name: /legacy/i })).toHaveTextContent(/archived/i)
    expect(screen.getByRole('button', { name: /restore legacy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archive technology/i })).toBeInTheDocument()
  })

  test('adds a department', async () => {
    let sent = null
    server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: departments })),
      http.post(`${API}/departments`, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ id: 'd3', name: sent.name, is_archived: false, user_count: 0, project_count: 0 }, { status: 201 })
      }))
    renderPage()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: /new department/i }), 'Risk & Compliance')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(sent).toEqual({ name: 'Risk & Compliance' }))
    expect(await screen.findByText('Added Risk & Compliance')).toBeInTheDocument()
  })

  test('a duplicate name shows the server\'s answer on the field', async () => {
    server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: departments })),
      http.post(`${API}/departments`, () => HttpResponse.json({ error: { code: 'CONFLICT', message: 'That name is already taken',
        details: { name: 'taken' } } }, { status: 409 })))
    renderPage()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: /new department/i }), 'technology')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText(/a department with this name already exists/i)).toBeInTheDocument()
  })

  test('renames a department in a dialog', async () => {
    let sent = null
    server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: departments })),
      http.put(`${API}/departments/d2`, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ ...departments[1], name: sent.name })
      }))
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /rename operations/i }))
    const dialog = await screen.findByRole('dialog', { name: /rename operations/i })
    const field = within(dialog).getByRole('textbox', { name: /name/i })
    await user.clear(field)
    await user.type(field, 'Ops')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(sent).toEqual({ name: 'Ops' }))
  })

  test('archive asks first, then archives', async () => {
    let archived = null
    server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: departments })),
      http.delete(`${API}/departments/d1`, () => { archived = 'd1'; return new HttpResponse(null, { status: 204 }) }))
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /archive technology/i }))
    const dialog = await screen.findByRole('dialog', { name: /archive technology/i })
    expect(dialog).toHaveTextContent(/keep it/i)
    expect(archived).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /^archive$/i }))
    await waitFor(() => expect(archived).toBe('d1'))
  })

  test('only admins can open it, and it is in the admin navigation only', () => {
    const { unmount } = renderAsUser(<RequireAuth roles={['admin']}><DepartmentsPage /></RequireAuth>,
      { user: users.manager, route: '/departments', path: '/departments' })
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
    unmount()
    const admin = renderWithProviders(<Routes><Route path="*" element={<Layout user={users.admin} />} /></Routes>)
    expect(screen.getByRole('navigation', { name: /main/i })).toHaveTextContent('Departments')
    admin.unmount()
    renderWithProviders(<Routes><Route path="*" element={<Layout user={users.manager} />} /></Routes>)
    expect(screen.getByRole('navigation', { name: /main/i })).not.toHaveTextContent('Departments')
  })
})
