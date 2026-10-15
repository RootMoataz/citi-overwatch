import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EMAILJS_URL } from '../../lib/emailRelay.js'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import EmailReportButton from './EmailReportButton.jsx'

const dashboard = {
  at_risk: [{ id: 'p1', name: 'Apollo <i>x</i>', reasons: ['PAST_DUE'] }], milestones: { overdue: [], due_soon: [] },
  pending_approvals: 2, budgets: [{ project_id: 'p1', name: 'Apollo <i>x</i>', budget: 1000, consumed: 500, forecast: 900 }],
}

function configure() {
  vi.stubEnv('VITE_EMAILJS_SERVICE_ID', 'svc_test')
  vi.stubEnv('VITE_EMAILJS_PUBLIC_KEY', 'pk_test')
  vi.stubEnv('VITE_EMAILJS_REPORT_TEMPLATE_ID', 'tpl_report')
}

function serveData(seen = [], me = { email: 'eve@acme.example' }) {
  server.use(
    http.get(`${API}/me`, () => HttpResponse.json({ ...users.executive, ...me })),
    http.get(`${API}/insights/smart`, ({ request }) => {
      seen.push(Object.fromEntries(new URL(request.url).searchParams))
      return HttpResponse.json([{ title: 'Apollo is late', detail: 'Past its end date', severity: 'high', link: { to: 'project', id: 'p1' } }])
    }),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd1', name: 'Technology', is_archived: false }] })),
  )
}

describe('Email this report', () => {
  afterEach(() => vi.unstubAllEnvs())

  test('explains instead of failing when email is not configured', async () => {
    serveData()
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.manager })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    expect(await screen.findByRole('dialog', { name: "Email isn't set up yet" })).toHaveTextContent(/VITE_EMAILJS_REPORT_TEMPLATE_ID/)
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('?report=email (from Puppy) opens the dialog with "Send to me" on, and sends nothing until Send', async () => {
    configure()
    serveData()
    let sent = 0
    server.use(http.post(EMAILJS_URL, () => { sent += 1; return new HttpResponse('OK') }))
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.manager, route: '/?report=email' })
    await screen.findByRole('dialog', { name: 'Email this report' })
    expect(await screen.findByRole('checkbox', { name: /send to me/i })).toBeChecked()
    expect(sent).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  test('"Send to me" is on at first and fills in the viewer, so one click sends it to them', async () => {
    configure()
    const seen = []
    serveData(seen)
    const bodies = []
    server.use(http.post(EMAILJS_URL, async ({ request }) => { bodies.push(await request.json()); return new HttpResponse('OK') }))
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} department="d1" />, { user: users.executive })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    const dialog = await screen.findByRole('dialog', { name: 'Email this report' })
    expect(await screen.findByRole('checkbox', { name: 'Send to me (eve@acme.example)' })).toBeChecked()
    expect(screen.getByLabelText(/subject/i).value).toMatch(/^Scout delivery report — /)
    expect(dialog.querySelector('iframe[title="Report preview"]')).toHaveAttribute('sandbox', '')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].template_id).toBe('tpl_report')
    expect(bodies[0].template_params).toMatchObject({ to_email: 'eve@acme.example', to_name: 'Eve Executive',
      from_name: 'Eve Executive', app_url: window.location.origin })
    const html = bodies[0].template_params.report_html
    expect(html).toContain('Apollo &lt;i&gt;x&lt;/i&gt;')
    expect(html).not.toContain('<i>x</i>')
    expect(html).toContain('Technology')
    expect(html).toContain('Apollo is late')
    expect(seen[0]).toMatchObject({ department: 'd1' })
    expect(await screen.findByText('Report sent to eve@acme.example')).toBeInTheDocument()
  })

  test('to me and someone else: two sends, one per recipient', async () => {
    configure()
    serveData()
    const bodies = []
    server.use(http.post(EMAILJS_URL, async ({ request }) => { bodies.push(await request.json()); return new HttpResponse('OK') }))
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.manager })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    await screen.findByRole('checkbox', { name: /send to me \(eve@acme.example\)/i })
    await user.type(screen.getByLabelText(/also send to/i), 'cfo@acme.example')
    await user.type(screen.getByLabelText(/recipient name/i), 'Casey CFO')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies.map((b) => [b.template_params.to_email, b.template_params.to_name]).sort())
      .toEqual([['cfo@acme.example', 'Casey CFO'], ['eve@acme.example', 'Morgan Manager']])
    expect(await screen.findByText('Report sent to eve@acme.example and cfo@acme.example')).toBeInTheDocument()
  })

  test('an invalid address is blocked, and someone is needed once "Send to me" is off', async () => {
    configure()
    serveData()
    let calls = 0
    server.use(http.post(EMAILJS_URL, () => { calls += 1; return new HttpResponse('OK') }))
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.admin })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    const toMe = await screen.findByRole('checkbox', { name: /send to me \(/i })
    await user.type(screen.getByLabelText(/also send to/i), 'not-an-email')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/enter an email address like/i)).toBeInTheDocument()
    await user.click(toMe)
    await user.clear(screen.getByLabelText(/recipient email/i))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/enter who should get the report/i)).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  test('without an email on file "Send to me" is off and says why', async () => {
    configure()
    serveData([], { email: '' })
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.manager })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    expect(await screen.findByText(/add an email in your profile/i)).toBeInTheDocument()
    const box = screen.getByRole('checkbox', { name: 'Send to me' })
    expect(box).toBeDisabled()
    expect(box).not.toBeChecked()
    expect(screen.getByLabelText(/recipient email/i)).toBeRequired()
  })

  test('reports each recipient when one send fails', async () => {
    configure()
    serveData()
    server.use(http.post(EMAILJS_URL, async ({ request }) => ((await request.json()).template_params.to_email === 'bad@acme.example'
      ? new HttpResponse('bad', { status: 400 }) : new HttpResponse('OK'))))
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.admin })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    await screen.findByRole('checkbox', { name: /send to me \(/i })
    await user.type(screen.getByLabelText(/also send to/i), 'bad@acme.example')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const list = await screen.findByRole('list', { name: 'Delivery results' })
    expect(list).toHaveTextContent('Sent to eve@acme.example')
    expect(list).toHaveTextContent('Not sent to bad@acme.example')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('employees never see the button', () => {
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.employee })
    expect(screen.queryByRole('button', { name: 'Email this report' })).not.toBeInTheDocument()
  })
})
