// Fetch wrapper for the v1 API: bearer token, request ids, one shared token refresh, typed errors.

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`

export class ApiError extends Error {
  constructor({ status, code, message, details = null, requestId = null }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

let token = null
let expiredHandler = () => {}
let refreshing = null
const sessionListeners = new Set()

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function buildUrl(path, query) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value))
  }
  const qs = params.toString()
  return `${BASE}${path}${qs ? `?${qs}` : ''}`
}

async function send(method, path, { body, query, signal } = {}) {
  let res
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: {
        'content-type': 'application/json',
        'x-request-id': newRequestId(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR',
      message: "Can't reach the server. Check your connection and try again." })
  }
  if (res.status === 204) return null
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (text && !(res.headers.get('content-type') ?? '').includes('json')) {
    // CloudFront answers unknown paths with the app's index.html (status 200). For an API call that means
    // the API said 404, so treat it as one instead of handing a page of HTML to the screen as data.
    throw new ApiError({ status: 404, code: 'NOT_FOUND', message: "This doesn't exist, or you don't have access to it.",
      requestId: res.headers.get('x-request-id') })
  }
  if (!res.ok) {
    const e = data?.error ?? {}
    throw new ApiError({
      status: res.status,
      code: e.code ?? `HTTP_${res.status}`,
      message: e.message ?? 'Something went wrong. Please try again.',
      details: e.details ?? null,
      requestId: e.request_id ?? res.headers.get('x-request-id'),
    })
  }
  return data
}

/** One refresh at a time: concurrent callers share the same promise. */
function refresh() {
  if (!refreshing) {
    refreshing = send('POST', '/auth/refresh')
      .then((data) => {
        token = data.access_token
        sessionListeners.forEach((fn) => fn(data.user))
        return data
      })
      .catch((err) => {
        token = null
        expiredHandler()
        throw err
      })
      .finally(() => { refreshing = null })
  }
  return refreshing
}

async function request(method, path, options = {}) {
  try {
    return await send(method, path, options)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && err.code === 'TOKEN_EXPIRED' && !options.retried) {
      try {
        await refresh()
      } catch {
        throw err
      }
      return request(method, path, { ...options, retried: true })
    }
    throw err
  }
}

export const api = {
  request,
  get: (path, query, opts) => request('GET', path, { ...opts, query }),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  /** Restore a session from the refresh cookie; resolves to the user or rejects. */
  refresh: () => refresh().then((data) => data.user),
  setToken(next) { token = next },
  getToken() { return token },
  onSessionExpired(fn) { expiredHandler = fn },
  onSessionRefreshed(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn) },
}
