// TanStack Query hooks for every API resource. Mutations invalidate what they change and toast success.
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../app/toast.js'
import { celebrate } from '../lib/celebrate.js'
import { formatDayShort, formatHours, nyMondayIso } from '../lib/format.js'
import { statusToast } from '../lib/workflow.js'
import { api } from './client.js'

// Errors that mean "what you're looking at is out of date": refetch so the screen shows the current state.
const STALE_CODES = new Set(['STALE_ENTRY', 'NOT_PENDING'])

// `after(data, variables, queryClient)` runs once the refreshed data is in (e.g. to celebrate an emptied queue).
function useApiMutation(mutationFn, { invalidate = [], success, after } = {}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const refresh = (data, variables) => {
    const keys = typeof invalidate === 'function' ? invalidate(data, variables) : invalidate
    return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  }
  return useMutation({
    mutationFn,
    onSuccess: async (data, variables) => {
      await refresh(data, variables)
      const message = typeof success === 'function' ? success(data, variables) : success
      if (message) toast.success(message)
      after?.(data, variables, queryClient)
    },
    onError: (err, variables) => { if (STALE_CODES.has(err?.code)) refresh(undefined, variables) },
  })
}

// ---------- projects ----------
export const useProjects = (filters) => useQuery({
  queryKey: ['projects', filters], queryFn: () => api.get('/projects', { page_size: 100, ...filters }),
  placeholderData: keepPreviousData,
})
export const useProject = (id) => useQuery({ queryKey: ['project', id], queryFn: () => api.get(`/projects/${id}`) })
export const useProjectSummary = (id) =>
  useQuery({ queryKey: ['project-summary', id], queryFn: () => api.get(`/projects/${id}/summary`) })
export const useMilestoneCosts = (id) =>
  useQuery({ queryKey: ['milestone-costs', id], queryFn: () => api.get(`/projects/${id}/milestone-costs`) })

// Department milestone plans a new project can start from (GET /project-templates); they only change on a deploy.
export const useProjectTemplates = ({ enabled = true } = {}) => useQuery({
  queryKey: ['project-templates'], enabled, staleTime: Infinity, queryFn: () => api.get('/project-templates'),
})
export const useCreateProject = () => useApiMutation((body) => api.post('/projects', body),
  { invalidate: [['projects'], ['dashboard']], success: (p) => `Created ${p.name}` })
// Marking a project completed (it wasn't before) earns a confetti burst.
export const useUpdateProject = (id) => {
  const queryClient = useQueryClient()
  return useApiMutation(async (body) => {
    const wasCompleted = queryClient.getQueryData(['project', id])?.status === 'completed'
    return { saved: await api.put(`/projects/${id}`, body), completedNow: body?.status === 'completed' && !wasCompleted }
  }, { invalidate: [['projects'], ['project', id], ['project-summary', id], ['dashboard']], success: 'Project saved',
    after: (data) => { if (data.completedNow) celebrate() } })
}
export const useArchiveProject = (id) => useApiMutation(() => api.del(`/projects/${id}`),
  { invalidate: [['projects'], ['project', id], ['dashboard']], success: 'Project archived' })
export const useRestoreProject = (id) => useApiMutation(() => api.post(`/projects/${id}/restore`),
  { invalidate: [['projects'], ['project', id], ['dashboard']], success: 'Project restored' })

// ---------- people ----------
export const useManagers = (enabled = true) => useQuery({
  queryKey: ['users', { role: 'manager' }], enabled,
  queryFn: async () => {
    const [managers, admins] = await Promise.all([
      api.get('/users', { role: 'manager', page_size: 100 }), api.get('/users', { role: 'admin', page_size: 100 })])
    return dedupe([...managers.items, ...admins.items])
  },
})
export const usePeoplePicker = (enabled = true) => useQuery({
  queryKey: ['users', 'picker'], enabled,
  queryFn: async () => {
    const [employees, managers] = await Promise.all([
      api.get('/users', { role: 'employee', page_size: 100 }), api.get('/users', { role: 'manager', page_size: 100 })])
    return dedupe([...employees.items, ...managers.items])
  },
})
function dedupe(people) {
  const seen = new Map()
  for (const p of people) seen.set(String(p.id), p)
  return [...seen.values()].sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`))
}

// ---------- members ----------
export const useMembers = (projectId) =>
  useQuery({ queryKey: ['members', projectId], queryFn: () => api.get(`/projects/${projectId}/members`) })
const memberKeys = (projectId) => [['members', projectId], ['project-summary', projectId], ['allocations']]
export const useAddMember = (projectId) => useApiMutation((body) => api.post(`/projects/${projectId}/members`, body),
  { invalidate: memberKeys(projectId), success: 'Added to the team' })
export const useUpdateMember = (projectId) => useApiMutation(
  ({ userId, hours }) => api.put(`/projects/${projectId}/members/${userId}`, { planned_hours_per_week: hours }),
  { invalidate: memberKeys(projectId), success: 'Planned hours updated' })
export const useRemoveMember = (projectId) => useApiMutation(
  (userId) => api.del(`/projects/${projectId}/members/${userId}`),
  { invalidate: [...memberKeys(projectId), ['milestones', projectId]], success: 'Removed from the team' })

// ---------- project requests ----------
export const useRequests = (status) => useQuery({
  queryKey: ['requests', status ?? 'all'], queryFn: () => api.get('/project-requests', status ? { status } : undefined),
})
export const useSubmitRequest = () => useApiMutation((body) => api.post('/project-requests', body),
  { invalidate: [['requests']], success: 'Request sent to the admins' })
// `template: true` starts the new project from its department's template (sent only then: no body otherwise).
export const useApproveRequest = () => useApiMutation(({ id, template }) =>
  api.post(`/project-requests/${id}/approve`, template ? { template: true } : undefined),
  { invalidate: [['requests'], ['projects'], ['dashboard']], success: (d) => `Approved — ${d.project.name} created` })
export const useRejectRequest = () => useApiMutation(({ id, comment }) => api.post(`/project-requests/${id}/reject`, { comment }),
  { invalidate: [['requests']], success: 'Request rejected' })

// ---------- milestones ----------
export const useMilestones = (projectId) =>
  useQuery({ queryKey: ['milestones', projectId], queryFn: () => api.get(`/projects/${projectId}/milestones`) })
// Milestones of several projects at once (same cache entries as useMilestones), flattened into one list.
export const useMilestonesOf = (projectIds) => useQueries({
  queries: projectIds.map((id) => ({ queryKey: ['milestones', id], queryFn: () => api.get(`/projects/${id}/milestones`) })),
  combine: (results) => ({
    data: results.flatMap((r) => r.data ?? []),
    isLoading: results.some((r) => r.isLoading),
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  }),
})
const milestoneKeys = (projectId) => [['milestones', projectId], ['project', projectId], ['project-summary', projectId],
  ['milestone-costs', projectId], ['projects'], ['dashboard']]
export const useSaveMilestone = (projectId) => useApiMutation(async ({ id, fields, predecessorIds, assigneeIds }) => {
  const saved = id ? (Object.keys(fields).length ? await api.put(`/milestones/${id}`, fields) : { id })
    : await api.post(`/projects/${projectId}/milestones`, fields)
  let warnings = []
  if (predecessorIds) warnings = (await api.put(`/milestones/${saved.id}/dependencies`, { predecessor_ids: predecessorIds })).warnings ?? []
  if (assigneeIds) await api.put(`/milestones/${saved.id}/assignees`, { user_ids: assigneeIds })
  return { ...saved, warnings }
}, { invalidate: milestoneKeys(projectId), success: (_, v) => (v.id ? 'Milestone saved' : 'Milestone added') })
export const useMilestoneStatus = (projectId) => useApiMutation(
  ({ id, status }) => api.post(`/milestones/${id}/status`, { status }),
  // "Ready for review" may auto-route the person onto another milestone, maybe in another project; "Completed" may
  // auto-assign the people who were on it to the next milestone.
  { invalidate: [...milestoneKeys(projectId), ['milestones'], ['time'], ['notifications'], ['profile']],
    success: statusToast,
    after: (_, variables) => { if (variables.status === 'completed') celebrate() } })
// Pull mode: a team member takes a ready, unassigned milestone; 409 means someone else got there first.
export const useClaimMilestone = (projectId) => useApiMutation((id) => api.post(`/milestones/${id}/claim`),
  { invalidate: [...milestoneKeys(projectId), ['milestones'], ['profile']], success: (m) => `You're on ${m.name}` })
export const useArchiveMilestone = (projectId) => useApiMutation((id) => api.del(`/milestones/${id}`),
  { invalidate: milestoneKeys(projectId), success: 'Milestone archived' })
export const useNotes = (milestoneId, enabled = true) =>
  useQuery({ queryKey: ['notes', milestoneId], enabled, queryFn: () => api.get(`/milestones/${milestoneId}/notes`) })
export const useAddNote = (milestoneId) => useApiMutation((body) => api.post(`/milestones/${milestoneId}/notes`, { body }),
  { invalidate: [['notes', milestoneId]], success: 'Note added' })

// ---------- time, approvals, notifications ----------
const timeKeys = [['time'], ['approvals'], ['dashboard'], ['project-summary'], ['milestone-costs'], ['projects'], ['allocations'],
  ['notifications'], ['profile'], ['timesheet-reminders'], ['approved-weeks'], ['hr'], ['manual-hours']]
export const useWeek = (week, userId, enabled = true) => useQuery({
  queryKey: ['time', week, userId ?? 'me'], enabled, queryFn: () => api.get('/time-entries', { week, user: userId }),
  placeholderData: keepPreviousData,
})
// The Month calendar: milestones, entries and timer drafts for a month's grid. No keepPreviousData: a new month
// shows a skeleton, never the old month's hours.
export const useCalendarMonth = (month, enabled = true) => useQuery({
  queryKey: ['time', 'month', month], enabled, queryFn: () => api.get('/time-entries/calendar', { month }),
})
export const useSaveWeek = () => useApiMutation((body) => api.put('/time-entries', body),
  { invalidate: [...timeKeys, ['timer']], success: 'Hours saved and sent for approval' })
export const useApprovals = (filters = {}, enabled = true) =>
  useQuery({ queryKey: ['approvals', filters], enabled, queryFn: () => api.get('/approvals', filters) })
const breakdownQuery = (entryId, enabled) =>
  ({ queryKey: ['breakdown', entryId], enabled, queryFn: () => api.get(`/time-entries/${entryId}/breakdown`) })
export const useBreakdown = (entryId, enabled = true) => useQuery(breakdownQuery(entryId, enabled))
// Several entries' breakdowns at once (the same cache entries as useBreakdown), one result per id, in order.
export const useBreakdowns = (entryIds, enabled = true) =>
  useQueries({ queries: entryIds.map((id) => breakdownQuery(id, enabled)) })
// expected_hours: the hours the manager saw; the server refuses (409 STALE_ENTRY) if the entry changed since.
export const useApproveEntry = () => useApiMutation(({ id, expectedHours }) =>
  api.post(`/time-entries/${id}/approve`, { expected_hours: expectedHours }),
{ invalidate: timeKeys, success: 'Hours approved', after: (_, __, queryClient) => { if (approvalsCleared(queryClient)) celebrate() } })
/** True when every approvals list on screen came back empty after a decision: the queue is cleared. */
export function approvalsCleared(queryClient) {
  const lists = queryClient.getQueriesData({ queryKey: ['approvals'] }).map(([, data]) => data).filter(Array.isArray)
  return lists.length > 0 && lists.every((list) => list.length === 0)
}
// `success` replaces the toast (a string, or (data, variables) => string) and null silences it.
export const useRejectEntry = ({ success = 'Hours rejected' } = {}) => useApiMutation(({ id, reason, expectedHours }) =>
  api.post(`/time-entries/${id}/reject`, { reason, expected_hours: expectedHours }),
  { invalidate: timeKeys, success })
const weekApproved = (d) => `Approved the week (${d.approved} ${d.approved === 1 ? 'entry' : 'entries'})`
// One person's week in one step: every entry (approval items) with the hours the approver saw; all or nothing on the
// server. `success` as for useRejectEntry; its variables are the items sent.
export const useApproveWeek = ({ success = weekApproved } = {}) => useApiMutation((items) => api.post('/approvals/approve-week', {
  entries: items.map((i) => ({ id: i.entry.id, expected_hours: i.entry.hours })) }),
{ invalidate: timeKeys, success, after: (_, __, queryClient) => { if (approvalsCleared(queryClient)) celebrate() } })
// Approved hours per person-week; range = { from, to } (ISO dates).
export const useApprovedWeeks = (range, enabled = true) => useQuery({
  queryKey: ['approved-weeks', range], enabled, queryFn: () => api.get('/timesheets/approved', range),
  placeholderData: keepPreviousData,
})

// ---------- manual hours: logged without the timer, reviewed one by one ----------
// Admins and managers: the manual requests they may decide (employees never call this).
export const useManualHours = (filters = {}, enabled = true) =>
  useQuery({ queryKey: ['manual-hours', filters], enabled, queryFn: () => api.get('/manual-hours', filters) })
const sentToast = (d, v) => `Sent ${formatHours(d.entry.hours)} on ${v.name} (${formatDayShort(d.entry.work_date)}) for review`
export const useLogManualHours = () => useApiMutation(({ body }) => api.post('/manual-hours', body),
  { invalidate: timeKeys, success: sentToast })
export const useEditManualHours = () => useApiMutation(({ id, body }) => api.put(`/manual-hours/${id}`, body),
  { invalidate: timeKeys, success: sentToast })
export const useWithdrawManualHours = () => useApiMutation(({ id }) => api.del(`/manual-hours/${id}`),
  { invalidate: timeKeys, success: (_, v) => `Withdrew ${formatHours(v.hours)} on ${v.name} (${formatDayShort(v.date)})` })
// The hours and version the reviewer saw: the server refuses (409 STALE_ENTRY) if the entry changed since.
const seen = ({ entry }) => ({ expected_hours: entry.hours, expected_updated_at: entry.updated_at })
export const useApproveManual = () => useApiMutation(({ item }) => api.post(`/manual-hours/${item.entry.id}/approve`, seen(item)),
  { invalidate: timeKeys, success: (_, v) => `Approved ${formatHours(v.item.entry.hours)} for ${v.item.user.name}` })
export const useRequestManualChanges = () => useApiMutation(({ item, reason }) =>
  api.post(`/manual-hours/${item.entry.id}/request-changes`, { reason, ...seen(item) }),
{ invalidate: timeKeys, success: (_, v) => `Sent back to ${v.item.user.name}` })

// ---------- timers: one running per person; stopping one keeps its hours as a draft of the day's cell ----------
// The running timer (or null) with the server's clock, its limits and the person's unsubmitted timer hours; a timer
// left past midnight is stopped by this read.
export const useCurrentTimer = (enabled = true) => useQuery({
  queryKey: ['timer'], enabled, queryFn: () => api.get('/timers/current'), staleTime: 30_000,
})
export const useStartTimer = () => useApiMutation((milestoneId) => api.post('/timers', { milestone_id: milestoneId }),
  { invalidate: [['timer'], ['time'], ['notifications'], ['timers-live']],
    success: (d) => `Timer started on ${d.timer.milestone.name}` })
// The result says what was added to the timesheet (or why nothing was); the caller shows it, so no generic toast.
export const useStopTimer = () => useApiMutation((note) => api.post('/timers/stop', note ? { note } : {}),
  { invalidate: [['timer'], ['timers-live'], ...timeKeys] })
// Managers, admins and executives: the running timers they oversee (the screen ticks between refreshes).
export const useLiveTimers = (enabled = true) => useQuery({
  queryKey: ['timers-live'], enabled, queryFn: () => api.get('/timers/live'), refetchInterval: 30_000,
})
// A manager or admin stops someone's timer with a message (it reaches them in the bell and in Messages).
export const useStopRemote = () => useApiMutation(({ id, message }) => api.post(`/timers/${id}/stop-remote`, { message }),
  { invalidate: [['timers-live'], ['messages'], ['notifications']] })

// ---------- change requests on locked (timer) cells ----------
export const useEditRequests = (status = 'pending', enabled = true) => useQuery({
  queryKey: ['edit-requests', status], enabled, queryFn: () => api.get('/time-edit-requests', { status }),
})
export const useRequestEdit = () => useApiMutation((body) => api.post('/time-edit-requests', body),
  { invalidate: [['time'], ['edit-requests']], success: 'Change requested — your manager has been told' })
export const useDecideEdit = () => useApiMutation(({ id, approve, comment }) =>
  api.post(`/time-edit-requests/${id}/${approve ? 'approve' : 'reject'}`, comment ? { comment } : {}),
{ invalidate: [['edit-requests'], ...timeKeys],
  success: (d) => (d.status === 'approved' ? `Change approved — ${d.user.name}'s hours updated` : 'Change request declined') })

// ---------- HR submissions (admins submit; executives read the list) ----------
export const useHrSubmissions = (enabled = true) =>
  useQuery({ queryKey: ['hr', 'submissions'], enabled, queryFn: () => api.get('/hr-submissions') })
export const useHrPreview = (period, enabled = true) => useQuery({
  queryKey: ['hr', 'preview', period], enabled, queryFn: () => api.get('/hr-submissions/preview', period),
  placeholderData: keepPreviousData,
})
export const useHrChanges = (enabled = true) =>
  useQuery({ queryKey: ['hr', 'changes'], enabled, queryFn: () => api.get('/hr-submissions/changes') })
export const useSubmitHr = () => useApiMutation((body) => api.post('/hr-submissions', body),
  { invalidate: [['hr'], ['approved-weeks']], success: 'Submitted to HR (export ready)' })
/** Every row a submission sent (for the payroll CSV); fetched on demand, not cached. */
export const fetchHrSubmissionEntries = (id) => api.get(`/hr-submissions/${id}/entries`)

export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/notifications', { unread: 'true' }) })
export const useMarkRead = () => useApiMutation((id) => api.post(`/notifications/${id}/read`), { invalidate: [['notifications']] })
export const useMarkAllRead = () => useApiMutation(() => api.post('/notifications/read-all'), { invalidate: [['notifications']] })
export const useAllocations = (week, enabled = true) =>
  useQuery({ queryKey: ['allocations', week], enabled, queryFn: () => api.get('/allocations', { week }) })

// ---------- dashboard, people, profile, audit ----------
// department: an id narrows the project widgets and the over-40h list to that department ('' = all).
export const useDashboard = (department = '') => useQuery({
  queryKey: ['dashboard', department], queryFn: () => api.get('/dashboard', { department }),
  placeholderData: keepPreviousData,
})
// Managers and admins: their people with an empty timesheet (this week from Friday 14:00 New York time, else last week).
export const useMissingTimesheets = (department = '', enabled = true) => useQuery({
  queryKey: ['timesheet-reminders', department], enabled,
  queryFn: () => api.get('/timesheet-reminders', { department }), placeholderData: keepPreviousData,
})
export const useUsers = (filters) => useQuery({
  queryKey: ['users', 'list', filters], queryFn: () => api.get('/users', { page_size: 100, ...filters }),
  placeholderData: keepPreviousData,
})
export const useUser = (id) => useQuery({ queryKey: ['user', id], queryFn: () => api.get(`/users/${id}`) })
// The full profile, its `this_week` for New York's week: the server's default is the UTC week, a day ahead on a Sunday
// evening in New York. The week is in the key, so a new week asks again.
export function useProfile(id, enabled = true) {
  const week = nyMondayIso()
  return useQuery({ queryKey: ['profile', id, week], enabled, queryFn: () => api.get(`/users/${id}/profile`, { week }) })
}
// One week's hours for the My week card: only `this_week`, for any past week. Saves invalidate ['profile'], which covers it.
export const useProfileWeek = (id, week, enabled = true) => useQuery({
  queryKey: ['profile', id, 'week', week], enabled, placeholderData: keepPreviousData,
  queryFn: () => api.get(`/users/${id}/profile`, { week, sections: 'this_week' }),
})
export const useUsernameCheck = (params, enabled = true) => useQuery({
  queryKey: ['username-check', params], enabled, queryFn: () => api.get('/users/username-availability', params),
  placeholderData: keepPreviousData, refetchInterval: false,
})
export const useCreateUser = () => useApiMutation((body) => api.post('/users', body),
  { invalidate: [['users']], success: (d) => (d.email_sent ? `Account created — sign-in details emailed to ${d.user.email}` : null) })
export const useUpdateUser = (id) => useApiMutation((body) => api.put(`/users/${id}`, body),
  { invalidate: [['users'], ['user', id]], success: 'Person saved' })
export const useArchiveUser = (id) => useApiMutation(() => api.del(`/users/${id}`),
  { invalidate: [['users'], ['user', id]], success: 'Account archived' })
export const useRestoreUser = (id) => useApiMutation(() => api.post(`/users/${id}/restore`),
  { invalidate: [['users'], ['user', id]], success: 'Account restored' })
export const useResetUserPassword = (id) => useApiMutation((body) => api.post(`/users/${id}/reset-password`, body ?? {}),
  { invalidate: [['user', id]], success: (d) => (d.email_sent ? 'New temporary password emailed' : null) })
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
export const useUpdateMe = () => useApiMutation((body) => api.put('/me', body), { invalidate: [['me']], success: 'Profile saved' })
// Everyone who could appear in the audit log, archived accounts included (admin only).
export const useEveryone = () => useQuery({
  queryKey: ['users', 'everyone'],
  queryFn: async () => {
    const [active, archived] = await Promise.all([
      api.get('/users', { page_size: 100 }), api.get('/users', { archived: 'true', page_size: 100 })])
    return dedupe([...active.items, ...archived.items])
  },
})
// Recent events in the viewer's scope as sentences (Live activity); polls with the app's normal interval.
export const useActivity = (department = '', limit = 12) => useQuery({
  queryKey: ['activity', department, limit], queryFn: () => api.get('/activity', { limit, department }),
  placeholderData: keepPreviousData,
})
export const useAuditLog = (filters) => useQuery({
  queryKey: ['audit', filters], queryFn: () => api.get('/audit-log', filters), placeholderData: keepPreviousData,
})

// ---------- archive (admin) ----------
export const useArchive = () => useQuery({ queryKey: ['archive'], queryFn: () => api.get('/archive') })
// Each archived type goes back through its own existing restore endpoint.
const RESTORE_PATHS = { project: 'projects', milestone: 'milestones', user: 'users' }
export const useRestoreArchived = () => useApiMutation((item) => api.post(`/${RESTORE_PATHS[item.type]}/${item.id}/restore`),
  { invalidate: [['archive'], ['projects'], ['project'], ['milestones'], ['users'], ['user'], ['dashboard']],
    success: (_, item) => `Restored ${item.name}` })

// ---------- departments ----------
// Everyone signed in can list them; admins also see archived ones and change them.
export const useDepartments = ({ includeArchived = false, enabled = true } = {}) => useQuery({
  queryKey: ['departments', includeArchived], enabled,
  queryFn: () => api.get('/departments', includeArchived ? { include_archived: 'true' } : undefined),
})
const departmentKeys = [['departments'], ['projects'], ['project'], ['dashboard'], ['users'], ['user'], ['profile']]
export const useCreateDepartment = () => useApiMutation((body) => api.post('/departments', body),
  { invalidate: departmentKeys, success: (d) => `Added ${d.name}` })
export const useRenameDepartment = () => useApiMutation(({ id, name }) => api.put(`/departments/${id}`, { name }),
  { invalidate: departmentKeys, success: (d) => `Renamed to ${d.name}` })
export const useArchiveDepartment = () => useApiMutation((d) => api.del(`/departments/${d.id}`),
  { invalidate: departmentKeys, success: (_, d) => `Archived ${d.name}` })
export const useRestoreDepartment = () => useApiMutation((d) => api.post(`/departments/${d.id}/restore`),
  { invalidate: departmentKeys, success: (d) => `Restored ${d.name}` })

// ---------- profile photos ----------
// One small index ({user id: version}) tells every list who has a photo, so people without one never cause a
// request. Each photo is fetched once per user + version and cached; its object URL is revoked when react-query
// drops the cache entry (unused for gcTime, a newer version, or sign-out clearing the cache).
const AVATAR_GC_MS = 30 * 60 * 1000
const revokerInstalled = new WeakSet()

function installAvatarRevoker(queryClient) {
  if (revokerInstalled.has(queryClient)) return
  revokerInstalled.add(queryClient)
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'removed' && event.query.queryKey[0] === 'avatar' && event.query.state.data) {
      URL.revokeObjectURL(event.query.state.data)
    }
  })
}

export const useAvatarIndex = () => useQuery({
  queryKey: ['avatars'], queryFn: () => api.get('/avatars'), staleTime: 60000, refetchInterval: false,
  select: (data) => data?.items ?? {},
})

/** The photo of `userId` as an object URL, or undefined while loading / when they have none. */
export function useAvatar(userId, version) {
  const queryClient = useQueryClient()
  installAvatarRevoker(queryClient)
  return useQuery({
    queryKey: ['avatar', String(userId), version], enabled: Boolean(userId && version),
    queryFn: async () => URL.createObjectURL(await api.blob(`/users/${userId}/avatar`, { v: version })),
    staleTime: Infinity, gcTime: AVATAR_GC_MS, refetchInterval: false, refetchOnWindowFocus: false, retry: false,
  })
}

const avatarKeys = [['avatars'], ['me'], ['users'], ['user']]
export const useSetAvatar = () => useApiMutation((image) => api.put('/me/avatar', { image }),
  { invalidate: avatarKeys, success: 'Profile photo updated' })
export const useRemoveAvatar = () => useApiMutation(() => api.del('/me/avatar'),
  { invalidate: avatarKeys, success: 'Profile photo removed' })
export const useRemoveUserAvatar = (id) => useApiMutation(() => api.del(`/users/${id}/avatar`),
  { invalidate: avatarKeys, success: 'Profile photo removed' })
