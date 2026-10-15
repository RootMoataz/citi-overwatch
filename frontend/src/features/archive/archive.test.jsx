import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import Layout from '../../app/Layout.jsx'
import RequireAuth from '../../auth/RequireAuth.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../../test/render.jsx'
import ArchivePage from './ArchivePage.jsx'

const avery = { id: 'u-admin', name: 'Avery Admin' }
const items = [
  { type: 'project', id: 'p9', name: 'Gone Project', archived_at: '2026-10-13T12:00:00Z', archived_by: avery, can_restore: true },
  { type: 'milestone', id: 'm9', name: 'Dropped Milestone', archived_at: '2026-10-12T12:00:00Z', archived_by: avery,
    project: { id: 'p1', name: 'Apollo' }, can_restore: true },
  { type: 'user', id: 'u9', name: 'Lee Leaver', username: 'lleaver', archived_at: '2026-10-11T12:00:00Z', archived_by: null, can_restore: true },
]

const renderArchive = () => renderAsUser(<ArchivePage />, { user: users.admin, route: '/archive', path: '/archive' })

describe('ArchivePage', () => {
  test('a manager sees their own archived projects read-only and can restore their milestones; no people', async () => {
    const managerItems = [
      { type: 'project', id: 'p7', name: 'Shelved Project', archived_at: '2026-10-13T12:00:00Z', archived_by: avery, can_restore: false },
      { type: 'milestone', id: 'm7', name: 'Cut Milestone', archived_at: '2026-10-12T12:00:00Z', archived_by: null,
        project: { id: 'p1', name: 'Apollo' }, can_restore: true },
    ]
    let restored = null
    server.use(http.get(`${API}/archive`, () => HttpResponse.json({ items: managerItems })),
      http.post(`${API}/milestones/m7/restore`, () => { restored = 'm7'; return HttpResponse.json({ id: 'm7' }) }))
    renderAsUser(<ArchivePage />, { user: users.manager, route: '/archive', path: '/archive' })
    const project = await screen.findByRole('row', { name: /shelved project/i })
    expect(within(project).queryByRole('button')).not.toBeInTheDocument()
    expect(project).toHaveTextContent(/only an admin can restore/i)
    expect(screen.getByText(/projects you manage/i)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: /type/i }))
    expect(screen.queryByRole('option', { name: /people/i })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /restore cut milestone/i }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^restore$/i }))
    await waitFor(() => expect(restored).toBe('m7'))
  })

  test('lists every archived record with its type and who archived it, filterable by type', async () => {
    server.use(http.get(`${API}/archive`, () => HttpResponse.json({ items })))
    renderArchive()
    const table = await screen.findByRole('table', { name: /archived records/i })
    const row = (name) => screen.getByRole('row', { name: new RegExp(name, 'i') })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(row('gone project')).toHaveTextContent('Project')
    expect(row('gone project')).toHaveTextContent('Avery Admin')
    expect(row('dropped milestone')).toHaveTextContent('Apollo')
    expect(row('lee leaver')).toHaveTextContent('—')
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: /type/i }))
    await user.click(await screen.findByRole('option', { name: /people \(1\)/i }))
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(row('lee leaver')).toBeInTheDocument()
  })

  test('restore asks first, calls the type\'s restore endpoint and toasts', async () => {
    let restored = null
    let list = items
    server.use(http.get(`${API}/archive`, () => HttpResponse.json({ items: list })),
      http.post(`${API}/milestones/m9/restore`, () => { restored = 'm9'; list = items.filter((i) => i.id !== 'm9'); return HttpResponse.json({ id: 'm9' }) }))
    renderArchive()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /restore dropped milestone/i }))
    const dialog = await screen.findByRole('dialog', { name: /restore dropped milestone/i })
    expect(restored).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /^restore$/i }))
    await waitFor(() => expect(restored).toBe('m9'))
    expect(await screen.findByText('Restored Dropped Milestone')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('row', { name: /dropped milestone/i })).not.toBeInTheDocument())
  })

  test('a failed restore shows the server\'s message', async () => {
    server.use(http.get(`${API}/archive`, () => HttpResponse.json({ items })),
      http.post(`${API}/projects/p9/restore`, () => HttpResponse.json({ error: { code: 'CONFLICT',
        message: 'A project with this name already exists', request_id: 'r-9' } }, { status: 409 })))
    renderArchive()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /restore gone project/i }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^restore$/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't restore gone project/i)
    expect(alert).toHaveTextContent('A project with this name already exists')
    expect(alert).toHaveTextContent('r-9')
  })

  test('empty archive says so', async () => {
    server.use(http.get(`${API}/archive`, () => HttpResponse.json({ items: [] })))
    renderArchive()
    expect(await screen.findByText(/nothing is archived/i)).toBeInTheDocument()
  })

  test('only admins can open it or see it in navigation', () => {
    renderAsUser(<RequireAuth roles={['admin']}><ArchivePage /></RequireAuth>, { user: users.manager, route: '/archive', path: '/archive' })
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
  })

  test('Archive is in the admin and manager navigation, not the employee one', () => {
    const { unmount } = renderWithProviders(<Routes><Route path="*" element={<Layout user={users.admin} />} /></Routes>)
    expect(screen.getByRole('navigation', { name: /main/i })).toHaveTextContent('Archive')
    unmount()
    const again = renderWithProviders(<Routes><Route path="*" element={<Layout user={users.manager} />} /></Routes>)
    expect(screen.getByRole('navigation', { name: /main/i })).toHaveTextContent('Archive')
    again.unmount()
    renderWithProviders(<Routes><Route path="*" element={<Layout user={users.employee} />} /></Routes>)
    expect(screen.getByRole('navigation', { name: /main/i })).not.toHaveTextContent('Archive')
  })
})
