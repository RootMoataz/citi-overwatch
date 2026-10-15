// Shared MSW server for component and API tests. Tests add handlers with server.use(...).
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export { http, HttpResponse, delay } from 'msw'
export const API = '/api/v1'
// Every screen that shows people asks who has a profile photo; by default nobody does (initials everywhere).
export const server = setupServer(http.get(`${API}/avatars`, () => HttpResponse.json({ items: {} })))
