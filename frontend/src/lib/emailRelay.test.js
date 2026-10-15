import { afterEach, describe, expect, test, vi } from 'vitest'
import { HttpResponse, http, server } from '../test/server.js'
import { EMAILJS_URL, relayConfigured, relayCredentials, relayReport, reportRelayConfigured } from './emailRelay.js'

const details = { to: 'ada@acme.example', name: 'Ada Lovelace', username: 'alovelace', password: 'Tmp#12345678', kind: 'welcome' }

function configure() {
  vi.stubEnv('VITE_EMAILJS_SERVICE_ID', 'svc_test')
  vi.stubEnv('VITE_EMAILJS_TEMPLATE_ID', 'tpl_test')
  vi.stubEnv('VITE_EMAILJS_PUBLIC_KEY', 'pk_test')
}

describe('email relay', () => {
  afterEach(() => vi.unstubAllEnvs())

  test('is off without configuration and sends nothing', async () => {
    let calls = 0
    server.use(http.post(EMAILJS_URL, () => { calls += 1; return new HttpResponse('OK') }))
    expect(relayConfigured()).toBe(false)
    await expect(relayCredentials(details)).resolves.toBe(false)
    expect(calls).toBe(0)
  })

  test('sends the sign-in details through the template when configured', async () => {
    configure()
    let body = null
    server.use(http.post(EMAILJS_URL, async ({ request }) => { body = await request.json(); return new HttpResponse('OK') }))
    expect(relayConfigured()).toBe(true)
    await expect(relayCredentials(details)).resolves.toBe(true)
    expect(body).toMatchObject({
      service_id: 'svc_test', template_id: 'tpl_test', user_id: 'pk_test',
      template_params: { to_email: 'ada@acme.example', to_name: 'Ada Lovelace', username: 'alovelace',
        temp_password: 'Tmp#12345678', signin_url: `${window.location.origin}/login` },
    })
    expect(body.template_params.intro).toMatch(/account has been set up/i)
  })

  test('a password reset uses reset wording', async () => {
    configure()
    let body = null
    server.use(http.post(EMAILJS_URL, async ({ request }) => { body = await request.json(); return new HttpResponse('OK') }))
    await relayCredentials({ ...details, kind: 'reset' })
    expect(body.template_params.intro).toMatch(/password has been reset/i)
  })

  test('reports failure instead of throwing', async () => {
    configure()
    server.use(http.post(EMAILJS_URL, () => new HttpResponse('The Public Key is invalid', { status: 400 })))
    await expect(relayCredentials(details)).resolves.toBe(false)
    server.use(http.post(EMAILJS_URL, () => HttpResponse.error()))
    await expect(relayCredentials(details)).resolves.toBe(false)
  })
})

describe('report relay', () => {
  afterEach(() => vi.unstubAllEnvs())
  const report = { to: 'cfo@acme.example', toName: 'Casey CFO', subject: 'Scout delivery report — Oct 14, 2026',
    reportHtml: '<table><tr><td>Hi</td></tr></table>', fromName: 'Morgan Manager' }

  test('is off without its own template id and sends nothing', async () => {
    configure()  // the sign-in template alone is not enough
    let calls = 0
    server.use(http.post(EMAILJS_URL, () => { calls += 1; return new HttpResponse('OK') }))
    expect(reportRelayConfigured()).toBe(false)
    await expect(relayReport(report)).resolves.toBe(false)
    expect(calls).toBe(0)
  })

  test('sends exactly the report template parameters', async () => {
    configure()
    vi.stubEnv('VITE_EMAILJS_REPORT_TEMPLATE_ID', 'tpl_report')
    let body = null
    server.use(http.post(EMAILJS_URL, async ({ request }) => { body = await request.json(); return new HttpResponse('OK') }))
    expect(reportRelayConfigured()).toBe(true)
    await expect(relayReport(report)).resolves.toBe(true)
    expect(body).toEqual({
      service_id: 'svc_test', template_id: 'tpl_report', user_id: 'pk_test',
      template_params: { to_email: 'cfo@acme.example', to_name: 'Casey CFO', subject: 'Scout delivery report — Oct 14, 2026',
        from_name: 'Morgan Manager', report_html: '<table><tr><td>Hi</td></tr></table>', app_url: window.location.origin },
    })
  })

  test('reports failure instead of throwing', async () => {
    configure()
    vi.stubEnv('VITE_EMAILJS_REPORT_TEMPLATE_ID', 'tpl_report')
    server.use(http.post(EMAILJS_URL, () => new HttpResponse('bad', { status: 400 })))
    await expect(relayReport(report)).resolves.toBe(false)
    server.use(http.post(EMAILJS_URL, () => HttpResponse.error()))
    await expect(relayReport(report)).resolves.toBe(false)
  })
})
