// The palette's searchable records, fetched only while it is open and shared with the pages' own caches:
// projects (the viewer's scoped list), departments, the people whose profiles the viewer may open, and the
// milestones of their projects. Nothing here polls: a palette is open for seconds.
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../api/client.js'
import { mondayOf } from '../../lib/format.js'

const QUIET = { refetchInterval: false, refetchOnWindowFocus: false, staleTime: 60000 }
/** Enough for any real portfolio; beyond this the milestone search covers the first projects alphabetically. */
export const MILESTONE_PROJECT_CAP = 40

export default function usePaletteData(user) {
  const sees = user?.role === 'admin' || user?.role === 'executive'
  const projects = useQuery({ queryKey: ['projects', {}], queryFn: () => api.get('/projects', { page_size: 100 }), ...QUIET })
  const departments = useQuery({ queryKey: ['departments', false], queryFn: () => api.get('/departments'), ...QUIET })
  // Admins and executives may open anyone's profile; a manager only their own people (the allocation list is
  // exactly that scope, as on the dashboard); an employee only themselves.
  const everyone = useQuery({ queryKey: ['users', 'list', {}], enabled: sees, ...QUIET,
    queryFn: () => api.get('/users', { page_size: 100 }) })
  const week = mondayOf(new Date())
  const team = useQuery({ queryKey: ['allocations', week], enabled: user?.role === 'manager', ...QUIET,
    queryFn: () => api.get('/allocations', { week }) })

  const projectItems = projects.data?.items ?? []
  const ids = projectItems.slice(0, MILESTONE_PROJECT_CAP).map((p) => p.id)
  const milestones = useQueries({
    queries: ids.map((id) => ({ queryKey: ['milestones', id], queryFn: () => api.get(`/projects/${id}/milestones`), ...QUIET })),
    combine: (results) => results.flatMap((r, i) => (r.data ?? []).map((m) => ({ ...m, project_id: m.project_id ?? ids[i] }))),
  })

  let people = []
  if (sees) people = (everyone.data?.items ?? []).map((p) => ({ ...p, name: `${p.first_name} ${p.last_name}` }))
  else if (user?.role === 'manager') {
    people = (team.data ?? []).map((r) => ({ ...r.user, context: { managed: true } }))
    if (!people.some((p) => String(p.id) === String(user.id))) people.push({ ...user, name: `${user.first_name} ${user.last_name}` })
  } else if (user) people = [{ ...user, name: `${user.first_name} ${user.last_name}` }]
  people = people.map((p) => ({ ...p, first_name: p.first_name ?? p.name?.split(' ')[0], last_name: p.last_name ?? p.name?.split(' ').slice(1).join(' ') }))

  return {
    projects: projectItems,
    departments: departments.data?.items ?? [],
    people,
    milestones,
    loading: projects.isLoading,
  }
}
