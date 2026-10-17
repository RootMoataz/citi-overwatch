// Shared MSW server for component and API tests. Tests add handlers with server.use(...).
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export { http, HttpResponse, delay } from 'msw'
export const API = '/api/v1'
// Every screen that shows people asks who has a profile photo; by default nobody does (initials everywhere).
// Managers' and admins' dashboards list missing timesheets; by default everyone has logged hours.
// Dashboards show Live activity; by default nothing has happened.
// New projects can start from a department template (Technology and Operations here).
// Messages: by default nobody has written and the viewer may message nobody (no Message or Discuss buttons).
// Timers: by default none is running, none is live and no change request waits.
// The department templates a new project can start from (a short version of the server's presets).
export const PROJECT_TEMPLATES = [
  { department: 'Technology', milestones: [{ name: 'Discovery & requirements' }, { name: 'Solution architecture' },
    { name: 'Build: backend services' }, { name: 'Build: frontend' }, { name: 'QA & user acceptance testing' },
    { name: 'Release & cutover' }, { name: 'Hypercare' }] },
  { department: 'Operations', milestones: [{ name: 'Current-state assessment' }, { name: 'Vendor & tool selection' },
    { name: 'Pilot rollout' }, { name: 'Training & change management' }, { name: 'Full rollout' },
    { name: 'Post-implementation review' }] },
]
export const server = setupServer(http.get(`${API}/avatars`, () => HttpResponse.json({ items: {} })),
  http.get(`${API}/conversations`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/messages/unread-count`, () => HttpResponse.json({ unread: 0, conversations: 0 })),
  http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [], can_group: false })),
  http.get(`${API}/timesheet-reminders`, () => HttpResponse.json({ week_start: '2026-10-05', due: false, people: [] })),
  http.get(`${API}/activity`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/project-templates`, () => HttpResponse.json({ items: PROJECT_TEMPLATES })),
  // Nobody has a timer running unless a test says so, and My week's timer buttons find an empty timesheet.
  http.get(`${API}/timers/current`, () => HttpResponse.json({ timer: null, now: new Date().toISOString(), stopped: null,
    limits: [], level: 'ok', unsubmitted: [] })),
  // Nobody is running a timer that a manager oversees, and no change request waits.
  http.get(`${API}/timers/live`, () => HttpResponse.json({ now: new Date().toISOString(), items: [] })),
  http.get(`${API}/time-edit-requests`, () => HttpResponse.json([])),
  // Nobody has manual hours waiting for review.
  http.get(`${API}/manual-hours`, () => HttpResponse.json([])),
  http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: null, user: null, rows: [], entries: [],
    totals: { logged: 0, approved: 0 } })))
