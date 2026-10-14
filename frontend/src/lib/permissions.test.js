import { describe, expect, test } from 'vitest'
import { can } from './permissions.js'
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
