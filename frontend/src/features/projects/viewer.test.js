import { describe, expect, test } from 'vitest'
import { users } from '../../test/render.jsx'
import { projectView } from './viewer.js'

const project = (over = {}) => ({ id: 'p1', manager: { id: users.manager.id }, is_archived: false, ...over })
const otherManager = { ...users.manager, id: 'u-other-mgr' }

describe('projectView', () => {
  const flags = (lead, manage, decides, executive, mine) => ({ lead, manage, decides, executive, mine })
  test.each([
    ['admin', users.admin, false, flags(true, true, true, false, false)],
    ['admin', users.admin, true, flags(true, false, true, false, false)],
    ['manager (own)', users.manager, false, flags(true, true, true, false, false)],
    ['manager (own)', users.manager, true, flags(true, false, true, false, false)],
    ["manager (another's project)", otherManager, false, flags(false, false, true, false, true)],
    ["manager (another's project)", otherManager, true, flags(false, false, true, false, true)],
    ['employee', users.employee, false, flags(false, false, false, false, true)],
    ['employee', users.employee, true, flags(false, false, false, false, true)],
    ['executive', users.executive, false, flags(false, false, false, true, false)],
    ['executive', users.executive, true, flags(false, false, false, true, false)],
  ])('%s, archived=%s', (_, user, archived, expected) => {
    expect(projectView(user, project({ is_archived: archived }))).toEqual(expected)
  })
})
