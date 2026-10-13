// TanStack Query hooks for every API resource. Mutations invalidate what they change and toast success.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../app/toast.js'
import { api } from './client.js'

// Errors that mean "what you're looking at is out of date": refetch so the screen shows the current state.
const STALE_CODES = new Set(['STALE_ENTRY', 'NOT_PENDING'])

function useApiMutation(mutationFn, { invalidate = [], success } = {}) {
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

export const useCreateProject = () => useApiMutation((body) => api.post('/projects', body),
  { invalidate: [['projects'], ['dashboard']], success: (p) => `Created ${p.name}` })
export const useUpdateProject = (id) => useApiMutation((body) => api.put(`/projects/${id}`, body),
  { invalidate: [['projects'], ['project', id], ['project-summary', id], ['dashboard']], success: 'Project saved' })
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
export const useApproveRequest = () => useApiMutation((id) => api.post(`/project-requests/${id}/approve`),
  { invalidate: [['requests'], ['projects'], ['dashboard']], success: (d) => `Approved — ${d.project.name} created` })
export const useRejectRequest = () => useApiMutation(({ id, comment }) => api.post(`/project-requests/${id}/reject`, { comment }),
  { invalidate: [['requests']], success: 'Request rejected' })

// ---------- milestones ----------
export const useMilestones = (projectId) =>
  useQuery({ queryKey: ['milestones', projectId], queryFn: () => api.get(`/projects/${projectId}/milestones`) })
const milestoneKeys = (projectId) => [['milestones', projectId], ['project', projectId], ['project-summary', projectId],
  ['projects'], ['dashboard']]
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
  { invalidate: milestoneKeys(projectId), success: 'Status updated' })
export const useArchiveMilestone = (projectId) => useApiMutation((id) => api.del(`/milestones/${id}`),
  { invalidate: milestoneKeys(projectId), success: 'Milestone archived' })
export const useNotes = (milestoneId, enabled = true) =>
  useQuery({ queryKey: ['notes', milestoneId], enabled, queryFn: () => api.get(`/milestones/${milestoneId}/notes`) })
export const useAddNote = (milestoneId) => useApiMutation((body) => api.post(`/milestones/${milestoneId}/notes`, { body }),
  { invalidate: [['notes', milestoneId]], success: 'Note added' })

// ---------- time, approvals, notifications ----------
const timeKeys = [['time'], ['approvals'], ['dashboard'], ['project-summary'], ['projects'], ['allocations'], ['notifications']]
export const useWeek = (week, userId) => useQuery({
  queryKey: ['time', week, userId ?? 'me'], queryFn: () => api.get('/time-entries', { week, user: userId }),
  placeholderData: keepPreviousData,
})
export const useSaveWeek = () => useApiMutation((body) => api.put('/time-entries', body),
  { invalidate: timeKeys, success: 'Hours saved and sent for approval' })
export const useApprovals = (filters = {}, enabled = true) =>
  useQuery({ queryKey: ['approvals', filters], enabled, queryFn: () => api.get('/approvals', filters) })
export const useBreakdown = (entryId, enabled = true) =>
  useQuery({ queryKey: ['breakdown', entryId], enabled, queryFn: () => api.get(`/time-entries/${entryId}/breakdown`) })
// expected_hours: the hours the manager saw; the server refuses (409 STALE_ENTRY) if the entry changed since.
export const useApproveEntry = () => useApiMutation(({ id, expectedHours }) =>
  api.post(`/time-entries/${id}/approve`, { expected_hours: expectedHours }),
{ invalidate: timeKeys, success: 'Hours approved' })
export const useRejectEntry = () => useApiMutation(({ id, reason, expectedHours }) =>
  api.post(`/time-entries/${id}/reject`, { reason, expected_hours: expectedHours }),
  { invalidate: timeKeys, success: 'Hours rejected' })
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/notifications', { unread: 'true' }) })
export const useMarkRead = () => useApiMutation((id) => api.post(`/notifications/${id}/read`), { invalidate: [['notifications']] })
export const useMarkAllRead = () => useApiMutation(() => api.post('/notifications/read-all'), { invalidate: [['notifications']] })
export const useAllocations = (week, enabled = true) =>
  useQuery({ queryKey: ['allocations', week], enabled, queryFn: () => api.get('/allocations', { week }) })

// ---------- dashboard, people, profile, audit ----------
export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/dashboard') })
export const useUsers = (filters) => useQuery({
  queryKey: ['users', 'list', filters], queryFn: () => api.get('/users', { page_size: 100, ...filters }),
  placeholderData: keepPreviousData,
})
export const useUser = (id) => useQuery({ queryKey: ['user', id], queryFn: () => api.get(`/users/${id}`) })
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
export const useAuditLog = (filters) => useQuery({
  queryKey: ['audit', filters], queryFn: () => api.get('/audit-log', filters), placeholderData: keepPreviousData,
})
