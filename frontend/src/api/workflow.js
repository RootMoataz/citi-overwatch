// TanStack Query hooks for the milestone workflow: the skills catalogue and people's skills, progress updates,
// kickbacks and a milestone's history.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../app/toast.js'
import { api } from './client.js'

function useWorkflowMutation(mutationFn, { invalidate = [], success } = {}) {
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

// ---------- skills ----------
export const useSkills = ({ includeArchived = false, enabled = true } = {}) => useQuery({
  queryKey: ['skills', includeArchived], enabled,
  queryFn: () => api.get('/skills', includeArchived ? { include_archived: 'true' } : undefined),
})
const skillKeys = [['skills'], ['profile'], ['users'], ['members'], ['milestones']]
export const useCreateSkill = () => useWorkflowMutation((body) => api.post('/skills', body),
  { invalidate: skillKeys, success: (s) => `Added ${s.name}` })
export const useRenameSkill = () => useWorkflowMutation(({ id, name }) => api.put(`/skills/${id}`, { name }),
  { invalidate: skillKeys, success: (s) => `Renamed to ${s.name}` })
export const useArchiveSkill = () => useWorkflowMutation((s) => api.del(`/skills/${s.id}`),
  { invalidate: skillKeys, success: (_, s) => `Archived ${s.name}` })
export const useRestoreSkill = () => useWorkflowMutation((s) => api.post(`/skills/${s.id}/restore`),
  { invalidate: skillKeys, success: (s) => `Restored ${s.name}` })
export const useSetUserSkills = (userId) => useWorkflowMutation(
  (skillIds) => api.put(`/users/${userId}/skills`, { skill_ids: skillIds }),
  { invalidate: [['profile', userId], ['users'], ['members']], success: 'Skills saved' })

// ---------- progress updates, kickbacks, history ----------
const milestoneKeys = (projectId, milestoneId) => [['milestones', projectId], ['milestone-updates', milestoneId],
  ['milestone-history', milestoneId], ['project', projectId], ['projects'], ['dashboard'], ['insights']]

export const useMilestoneUpdates = (milestoneId, enabled = true) => useQuery({
  queryKey: ['milestone-updates', milestoneId], enabled,
  queryFn: () => api.get(`/milestones/${milestoneId}/updates`),
})
export const usePostUpdate = (projectId, milestoneId) => useWorkflowMutation(
  (body) => api.post(`/milestones/${milestoneId}/updates`, body),
  { invalidate: milestoneKeys(projectId, milestoneId), success: 'Update posted' })

export const useMilestoneHistory = (milestoneId, enabled = true) => useQuery({
  queryKey: ['milestone-history', milestoneId], enabled,
  queryFn: () => api.get(`/milestones/${milestoneId}/history`),
})
export const useKickBack = (projectId, milestoneId) => useWorkflowMutation(
  (body) => api.post(`/milestones/${milestoneId}/kickback`, body),
  { invalidate: [...milestoneKeys(projectId, milestoneId), ['notifications']],
    success: 'Kicked back. Your manager has been told.' })
export const useResolveKickback = (projectId, milestoneId) => useWorkflowMutation(
  (body) => api.post(`/milestones/${milestoneId}/kickback/resolve`, body),
  { invalidate: [...milestoneKeys(projectId, milestoneId), ['notifications']],
    success: (_, v) => (v.resolution === 'returned' ? 'Returned to the team' : 'Put back in the queue') })
