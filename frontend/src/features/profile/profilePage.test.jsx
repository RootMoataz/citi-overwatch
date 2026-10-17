import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setPrefersDark, setViewport } from '../../test/setup.js'
import { DEMO_DISABLED } from '../../lib/permissions.js'
import ProfilePage from './ProfilePage.jsx'

const ME = { id: 'u-emp', username: 'employee.demo', first_name: 'Eli', last_name: 'Employee', email: 'eli@acme.example',
  role: 'employee', job_title: 'Engineer', department_id: 'd1', salary: 104000 }

const MANAGER = { id: 'u-mgr', name: 'Morgan Manager', first_name: 'Morgan', job_title: 'Delivery Manager',
  department: { id: 'd1', name: 'Technology' }, is_archived: false }
const profileOf = (extra = {}) => ({ user: { id: 'u-emp', name: 'Eli Employee', manager: MANAGER }, this_week: {}, all_time: {},
  skills: [{ id: 's1', name: 'Backend Development' }, { id: 's2', name: 'Testing' }], can_edit_skills: false, projects: [], milestones: [], ...extra })

function serve(me = ME, profile = profileOf()) {
  const calls = { put: [], profile: [] }
  server.use(http.get(`${API}/me`, () => HttpResponse.json(me)),
    http.get(`${API}/users/:id/profile`, ({ params }) => {
      calls.profile.push(params.id)
      return profile instanceof Response ? profile : HttpResponse.json(profile)
    }),
    http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [{ id: 'u-mgr', name: 'Morgan Manager' }], can_group: false })),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd1', name: 'Technology', is_archived: false }] })),
    http.put(`${API}/me`, async ({ request }) => { const body = await request.json(); calls.put.push(body); return HttpResponse.json({ ...me, ...body }) }))
  return calls
}
const open = (user = users.employee) => renderAsUser(<ProfilePage />, { user, route: '/profile', path: '/profile' })

describe('My profile', () => {
  test('header copy and the profile card', async () => {
    serve()
    open()
    expect(await screen.findByRole('heading', { name: 'My profile', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('You can change your name and email. An admin manages everything else.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Eli Employee', level: 2 })).toBeInTheDocument()
    expect(screen.getAllByText('Engineer')).toHaveLength(2)
    expect(await screen.findByText('Employee · Technology')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your details', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account', level: 2 })).toBeInTheDocument()
  })

  test('Profile photo opens the photo dialog', async () => {
    serve()
    open()
    await userEvent.click(await screen.findByRole('button', { name: /^profile photo$/i }))
    expect(await screen.findByRole('dialog', { name: /profile photo/i })).toBeInTheDocument()
  })

  test('the demo admin cannot change the photo or save', async () => {
    serve({ ...ME, ...users.demoAdmin, email: 'demo.admin@acme.example' })
    open(users.demoAdmin)
    const photo = await screen.findByRole('button', { name: /^profile photo$/i })
    expect(photo).toBeDisabled()
    await userEvent.hover(photo.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(DEMO_DISABLED)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  test('Save sends the trimmed name and email once and confirms', async () => {
    const calls = serve()
    open()
    const user = userEvent.setup()
    const first = await screen.findByLabelText(/first name/i)
    await user.clear(first)
    await user.type(first, '  Elias ')
    const last = screen.getByLabelText(/last name/i)
    await user.clear(last)
    await user.type(last, 'Ember')
    const email = screen.getByLabelText(/email/i)
    await user.clear(email)
    await user.type(email, ' elias@acme.example ')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(calls.put).toEqual([{ first_name: 'Elias', last_name: 'Ember', email: 'elias@acme.example' }]))
    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
  })

  test('an invalid email is explained and blocks Save', async () => {
    const calls = serve()
    open()
    const user = userEvent.setup()
    const email = await screen.findByLabelText(/email/i)
    await user.clear(email)
    await user.type(email, 'nope')
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(calls.put).toHaveLength(0)
  })

  test('the salary appears only after Employment details is opened', async () => {
    serve()
    open()
    const user = userEvent.setup()
    const toggle = await screen.findByRole('button', { name: /employment details/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('$104,000')).not.toBeInTheDocument()
    expect(screen.queryByText('Annual salary')).not.toBeInTheDocument()
    await user.click(toggle)
    expect(await screen.findByText('Annual salary')).toBeInTheDocument()
    expect(screen.getByText('$104,000')).toBeInTheDocument()
  })

  test('with no salary there is no Employment details', async () => {
    const { salary: _salary, ...noSalary } = ME
    serve(noSalary)
    open()
    await screen.findByRole('heading', { name: 'Account' })
    expect(screen.queryByRole('button', { name: /employment details/i })).not.toBeInTheDocument()
  })

  test('the Account card lists username, role and job title read-only', async () => {
    serve()
    open()
    const account = (await screen.findByRole('heading', { name: 'Account' })).closest('div[class*="MuiPaper"]')
    expect(within(account).getByText('employee.demo')).toBeInTheDocument()
    expect(within(account).getByText('Username')).toBeInTheDocument()
    expect(within(account).getByText('Job title')).toBeInTheDocument()
    expect(within(account).queryByRole('textbox')).not.toBeInTheDocument()
  })

  test('phones: profile card, Your details, then Account', async () => {
    setViewport(375)
    serve()
    open()
    const name = await screen.findByRole('heading', { name: 'Eli Employee', level: 2 })
    const details = screen.getByRole('heading', { name: 'Your details' })
    const account = screen.getByRole('heading', { name: 'Account' })
    expect(name.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(details.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('dark mode renders the headings without a console error', async () => {
    setPrefersDark(true)
    const errors = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a) })
    serve()
    open()
    expect(await screen.findByRole('heading', { name: 'My profile', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Your details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    spy.mockRestore()
    expect(errors).toEqual([])
  })

  test('Your manager and Skills sit under the profile card, from the viewer own profile', async () => {
    const calls = serve()
    open()
    const manager = (await screen.findByRole('heading', { name: 'Your manager', level: 2 })).closest('section')
    expect(within(manager).getByText('Morgan Manager')).toBeInTheDocument()
    expect(await within(manager).findByRole('link', { name: 'Message Morgan' })).toBeInTheDocument()
    const skills = screen.getByRole('region', { name: 'Skills' })
    expect(within(skills).getByRole('heading', { name: 'Skills', level: 2 })).toBeInTheDocument()
    expect(within(skills).getByText('Backend Development')).toBeInTheDocument()
    expect(within(skills).getByText('Testing')).toBeInTheDocument()
    expect(within(skills).queryByRole('button', { name: /edit skills/i })).not.toBeInTheDocument()
    expect(new Set(calls.profile)).toEqual(new Set(['u-emp']))
  })

  test('Your manager and Skills are spaced one way: side by side in one column, its gap between them, no margin of their own', async () => {
    serve()
    open()
    const manager = (await screen.findByRole('heading', { name: 'Your manager', level: 2 })).closest('section')
    const skills = screen.getByRole('region', { name: 'Skills' })
    // Skills sits right in the column that holds Your manager (no wrapper overriding its margin), with none of its own.
    expect(skills.parentElement).toContainElement(manager)
    expect(skills).toHaveStyle({ marginBottom: '0px' })
  })

  test('in the narrow column, Message Morgan sits under the name and job, full width', async () => {
    serve()
    open()
    const manager = (await screen.findByRole('heading', { name: 'Your manager', level: 2 })).closest('section')
    const message = await within(manager).findByRole('link', { name: 'Message Morgan' })
    expect(message.parentElement).toHaveStyle({ flexDirection: 'column' })
    expect(message).toHaveClass('MuiButton-fullWidth')
  })

  test('the header action My history is an outlined button with the My history icon; cards pad 16 px like the rest', async () => {
    serve()
    open()
    const history = await screen.findByRole('link', { name: 'My history' })
    expect(history).toHaveClass('MuiButton-outlined')
    expect(history.querySelector('svg[data-testid="ManageHistoryOutlinedIcon"]')).not.toBeNull()
    const details = screen.getByRole('heading', { name: 'Your details', level: 2 }).parentElement
    expect(details).toHaveStyle({ padding: '16px' })
  })

  test('no Your manager card when there is no manager', async () => {
    serve(ME, profileOf({ user: { id: 'u-emp', name: 'Eli Employee', manager: null } }))
    open()
    await screen.findByRole('region', { name: 'Skills' })
    expect(screen.queryByRole('heading', { name: 'Your manager' })).not.toBeInTheDocument()
  })

  test('Edit skills appears only when the profile allows it', async () => {
    serve(ME, profileOf({ can_edit_skills: true }))
    open()
    expect(await screen.findByRole('button', { name: /edit skills/i })).toBeEnabled()
  })

  test('the demo admin sees Edit skills locked', async () => {
    serve({ ...ME, ...users.demoAdmin, email: 'demo.admin@acme.example' }, profileOf({ can_edit_skills: true }))
    open(users.demoAdmin)
    const edit = await screen.findByRole('button', { name: /edit skills/i })
    expect(edit).toBeDisabled()
    await userEvent.hover(edit.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(DEMO_DISABLED)
  })

  test('if the profile fails both cards offer a retry and the rest of the page still saves', async () => {
    const calls = serve(ME, HttpResponse.json({ error: 'boom' }, { status: 500 }))
    open()
    const user = userEvent.setup()
    expect(await screen.findAllByRole('button', { name: /retry|try again/i })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument()
    const first = screen.getByLabelText(/first name/i)
    await user.clear(first)
    await user.type(first, 'Elias')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(calls.put).toHaveLength(1))
  })

  test('phones: profile card, Your details, Account, Your manager, then Skills', async () => {
    setViewport(375)
    serve()
    open()
    const order = [await screen.findByRole('heading', { name: 'Eli Employee', level: 2 }), screen.getByRole('heading', { name: 'Your details' }),
      screen.getByRole('heading', { name: 'Account' }), await screen.findByRole('heading', { name: 'Your manager', level: 2 }),
      await screen.findByRole('heading', { name: 'Skills', level: 2 })]
    order.slice(1).forEach((h, i) => expect(order[i].compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy())
  })
})
