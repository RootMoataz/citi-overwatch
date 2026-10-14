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
    case 'archive.view':
    case 'people.view':
    case 'milestone.restore':
      return isAdmin(user)
    case 'request.submit':
      return isManager(user)
    case 'history.own':
      return user.role === 'employee'
    case 'approvals.view':
    case 'allocation.view':
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
