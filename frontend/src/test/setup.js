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

function matches(query) {
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

// Relative fetch URLs need an origin under Node.
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) =>
  realFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, 'http://localhost') : input, init)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  setViewport(1280)
})
afterAll(() => server.close())
