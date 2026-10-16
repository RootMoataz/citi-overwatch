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

function serve(me = ME) {
  const calls = { put: [] }
  server.use(http.get(`${API}/me`, () => HttpResponse.json(me)),
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
})
