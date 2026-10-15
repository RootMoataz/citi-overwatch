// Mirrors the backend permission matrix (spec §2) so the UI can hide or disable actions.
// The backend always re-checks; this only shapes what people see.

const isAdmin = (user) => user?.role === 'admin'
const isManager = (user) => user?.role === 'manager'
const same = (a, b) => a != null && b != null && String(a) === String(b)

/** Admins manage every project; a manager manages projects where they are the manager. */
export function manages(user, resource = {}) {
  return isAdmin(user) || (isManager(user) && same(resource.managerId, user?.id))
}

export function can(user, action, resource = {}) {
  if (!user) return false
  switch (action) {
    case 'user.manage':
    case 'project.create':
    case 'project.archive':
    case 'request.decide':
    case 'audit.view':
    case 'people.view':
    case 'milestone.restore':
    case 'departments.manage':
      return isAdmin(user)
    case 'request.submit':
      return isManager(user)
    case 'history.own':
      return user.role === 'employee'
    case 'approvals.view':
    case 'allocation.view':
    case 'archive.view':
    case 'requests.view':
      return isAdmin(user) || isManager(user)
    case 'project.manage':
    case 'milestone.manage':
      return manages(user, resource)
    case 'milestone.progress':
      return manages(user, resource) || (resource.assigneeIds ?? []).some((id) => same(id, user.id))
    case 'time.approve':
      return manages(user, resource) && !same(resource.ownerId, user.id)
    default:
      return false
  }
}

const managerIdOf = (project) => project?.manager?.id ?? project?.managerId ?? project?.manager_id

/**
 * Whether a person's name should open their profile. Mirrors the server (users/profile.py `_can_view`), which
 * answers 404 to anyone else: admins see anyone and everyone sees themselves; a manager sees their direct reports,
 * the people on live projects they manage and anyone whose hours wait for their approval; employees see only
 * themselves. The screen can't know a manager's reach in general, so callers say where the person appears:
 * `project` — a project the person is on (its manager and archived flag decide), or `managed: true` — a list the
 * server already limited to the manager's own people (Allocation, the dashboard's people lists, Approvals).
 * Without context a manager gets plain text rather than a link that might lead nowhere.
 */
export function canViewProfile(viewer, personId, { project, managed = false } = {}) {
  if (!viewer || personId == null) return false
  if (isAdmin(viewer) || same(personId, viewer.id)) return true
  if (!isManager(viewer)) return false
  if (managed) return true
  return Boolean(project) && !project.is_archived && same(managerIdOf(project), viewer.id)
}
