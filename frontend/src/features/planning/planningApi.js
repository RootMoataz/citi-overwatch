// Planning board API hooks. Cards are the project's milestones (the ['milestones', id] cache the Milestones tab
// uses), so edits made in MilestoneDialog show on the board without anything extra.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.js'
import { useToast } from '../../app/toast.js'
import { applyOrder } from './board.js'

const keys = (projectId) => ({ milestones: ['milestones', projectId], plan: ['plan', projectId] })

/** The plan's state (status, finalized date, who may edit) and every finalize check. */
export const usePlan = (projectId) =>
  useQuery({ queryKey: keys(projectId).plan, queryFn: () => api.get(`/projects/${projectId}/plan`) })

/** Save the board's order. Optimistic: the cards move at once and jump back if the server says no. */
export function useReorderPlan(projectId) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const k = keys(projectId)
  return useMutation({
    mutationFn: (items) => api.put(`/projects/${projectId}/plan/order`, { items }),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: k.milestones })
      const before = queryClient.getQueryData(k.milestones)
      if (before) queryClient.setQueryData(k.milestones, applyOrder(before, items))
      return { before }
    },
    onError: (err, _items, context) => {
      if (context?.before) queryClient.setQueryData(k.milestones, context.before)
      toast.error?.(`Couldn't move that card: ${err.message}`)
    },
    onSuccess: (milestones) => { if (Array.isArray(milestones)) queryClient.setQueryData(k.milestones, milestones) },
    onSettled: () => queryClient.invalidateQueries({ queryKey: k.plan }),
  })
}

/** Quick add: a card with just a name, dated across the whole project until someone edits it, placed at the end of
 * its column. Resolves to the new milestone. */
export function useQuickAddCard(projectId) {
  const queryClient = useQueryClient()
  const k = keys(projectId)
  return useMutation({
    mutationFn: async ({ name, project, column, columns }) => {
      const created = await api.post(`/projects/${projectId}/milestones`,
        { name, start_date: project.start_date, end_date: project.predicted_end_date })
      const ids = columns[column]
      await api.put(`/projects/${projectId}/plan/order`,
        { items: [{ milestone_id: String(created.id), plan_column: column, sequence: ids.length + 1 }] })
      return { ...created, plan_column: column, sequence: ids.length + 1 }
    },
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: k.milestones }),
      queryClient.invalidateQueries({ queryKey: k.plan }), queryClient.invalidateQueries({ queryKey: ['project', projectId] })]),
  })
}

/** Finalize: 422 PLAN_INVALID carries the checks (err.details.checks). On success the project is active. */
export function useFinalizePlan(projectId) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/plan/finalize`),
    onSuccess: async (data) => {
      await Promise.all([['project', projectId], ['projects'], ['plan', projectId], ['milestones', projectId],
        ['project-summary', projectId], ['dashboard'], ['notifications']]
        .map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      toast.success(`Plan finalized. ${data.project.name} is now active, starting with ${data.first_milestone.name}`)
    },
  })
}
