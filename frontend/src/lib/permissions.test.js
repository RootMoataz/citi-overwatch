import { describe, expect, test } from 'vitest'
import { can, canViewProfile } from './permissions.js'
import { users } from '../test/render.jsx'

const { admin, manager, employee } = users
const ownProject = { managerId: manager.id }
const otherProject = { managerId: 'someone-else' }

describe('permissions mirror spec §2', () => {
  test('admin-only actions', () => {
    for (const action of ['user.manage', 'project.create', 'project.archive', 'request.decide', 'audit.view']) {
      expect(can(admin, action)).toBe(true)
      expect(can(manager, action)).toBe(false)
      expect(can(employee, action)).toBe(false)
    }
  })

  test('admins and managers open the archive; employees do not', () => {
    expect(can(admin, 'archive.view')).toBe(true)
    expect(can(manager, 'archive.view')).toBe(true)
    expect(can(employee, 'archive.view')).toBe(false)
  })

  test('only managers submit project requests', () => {
    expect(can(manager, 'request.submit')).toBe(true)
    expect(can(admin, 'request.submit')).toBe(false)
    expect(can(employee, 'request.submit')).toBe(false)
  })

  test('permissions: admin inherits manager rights', () => {
    for (const action of ['project.manage', 'milestone.manage', 'milestone.progress']) {
      expect(can(admin, action, otherProject)).toBe(true)
      expect(can(manager, action, ownProject)).toBe(true)
      expect(can(manager, action, otherProject)).toBe(false)
    }
  })

  test('permissions: employee can progress only assigned milestone', () => {
    expect(can(employee, 'milestone.progress', { ...otherProject, assigneeIds: [employee.id] })).toBe(true)
    expect(can(employee, 'milestone.progress', { ...otherProject, assigneeIds: ['x'] })).toBe(false)
    expect(can(employee, 'milestone.manage', { ...otherProject, assigneeIds: [employee.id] })).toBe(false)
  })

  test('nobody approves their own hours', () => {
    expect(can(manager, 'time.approve', { ...ownProject, ownerId: employee.id })).toBe(true)
    expect(can(manager, 'time.approve', { ...ownProject, ownerId: manager.id })).toBe(false)
    expect(can(admin, 'time.approve', { ...otherProject, ownerId: admin.id })).toBe(false)
  })

  test('navigation sections', () => {
    expect(can(employee, 'approvals.view')).toBe(false)
    expect(can(manager, 'approvals.view')).toBe(true)
    expect(can(manager, 'people.view')).toBe(false)
    expect(can(admin, 'people.view')).toBe(true)
    expect(can(null, 'project.create')).toBe(false)
    expect(can(admin, 'unknown.action')).toBe(false)
  })
})

describe('canViewProfile mirrors the server rule (users/profile.py)', () => {
  const managed = { id: 'p1', manager: { id: manager.id }, is_archived: false }
  const someoneElses = { id: 'p2', manager: { id: 'u-other-mgr' }, is_archived: false }

  test('admins open anyone; everybody opens their own', () => {
    expect(canViewProfile(admin, 'u-anyone')).toBe(true)
    for (const viewer of [admin, manager, employee]) expect(canViewProfile(viewer, viewer.id)).toBe(true)
  })

  test('employees open nobody else, whatever the context', () => {
    expect(canViewProfile(employee, 'u-colleague')).toBe(false)
    expect(canViewProfile(employee, 'u-colleague', { project: managed, managed: true })).toBe(false)
    expect(canViewProfile(employee, manager.id)).toBe(false)
  })

  test("managers open people on a live project they manage, or in a list the server scoped to their people", () => {
    expect(canViewProfile(manager, 'u-member', { project: managed })).toBe(true)
    expect(canViewProfile(manager, 'u-member', { project: { managerId: manager.id } })).toBe(true)
    expect(canViewProfile(manager, 'u-member', { managed: true })).toBe(true)
    expect(canViewProfile(manager, 'u-member', { project: someoneElses })).toBe(false)
    expect(canViewProfile(manager, 'u-member', { project: { ...managed, is_archived: true } })).toBe(false)
    expect(canViewProfile(manager, 'u-member')).toBe(false)                  // no context: can't tell, so no link
  })

  test('nobody signed in, or no person (the "System" actor), is never a link', () => {
    expect(canViewProfile(null, 'u-anyone')).toBe(false)
    expect(canViewProfile(admin, null)).toBe(false)
  })
})
