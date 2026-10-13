// Shared MSW server for component and API tests. Tests add handlers with server.use(...).
import { setupServer } from 'msw/node'

export { http, HttpResponse, delay } from 'msw'
export const API = '/api/v1'
export const server = setupServer()
