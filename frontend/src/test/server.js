// Shared MSW server for component and API tests. Tests add handlers with server.use(...).
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export { http, HttpResponse, delay } from 'msw'
export const API = '/api/v1'
// Every screen that shows people asks who has a profile photo; by default nobody does (initials everywhere).
// Managers' and admins' dashboards list missing timesheets; by default everyone has logged hours.
// Dashboards show Live activity; by default nothing has happened.
export const server = setupServer(http.get(`${API}/avatars`, () => HttpResponse.json({ items: {} })),
  http.get(`${API}/timesheet-reminders`, () => HttpResponse.json({ week_start: '2026-10-05', due: false, people: [] })),
  http.get(`${API}/activity`, () => HttpResponse.json({ items: [] })))
