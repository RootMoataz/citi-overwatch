// Mirrors the backend permission matrix (spec §2) so the UI can hide or disable actions.
// The backend always re-checks; this only shapes what people see.

const isAdmin = (user) => user?.role === 'admin'
const isManager = (user) => user?.role === 'manager'
const isExecutive = (user) => user?.role === 'executive'
const same = (a, b) => a != null && b != null && String(a) === String(b)

/** Admins manage every project; a manager manages projects where they are the manager. */
export function manages(user, resource = {}) {
  return isAdmin(user) || (isManager(user) && same(resource.managerId, user?.id))
}

/** Executives see what an admin sees for delivery oversight but change nothing (the server refuses every write).
 * Every write check below already answers no for them; this is for labelling the view as read-only. */
export function isReadOnly(user) {
  return isExecutive(user)
}

export function can(user, action, resource = {}) {
  if (!user) return false
  switch (action) {
    case 'user.manage':
    case 'project.create':
    case 'project.archive':
    case 'request.decide':
    case 'people.view':
    case 'milestone.restore':
    case 'departments.manage':
      return isAdmin(user)
    case 'request.submit':
      return isManager(user)
    case 'history.own':
      return user.role === 'employee'
    case 'messages.use':
      return true // every role; who they may write to is the server's contact list (backend rules/messaging.py)
    case 'timesheet.use':
      // Employees log hours; managers and admins only when an admin turned on "Tracks own hours" for them
      // (backend app/rules/timesheets.py). Executives never: they're read-only.
      return user.role === 'employee' || ((isAdmin(user) || isManager(user)) && Boolean(user.tracks_own_hours))
    case 'timesheets.view':
      return isAdmin(user) || isManager(user) || isExecutive(user)
    case 'hr.view':
      return isAdmin(user) || isExecutive(user)
    case 'hr.submit':
      return isAdmin(user)
    case 'audit.view':
      return isAdmin(user) || isExecutive(user)
    case 'allocation.view':
    case 'archive.view':
      return isAdmin(user) || isManager(user) || isExecutive(user)
    case 'archive.everything':
      return isAdmin(user) || isExecutive(user)
    case 'projects.filterByManager':
      return isAdmin(user) || isExecutive(user)
    case 'approvals.view':
    case 'requests.view':
      return isAdmin(user) || isManager(user)
    case 'project.manage':
    case 'milestone.manage':
      return manages(user, resource)
    case 'milestone.progress':
      if (isExecutive(user)) return false
      return manages(user, resource) || (resource.assigneeIds ?? []).some((id) => same(id, user.id))
    case 'time.approve':
      // The project's manager, an admin, or the project's delegate approver (`delegated`: the server put the entry
      // in this person's queue because of an active delegation); never their own hours.
      return (manages(user, resource) || ((isManager(user) || isAdmin(user)) && Boolean(resource.delegated)))
        && !same(resource.ownerId, user.id)
    default:
      return false
  }
}

const managerIdOf = (project) => project?.manager?.id ?? project?.managerId ?? project?.manager_id

/**
 * Whether a person's name should open their profile. Mirrors the server (users/profile.py `_can_view`), which
 * answers 404 to anyone else: admins and executives see anyone and everyone sees themselves; a manager sees their direct reports,
 * the people on live projects they manage and anyone whose hours wait for their approval; employees see only
 * themselves. The screen can't know a manager's reach in general, so callers say where the person appears:
 * `project` — a project the person is on (its manager and archived flag decide), or `managed: true` — a list the
 * server already limited to the manager's own people (Allocation, the dashboard's people lists, Approvals).
 * Without context a manager gets plain text rather than a link that might lead nowhere.
 */
export function canViewProfile(viewer, personId, { project, managed = false } = {}) {
  if (!viewer || personId == null) return false
  if (isAdmin(viewer) || isExecutive(viewer) || same(personId, viewer.id)) return true
  if (!isManager(viewer)) return false
  if (managed) return true
  return Boolean(project) && !project.is_archived && same(managerIdOf(project), viewer.id)
}
