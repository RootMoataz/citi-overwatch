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

function serveData(seen = []) {
  server.use(
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

  test('sends the escaped report for the current department through the report template', async () => {
    configure()
    const seen = []
    serveData(seen)
    let body = null
    server.use(http.post(EMAILJS_URL, async ({ request }) => { body = await request.json(); return new HttpResponse('OK') }))
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} department="d1" />, { user: users.executive })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    const dialog = await screen.findByRole('dialog', { name: 'Email this report' })
    expect(screen.getByLabelText(/subject/i).value).toMatch(/^Scout delivery report — /)
    expect(dialog.querySelector('iframe[title="Report preview"]')).toHaveAttribute('sandbox', '')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/enter an email address/i)).toBeInTheDocument()
    expect(body).toBeNull()
    await user.type(screen.getByLabelText(/recipient email/i), 'cfo@acme.example')
    await user.type(screen.getByLabelText(/recipient name/i), 'Casey CFO')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.template_id).toBe('tpl_report')
    expect(body.template_params).toMatchObject({ to_email: 'cfo@acme.example', to_name: 'Casey CFO', from_name: 'Eve Executive',
      app_url: window.location.origin })
    expect(body.template_params.report_html).toContain('Apollo &lt;i&gt;x&lt;/i&gt;')
    expect(body.template_params.report_html).not.toContain('<i>x</i>')
    expect(body.template_params.report_html).toContain('Technology')
    expect(body.template_params.report_html).toContain('Apollo is late')
    expect(seen[0]).toMatchObject({ department: 'd1' })
    expect(await screen.findByText('Report sent to cfo@acme.example')).toBeInTheDocument()
  })

  test('keeps the dialog open with a message when the email service refuses', async () => {
    configure()
    serveData()
    server.use(http.post(EMAILJS_URL, () => new HttpResponse('bad', { status: 400 })))
    const user = userEvent.setup()
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.admin })
    await user.click(screen.getByRole('button', { name: 'Email this report' }))
    await user.type(await screen.findByLabelText(/recipient email/i), 'a@acme.example')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/didn't accept the report/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('employees never see the button', () => {
    renderAsUser(<EmailReportButton dashboard={dashboard} />, { user: users.employee })
    expect(screen.queryByRole('button', { name: 'Email this report' })).not.toBeInTheDocument()
  })
})
