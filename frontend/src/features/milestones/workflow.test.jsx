import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import MilestonesTab from './MilestonesTab.jsx'

const project = {
  id: 'p1', name: 'Apollo', start_date: '2026-01-01', predicted_end_date: '2026-12-31', status: 'active',
  manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [],
}
const me = { id: users.employee.id, name: 'Eli Employee' }
const qa = { id: 's1', name: 'QA' }

const ms = (overrides) => ({
  project_id: 'p1', description: '', status: 'in_progress', display_status: 'in_progress', blocked: false,
  predecessors: [], assignees: [me], is_assignee: true, completed_at: null, is_archived: false, difficulty: 'medium',
  priority: 'medium', objective: '', completion_criteria: '', required_skills: [], progress_percent: null,
  open_kickback: null, can_post_update: true, can_kick_back: true, can_resolve_kickback: false,
  start_date: '2026-03-01', end_date: '2026-06-30',
  ...overrides,
})

const mapping = ms({ id: 'm2', name: 'Schema Mapping', objective: 'Map every legacy field',
  completion_criteria: 'Customer tables mapped\nAddresses split', required_skills: [qa], progress_percent: 40 })

const kickback = {
  id: 'k1', category: 'unclear_requirement', category_label: 'Unclear requirement',
  reason: 'The address format is not specified anywhere.', raised_at: new Date().toISOString(),
  raised_by: me, resolution: null, resolution_note: null, resolved_at: null, resolved_by: null,
}

function handlers(list, extra = []) {
  return [
    ...extra,
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json(list)),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([])),
    http.get(`${API}/milestones/:id/notes`, () => HttpResponse.json([])),
    http.get(`${API}/approvals`, () => HttpResponse.json([])),
    http.get(`${API}/skills`, () => HttpResponse.json({ items: [qa] })),
  ]
}

const renderTab = (user, manage, route = '/milestones-under-test') =>
  renderAsUser(<MilestonesTab project={project} manage={manage} />, { user, route })
const card = async (name) => (await screen.findByRole('heading', { name, level: 3 })).closest('[data-milestone]')

describe('milestone workflow', () => {
  test('the card shows the objective and progress; Details lists the criteria and skills', async () => {
    server.use(...handlers([mapping]))
    renderTab(users.employee, false)
    const c = await card('Schema Mapping')
    expect(within(c).getByText('Map every legacy field')).toBeInTheDocument()
    expect(within(c).getByRole('progressbar', { name: /40% complete/i })).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: /details for schema mapping/i }))
    const criteria = await within(c).findByRole('list', { name: /completion criteria/i })
    expect(within(criteria).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Customer tables mapped', 'Addresses split'])
    expect(within(within(c).getByRole('list', { name: /skills needed/i })).getByText('QA')).toBeInTheDocument()
  })

  test('an assignee posts a progress update with a percent and sees it on the timeline', async () => {
    const posted = []
    let updates = []
    server.use(...handlers([mapping], [
      http.get(`${API}/milestones/m2/updates`, () => HttpResponse.json(updates)),
      http.post(`${API}/milestones/m2/updates`, async ({ request }) => {
        const body = await request.json()
        posted.push(body)
        updates = [{ id: 'u1', body: body.body, percent_complete: body.percent_complete, created_at: new Date().toISOString(),
          author: { ...me, avatar_url: null } }]
        return HttpResponse.json(updates[0], { status: 201 })
      }),
    ]))
    renderTab(users.employee, false)
    const c = await card('Schema Mapping')
    await userEvent.click(within(c).getByRole('button', { name: /work log for schema mapping/i }))
    expect(await within(c).findByText('No updates yet.')).toBeInTheDocument()
    await userEvent.type(within(c).getByRole('textbox', { name: /percent complete/i }), '150')
    await userEvent.type(within(c).getByRole('textbox', { name: /post a progress update/i }), 'Tables done')
    await userEvent.click(within(c).getByRole('button', { name: /post update/i }))
    expect(within(c).getByText('A whole number from 0 to 100')).toBeInTheDocument()
    expect(posted).toEqual([])
    await userEvent.clear(within(c).getByRole('textbox', { name: /percent complete/i }))
    await userEvent.type(within(c).getByRole('textbox', { name: /percent complete/i }), '55')
    await userEvent.click(within(c).getByRole('button', { name: /post update/i }))
    await waitFor(() => expect(posted).toEqual([{ body: 'Tables done', percent_complete: 55 }]))
    const timeline = await within(c).findByRole('list', { name: /progress updates/i })
    expect(within(timeline).getByText('Tables done')).toBeInTheDocument()
    expect(within(timeline).getByRole('progressbar', { name: '55% complete' })).toBeInTheDocument()
  })

  test('people who may not post only read the work log', async () => {
    server.use(...handlers([ms({ id: 'm3', name: 'Cutover', can_post_update: false, can_kick_back: false, is_assignee: false,
      assignees: [] })], [http.get(`${API}/milestones/m3/updates`, () => HttpResponse.json([]))]))
    renderTab(users.employee, false)
    const c = await card('Cutover')
    expect(within(c).queryByRole('button', { name: /kick back/i })).not.toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: /work log for cutover/i }))
    expect(await within(c).findByText('No updates yet.')).toBeInTheDocument()
    expect(within(c).queryByRole('textbox', { name: /post a progress update/i })).not.toBeInTheDocument()
  })

  test('an assignee kicks a milestone back with a category and a real reason', async () => {
    const sent = []
    server.use(...handlers([mapping], [
      http.post(`${API}/milestones/m2/kickback`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json(kickback, { status: 201 })
      }),
    ]))
    renderTab(users.employee, false)
    const c = await card('Schema Mapping')
    await userEvent.click(within(c).getByRole('button', { name: /kick back/i }))
    const dialog = await screen.findByRole('dialog', { name: /kick back schema mapping/i })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /what's wrong/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Unclear requirement' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: /explain/i }), 'Too short')
    await userEvent.click(within(dialog).getByRole('button', { name: /^kick back$/i }))
    expect(within(dialog).getByText('Explain in at least 10 characters')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /explain/i }), ', see doc')
    await userEvent.click(within(dialog).getByRole('button', { name: /^kick back$/i }))
    await waitFor(() => expect(sent).toEqual([{ category: 'unclear_requirement',
      reason: 'Too short, see doc' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }, 15000)

  test('everyone sees why a blocked milestone was kicked back; only the reviewer gets the actions', async () => {
    const blocked = ms({ id: 'm2', name: 'Schema Mapping', status: 'blocked', display_status: 'blocked',
      open_kickback: kickback, can_kick_back: false })
    server.use(...handlers([blocked]))
    renderTab(users.employee, false)
    const c = await card('Schema Mapping')
    expect(within(c).getByText('Blocked – needs review')).toBeInTheDocument()
    const panel = within(c).getByRole('alert', { name: /kickback on schema mapping/i })
    expect(panel).toHaveTextContent('Kicked back: Unclear requirement')
    expect(panel).toHaveTextContent('The address format is not specified anywhere.')
    expect(within(panel).queryByRole('button', { name: /return to employee/i })).not.toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: /^start$|ready for review/i })).not.toBeInTheDocument()
  })

  test('the manager replies with instructions and returns it to the employee', async () => {
    const sent = []
    const blocked = ms({ id: 'm2', name: 'Schema Mapping', status: 'blocked', display_status: 'blocked',
      open_kickback: kickback, can_kick_back: false, can_resolve_kickback: true, is_assignee: false })
    server.use(...handlers([blocked], [
      http.post(`${API}/milestones/m2/kickback/resolve`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ ...kickback, resolution: 'returned' })
      }),
    ]))
    renderTab(users.manager, true)
    const c = await card('Schema Mapping')
    const panel = within(c).getByRole('alert', { name: /kickback on schema mapping/i })
    await userEvent.click(within(panel).getByRole('button', { name: /return to employee/i }))
    expect(within(panel).getByText('Write your instructions or decision first')).toBeInTheDocument()
    await userEvent.type(within(panel).getByRole('textbox', { name: /reply with instructions/i }), 'Use street, city, postcode.')
    await userEvent.click(within(panel).getByRole('button', { name: /return to employee/i }))
    await waitFor(() => expect(sent).toEqual([{ resolution: 'returned', note: 'Use street, city, postcode.' }]))
    expect(within(panel).getByRole('button', { name: /edit or reassign/i })).toBeInTheDocument()
  })

  test('History shows kickbacks with their resolution and the audit events', async () => {
    const resolved = { ...kickback, resolution: 'returned', resolution_note: 'Split the fields.',
      resolved_at: new Date().toISOString(), resolved_by: { id: users.manager.id, name: 'Morgan Manager' } }
    server.use(...handlers([mapping], [http.get(`${API}/milestones/m2/history`, () => HttpResponse.json({
      kickbacks: [resolved],
      events: [{ id: 'e1', created_at: new Date().toISOString(), action: 'auto_assign',
        sentence: 'Morgan Manager auto-assigned Eli Employee to Schema Mapping after Discovery was completed' }],
    }))]))
    renderTab(users.employee, false)
    const c = await card('Schema Mapping')
    await userEvent.click(within(c).getByRole('button', { name: /history for schema mapping/i }))
    const list = await within(c).findByRole('list', { name: 'Kickbacks' })
    expect(list).toHaveTextContent('Returned to the team')
    expect(list).toHaveTextContent('Split the fields.')
    expect(within(c).getByRole('list', { name: 'Events' })).toHaveTextContent(/auto-assigned Eli Employee/)
  })

  test('a link to one milestone opens its details', async () => {
    server.use(...handlers([ms({ id: 'm1', name: 'Discovery' }), mapping]))
    renderTab(users.employee, false, '/milestones-under-test?milestone=m2')
    const c = await card('Schema Mapping')
    expect(within(c).getByRole('button', { name: /details for schema mapping/i })).toHaveAttribute('aria-expanded', 'true')
    const other = await card('Discovery')
    expect(within(other).getByRole('button', { name: /details for discovery/i })).toHaveAttribute('aria-expanded', 'false')
  })

  test('the manager edits the objective, criteria and skills needed', async () => {
    const sent = []
    server.use(...handlers([mapping], [
      http.put(`${API}/milestones/m2`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json(mapping)
      }),
    ]))
    renderTab(users.manager, true)
    const c = await card('Schema Mapping')
    await userEvent.click(within(c).getByRole('button', { name: /edit schema mapping/i }))
    const dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    const objective = within(dialog).getByRole('textbox', { name: 'Objective' })
    expect(objective).toHaveValue('Map every legacy field')
    await userEvent.clear(objective)
    await userEvent.type(objective, 'Map it all')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /skills needed/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'QA' }))  // untick the only skill
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent).toEqual([{ objective: 'Map it all', required_skill_ids: [] }]))
  }, 15000)
})
