import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import NotificationBell from '../../components/NotificationBell.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import PersonProfilePage from '../people/PersonProfilePage.jsx'
import SkillsPage from './SkillsPage.jsx'

const qa = { id: 's1', name: 'QA' }
const be = { id: 's2', name: 'Backend Development' }

const profile = (overrides) => ({
  user: { id: 'u-ada', name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace', job_title: 'Analyst', role: 'employee',
    is_archived: false, manager: null },
  this_week: { week_start: '2026-10-12', logged: 10, overtime: 0, planned: 20 },
  all_time: { logged: 10, approved: 5 }, projects: [], milestones: [], skills: [qa], can_edit_skills: false,
  ...overrides,
})

describe('skills', () => {
  test('a profile shows skills; an allowed manager edits them', async () => {
    const saved = []
    let current = profile({ can_edit_skills: true })
    server.use(
      http.get(`${API}/users/u-ada/profile`, () => HttpResponse.json(current)),
      http.get(`${API}/skills`, () => HttpResponse.json({ items: [be, qa] })),
      http.put(`${API}/users/u-ada/skills`, async ({ request }) => {
        const body = await request.json()
        saved.push(body)
        current = profile({ can_edit_skills: true, skills: [be, qa] })
        return HttpResponse.json({ items: [be, qa], can_edit: true })
      }),
    )
    renderAsUser(<PersonProfilePage />, { user: users.manager, route: '/people/u-ada/profile', path: '/people/:id/profile' })
    const card = await screen.findByRole('region', { name: 'Skills' })
    expect(within(card).getByText('QA')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /edit skills/i }))
    const dialog = await screen.findByRole('dialog', { name: /skills of ada lovelace/i })
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Skills' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Backend Development' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toEqual([{ skill_ids: ['s1', 's2'] }]))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Skills' })).getByText('Backend Development'))
      .toBeInTheDocument())
  }, 15000)

  test('people who may not edit only see the chips', async () => {
    server.use(http.get(`${API}/users/u-ada/profile`, () => HttpResponse.json(profile({ skills: [] }))))
    renderAsUser(<PersonProfilePage />, { user: users.employee, route: '/people/u-ada/profile', path: '/people/:id/profile' })
    const card = await screen.findByRole('region', { name: 'Skills' })
    expect(within(card).getByText('No skills recorded yet.')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /edit skills/i })).not.toBeInTheDocument()
  })

  test('admins add and archive catalogue skills', async () => {
    const created = []
    const archived = []
    server.use(
      http.get(`${API}/skills`, () => HttpResponse.json({ items: [{ ...qa, is_archived: false, user_count: 2, milestone_count: 1 }] })),
      http.post(`${API}/skills`, async ({ request }) => {
        const body = await request.json()
        created.push(body)
        if (body.name === 'QA') {
          return HttpResponse.json({ error: { code: 'CONFLICT', message: 'That name is already taken', details: { name: 'taken' } } },
            { status: 409 })
        }
        return HttpResponse.json({ id: 's9', name: body.name, is_archived: false, user_count: 0, milestone_count: 0 }, { status: 201 })
      }),
      http.delete(`${API}/skills/s1`, () => { archived.push('s1'); return new HttpResponse(null, { status: 204 }) }),
    )
    renderAsUser(<SkillsPage />, { user: users.admin, route: '/skills' })
    const table = await screen.findByRole('table', { name: 'Skills' })
    expect(within(table).getByText('QA')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'New skill' }), 'QA')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('A skill with this name already exists')).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: 'New skill' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New skill' }), 'Security')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(created.at(-1)).toEqual({ name: 'Security' }))
    await userEvent.click(within(table).getByRole('button', { name: 'Archive QA' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(archived).toEqual(['s1']))
  }, 15000)
})

describe('workflow alerts', () => {
  const alert = (type, payload, message) => ({ id: `n-${type}`, type, week_start: null, read_at: null, payload, message,
    subject_user: { id: users.employee.id, name: 'Eli Employee' } })
  const payload = { milestone: { id: 'm9', name: 'Cutover' }, project: { id: 'p1', name: 'Apollo' } }

  test.each([
    ['AUTO_ROUTED', 'Open the milestone to reassign it if needed'],
    ['KICKBACK_RAISED', 'Review the kickback'],
    ['NO_QUALIFIED_PERSON', 'Open the milestone to assign someone'],
    ['MILESTONE_UPDATE', 'Open the work log'],
  ])('%s links straight to the milestone', async (type, hint) => {
    server.use(
      http.get(`${API}/notifications`, () => HttpResponse.json([alert(type, payload, `${type} message`)])),
      http.post(`${API}/notifications/n-${type}/read`, () => HttpResponse.json({ read: true })),
    )
    renderAsUser(<NotificationBell />, { user: users.manager, route: '/', path: '/' })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const item = await screen.findByRole('menuitem', { name: new RegExp(`${type} message`) })
    expect(within(item).getByText(hint)).toBeInTheDocument()
    await userEvent.click(item)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects/p1?tab=milestones&milestone=m9'))
  })
})
