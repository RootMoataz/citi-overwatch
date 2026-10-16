import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server.js'

// jsdom has no layout engine; tests set the viewport width with setViewport(px).
let viewportWidth = 1280
export function setViewport(width) {
  viewportWidth = width
  window.dispatchEvent(new Event('resize'))
}

// The OS colour scheme the "System" theme follows; light unless a test asks for dark.
let prefersDark = false
export function setPrefersDark(value) {
  prefersDark = value
}

function matches(query) {
  if (/prefers-color-scheme:\s*dark/.test(query)) return prefersDark
  if (/prefers-color-scheme/.test(query)) return !prefersDark
  const min = /min-width:\s*(\d+)px/.exec(query)
  const max = /max-width:\s*(\d+)px/.exec(query)
  return (!min || viewportWidth >= Number(min[1])) && (!max || viewportWidth <= Number(max[1]))
}

window.matchMedia = (query) => ({
  get matches() { return matches(query) },
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false },
})

// Charts measure their container; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom has no object URLs; profile photos and previews use them.
let objectUrls = 0
URL.createObjectURL ??= () => `blob:test/${(objectUrls += 1)}`
URL.revokeObjectURL ??= () => {}

// Relative fetch URLs need an origin under Node.
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) =>
  realFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, 'http://localhost') : input, init)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  setViewport(1280)
  prefersDark = false
  try { localStorage.clear() } catch { /* nothing stored */ }
  try { sessionStorage.clear() } catch { /* nothing stored */ }
})
afterAll(() => server.close())
