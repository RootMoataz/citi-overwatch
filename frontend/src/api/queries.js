// TanStack Query hooks for every API resource. Mutations invalidate what they change and toast success.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../app/toast.js'
import { api } from './client.js'

function useApiMutation(mutationFn, { invalidate = [], success } = {}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn,
    onSuccess: async (data, variables) => {
      const keys = typeof invalidate === 'function' ? invalidate(data, variables) : invalidate
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      const message = typeof success === 'function' ? success(data, variables) : success
      if (message) toast.success(message)
    },
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
