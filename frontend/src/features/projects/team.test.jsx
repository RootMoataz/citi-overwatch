import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import { buildTheme } from '../../app/theme.js'
import TeamTab from './TeamTab.jsx'
import { projectView } from './viewer.js'

const project = { id: 'p1', name: 'Apollo Data Migration', status: 'active', start_date: '2026-01-01',
  predicted_end_date: '2026-12-31', is_archived: false, manager: { id: users.manager.id, name: 'Morgan Manager' } }

const person = (id, first, last, title, hours, skills = []) => ({
  user: { id, first_name: first, last_name: last, job_title: title, username: id,
    skills: skills.map((name) => ({ id: `s-${name}`, name })) }, planned_hours_per_week: hours })
// Five people, 115h in all; the employee viewer is one of them. Stored out of last-name order on purpose.
const members = [
  person('u-ada', 'Ada', 'Lovelace', 'Analyst', 30, ['SQL', 'Python']),
  person('u-bo', 'Bo', 'Peep', 'Engineer', 20, ['Rust']),
  person('u-cy', 'Cy', 'Young', 'Designer', 25, ['Figma']),
  person('u-dee', 'Dee', 'Adams', 'Tester', 15),
  person(users.employee.id, 'Eli', 'Employee', 'Developer', 25),
]
const contacts = ['u-ada', 'u-bo', 'u-cy', 'u-dee', users.manager.id].map((id) => ({ id }))
const contactsHandler = (ids = contacts) => http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: ids, can_group: false }))

function render(user, extra = []) {
  server.use(
    ...extra,   // first, so a test's own handler wins over these defaults
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json(members)),
    contactsHandler(),
    http.get(`${API}/users`, () => HttpResponse.json({ items: [
      { id: 'u-new', username: 'new', first_name: 'Nia', last_name: 'Newhire', job_title: 'Engineer' }], total: 1 })))
  const view = projectView(user, project)
  return renderAsUser(<TeamTab project={project} manage={view.manage} user={user} view={view} />, { user, route: '/team-under-test' })
}

describe('TeamTab', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T16:00:00Z')) })
  afterEach(() => vi.useRealTimers())

  test('summarises the team and its planned hours, with Add member only for a manager', async () => {
    render(users.manager)
    expect(await screen.findByRole('heading', { name: '5 team members' })).toBeInTheDocument()
    expect(screen.getByText('On this project · 115h planned per week')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument()
  })

  test('the cap error still shows its message', async () => {
    render(users.manager, [http.post(`${API}/projects/p1/members`, () => HttpResponse.json({ error: { code: 'PLANNED_HOURS_EXCEEDED',
      message: 'x', details: { current_total: 30, requested: 12, cap: 40 } } }, { status: 400 }))])
    vi.useRealTimers()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: /add a team member/i })
    await user.click(within(dialog).getByRole('combobox', { name: /person/i }))
    await user.click(await screen.findByRole('option', { name: /nia newhire/i }))
    await user.clear(within(dialog).getByLabelText(/planned hours/i))
    await user.type(within(dialog).getByLabelText(/planned hours/i), '12')
    await user.click(within(dialog).getByRole('button', { name: /^add$/i }))
    expect(await within(dialog).findByText('Nia Newhire is already planned for 30h of 40h per week.')).toBeInTheDocument()
  }, 15000)

  test('search matches name, job title and skill', async () => {
    render(users.manager)
    vi.useRealTimers()
    const user = userEvent.setup()
    const table = await screen.findByRole('table', { name: /team members/i })
    const search = screen.getByRole('textbox', { name: 'Search team members' })
    expect(search).toHaveAttribute('placeholder', 'Search team members…')
    await user.type(search, 'peep')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    await user.clear(search)
    await user.type(search, 'designer')
    expect(within(table).getByText('Cy Young')).toBeInTheDocument()
    expect(within(table).queryByText('Bo Peep')).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'sql')
    expect(within(table).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(table).queryByText('Cy Young')).not.toBeInTheDocument()
  })

  test('rows are ordered by last name and show avatar, name, title, skills and hours; the manager opens a profile', async () => {
    render(users.manager)
    const table = await screen.findByRole('table', { name: /team members/i })
    await screen.findByText('Ada Lovelace')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      expect.stringContaining('Dee Adams'), expect.stringContaining('Eli Employee'), expect.stringContaining('Ada Lovelace'),
      expect.stringContaining('Bo Peep'), expect.stringContaining('Cy Young')])
    const ada = rows[2]
    expect(within(ada).getByText('AL')).toBeInTheDocument()
    expect(within(ada).getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
    expect(within(ada).getByText('Analyst')).toBeInTheDocument()
    expect(within(ada).getByText('SQL')).toBeInTheDocument()
    expect(within(ada).getByText('30h')).toBeInTheDocument()
    // A number column: right-aligned, in tabular figures.
    expect(within(table).getByRole('columnheader', { name: 'Planned / week' })).toHaveStyle({ textAlign: 'right' })
    expect(within(ada).getByText('30h').closest('td')).toHaveStyle({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' })
  })

  test('Message follows the contact list: none for yourself, none for someone outside it', async () => {
    render(users.employee, [contactsHandler([{ id: 'u-ada' }, { id: users.employee.id }])])
    const table = await screen.findByRole('table', { name: /team members/i })
    expect(await within(table).findByRole('link', { name: 'Message Ada Lovelace' })).toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: 'Message Bo Peep' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: 'Message Eli Employee' })).not.toBeInTheDocument()
  })

  test('the manager edits planned hours or removes someone after a confirmation', async () => {
    let deleted = null
    render(users.manager, [http.delete(`${API}/projects/p1/members/u-ada`, () => { deleted = 'u-ada'; return new HttpResponse(null, { status: 204 }) })])
    vi.useRealTimers()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'More actions for Ada Lovelace' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit planned hours' }))
    const edit = await screen.findByRole('dialog', { name: 'Planned hours for Ada Lovelace' })
    await user.click(within(edit).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'More actions for Ada Lovelace' }))
    const remove = screen.getByRole('menuitem', { name: 'Remove from project' })
    expect(remove).toHaveStyle({ color: buildTheme('light').palette.error.main })   // a destructive item, in the error colour
    expect(screen.getByRole('menuitem', { name: 'Edit planned hours' })).not.toHaveStyle({ color: buildTheme('light').palette.error.main })
    await user.click(remove)
    const confirm = await screen.findByRole('dialog', { name: 'Remove Ada Lovelace from Apollo Data Migration?' })
    expect(within(confirm).getByText("They're also taken off its milestones.")).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleted).toBe('u-ada'))
  }, 15000)

  test('an employee sees a read-only team with a You tag', async () => {
    render(users.employee)
    const table = await screen.findByRole('table', { name: /team members/i })
    await within(table).findByText('Ada Lovelace')
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more actions for/i })).not.toBeInTheDocument()
    const mine = within(table).getByRole('rowheader', { name: /Eli Employee/ }).closest('tr')
    expect(within(mine).getByText('You')).toBeInTheDocument()
    expect(within(table).getAllByText('You')).toHaveLength(1)
    expect(within(table).queryByRole('link', { name: 'Ada Lovelace' })).not.toBeInTheDocument()   // a teammate: plain text
  })

  test('an executive reads the team and can message', async () => {
    render(users.executive)
    const table = await screen.findByRole('table', { name: /team members/i })
    expect(await within(table).findByRole('link', { name: 'Message Ada Lovelace' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more actions for/i })).not.toBeInTheDocument()
  })

  test('the footer says what planned hours are, as of the New York date', async () => {
    render(users.manager)
    await screen.findByText('Ada Lovelace')
    expect(screen.getByText(/Planned hours are project allocations, not hours already worked\./)).toBeInTheDocument()
    expect(screen.getByText('As of Oct 15, 2026')).toBeInTheDocument()
  })

  test('an empty team says so, and a manager can add the first person', async () => {
    render(users.manager, [http.get(`${API}/projects/p1/members`, () => HttpResponse.json([]))])
    expect(await screen.findByText('Nobody on this project yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument()
  })

  test('on a phone the rows are cards, with the managers menu beside each', async () => {
    setViewport(375)
    render(users.manager)
    const list = await screen.findByRole('list', { name: /team members/i })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(await within(list).findByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(list).getAllByRole('button', { name: /more actions for/i })).toHaveLength(5)
    expect(within(list).getByRole('button', { name: 'More actions for Ada Lovelace' })).toBeInTheDocument()
  })
})
