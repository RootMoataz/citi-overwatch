import { beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../test/server.js'
import { api, ApiError } from './client.js'

const expired = () =>
  HttpResponse.json({ error: { code: 'TOKEN_EXPIRED', message: 'Your session has expired', request_id: 'r-exp' } },
    { status: 401 })

describe('api client', () => {
  beforeEach(() => {
    api.setToken('old-token')
    api.onSessionExpired(() => {})
  })

  test('sends the bearer token, a request id and credentials', async () => {
    let seen
    server.use(http.get(`${API}/me`, ({ request }) => {
      seen = { auth: request.headers.get('authorization'), rid: request.headers.get('x-request-id') }
      return HttpResponse.json({ ok: true })
    }))
    await expect(api.request('GET', '/me')).resolves.toEqual({ ok: true })
    expect(seen.auth).toBe('Bearer old-token')
    expect(seen.rid).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('builds query strings and skips empty values', async () => {
    let url
    server.use(http.get(`${API}/projects`, ({ request }) => { url = new URL(request.url); return HttpResponse.json([]) }))
    await api.request('GET', '/projects', { query: { q: 'apo', status: '', page: 2, at_risk: undefined } })
    expect(url.search).toBe('?q=apo&page=2')
  })

  test('api client refreshes once for concurrent 401s', async () => {
    let refreshes = 0
    server.use(
      http.post(`${API}/auth/refresh`, () => {
        refreshes += 1
        return HttpResponse.json({ access_token: 'new-token', user: { id: 'u1' } })
      }),
      http.get(`${API}/items/:n`, ({ request, params }) =>
        request.headers.get('authorization') === 'Bearer new-token'
          ? HttpResponse.json({ n: params.n })
          : expired()),
    )
    const results = await Promise.all([1, 2, 3].map((n) => api.request('GET', `/items/${n}`)))
    expect(results).toEqual([{ n: '1' }, { n: '2' }, { n: '3' }])
    expect(refreshes).toBe(1)
  })

  test('api client calls onSessionExpired once when refresh fails', async () => {
    const onExpired = vi.fn()
    api.onSessionExpired(onExpired)
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ error: { code: 'REFRESH_INVALID', message: 'ended' } }, { status: 401 })),
      http.get(`${API}/items/:n`, expired),
    )
    const settled = await Promise.allSettled([1, 2, 3].map((n) => api.request('GET', `/items/${n}`)))
    expect(settled.every((s) => s.status === 'rejected')).toBe(true)
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  test('ApiError carries requestId from the error body', async () => {
    server.use(http.post(`${API}/projects`, () =>
      HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'bad', details: { name: 'required' },
        request_id: 'req-42' } }, { status: 400 })))
    const err = await api.request('POST', '/projects', { body: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'bad',
      details: { name: 'required' }, requestId: 'req-42' })
  })

  test('204 responses resolve to null', async () => {
    server.use(http.delete(`${API}/projects/p1`, () => new HttpResponse(null, { status: 204 })))
    await expect(api.request('DELETE', '/projects/p1')).resolves.toBeNull()
  })

  test('an HTML page instead of JSON (a CDN fallback) is a 404, not data', async () => {
    server.use(http.get(`${API}/projects/gone`, () =>
      new HttpResponse('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    const err = await api.request('GET', '/projects/gone').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  test('network failures become a friendly ApiError', async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.error()))
    const err = await api.request('GET', '/me').catch((e) => e)
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(err.message).toMatch(/can't reach the server/i)
  })

  test('blob() returns image bytes with the bearer token', async () => {
    let auth
    server.use(http.get(`${API}/users/u1/avatar`, ({ request }) => {
      auth = request.headers.get('authorization')
      return new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
    }))
    const blob = await api.blob('/users/u1/avatar', { v: '5' })
    expect(auth).toBe('Bearer old-token')
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
  })

  test('blob() treats a non-image answer as missing and passes API errors through', async () => {
    server.use(http.get(`${API}/users/u1/avatar`, () =>
      new HttpResponse('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    await expect(api.blob('/users/u1/avatar')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    server.use(http.get(`${API}/users/u2/avatar`, () =>
      HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })))
    await expect(api.blob('/users/u2/avatar')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})
