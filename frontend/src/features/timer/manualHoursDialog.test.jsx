import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { StrictMode, useState } from 'react'
import { useManualHours } from '../../api/queries.js'
import { setPrefersDark, setViewport } from '../../test/setup.js'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderWithProviders } from '../../test/render.jsx'
import ManualHoursDialog from './ManualHoursDialog.jsx'

const WEEK = '2026-10-12'
const milestone = { id: 'm1', name: 'Schema Mapping' }
const project = { name: 'Apollo Data Migration' }
const NOTE = 'Mapped the address fields'
const entry = (extra = {}) => ({ id: 'e1', milestone_id: 'm1', work_date: '2026-10-14', hours: 2.5, status: 'pending',
  note: NOTE, manual: { reason: 'meeting_or_call', details: null }, rejection_reason: null, updated_at: '2026-10-15T10:00:00+00:00',
  ...extra })

let weekRequests
let probeRequests
function weekHandler() {
  return http.get(`${API}/time-entries`, ({ request }) => {
    const week = new URL(request.url).searchParams.get('week')
    weekRequests.push(week)
    return HttpResponse.json({ week_start: week, rows: [], drafts: [], totals: { logged: week === WEEK ? 38 : 0, approved: 0 },
      entries: week === WEEK ? [entry({ id: 'x2', milestone_id: 'm2', work_date: '2026-10-14', hours: 6 })] : [] })
  })
}

function Probe() {
  useManualHours()
  return null
}
function Harness({ onClosed, ...props }) {
  const [shown, setShown] = useState(true)
  return (
    <>
      <Probe />
      {shown ? <ManualHoursDialog milestone={milestone} project={project} {...props}
        onClose={() => { setShown(false); onClosed?.() }} /> : <p>closed</p>}
    </>
  )
}
const open = (props = {}) => renderWithProviders(<Harness {...props} />)
const dialog = () => screen.getByRole('dialog')
const hoursBox = () => screen.getByRole('textbox', { name: /^Hours/ })
const notebox = () => screen.getByRole('textbox', { name: /^Work note/ })
const detailsBox = () => screen.getByRole('textbox', { name: /^Details/ })
const send = () => screen.getByRole('button', { name: 'Send for review' })

async function fill(user, { hours = '2.5', reason = 'Forgot to start the timer', details, note = NOTE } = {}) {
  await user.type(hoursBox(), hours)
  await user.click(screen.getByRole('radio', { name: reason }))
  if (details) await user.type(detailsBox(), details)
  if (note) await user.type(notebox(), note)
}

beforeEach(() => {
  weekRequests = []
  probeRequests = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
  server.use(weekHandler(), http.get(`${API}/manual-hours`, () => { probeRequests += 1; return HttpResponse.json([]) }))
})
afterEach(() => vi.useRealTimers())

describe('the frame', () => {
  // Hands-on walkthrough finding: opened from its button under StrictMode (as in `npm run dev`), the focus trap's second
  // effect run gave focus back to the button and then to the dialog box, so focus did not start on Hours.
  test('focus starts on Hours when the pop-up opens from its button under StrictMode', async () => {
    function Opener() {
      const [shown, setShown] = useState(false)
      return (
        <>
          <button onClick={() => setShown(true)}>Open it</button>
          {shown ? <ManualHoursDialog milestone={milestone} project={project} onClose={() => setShown(false)} /> : null}
        </>
      )
    }
    const user = userEvent.setup()
    renderWithProviders(<StrictMode><Opener /></StrictMode>)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await screen.findByRole('dialog', { name: 'Log hours manually' })
    await waitFor(() => expect(hoursBox()).toHaveFocus())
    await new Promise((r) => setTimeout(r, 50))
    expect(hoursBox()).toHaveFocus()
    expect(screen.queryByText('Between 0.25 and 24 hours')).not.toBeInTheDocument()
  })

  test('title, subtitle, focus, the reason group and a disabled Send', async () => {
    open()
    const d = await screen.findByRole('dialog', { name: 'Log hours manually' })
    expect(within(d).getByText('Schema Mapping · Apollo Data Migration')).toBeInTheDocument()
    await waitFor(() => expect(hoursBox()).toHaveFocus())
    const group = within(d).getByRole('group', { name: 'Why not the timer?' })
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label').textContent)).toEqual(['Forgot to start the timer',
      'Worked away from the computer', 'Meeting or call', 'Timer problem', 'Other'])
    expect(send()).toBeDisabled()
    expect(screen.getByText('Your manager reviews manual hours one by one. They count toward the budget once approved.')).toBeInTheDocument()
  })

  test('hours keep digits and a point, five characters at most', async () => {
    open()
    await userEvent.type(await screen.findByRole('textbox', { name: /^Hours/ }), 'a2,5.75x99')
    expect(hoursBox()).toHaveValue('25.75')
    expect(hoursBox()).toHaveAttribute('inputmode', 'decimal')
  })
})

describe('the day', () => {
  test('offers the eight days with today selected', async () => {
    const user = userEvent.setup()
    open()
    const select = await screen.findByRole('combobox', { name: 'Day' })
    expect(select).toHaveTextContent('Today, Thu 15 Oct')
    await user.click(select)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Today, Thu 15 Oct', 'Yesterday, Wed 14 Oct',
      'Tue 13 Oct', 'Mon 12 Oct', 'Sun 11 Oct', 'Sat 10 Oct', 'Fri 9 Oct', 'Thu 8 Oct'])
  })

  test('a day prop preselects it', async () => {
    open({ day: '2026-10-14' })
    expect(await screen.findByRole('combobox', { name: 'Day' })).toHaveTextContent('Yesterday, Wed 14 Oct')
  })

  test('today is the New York date, not the browser one', async () => {
    vi.setSystemTime(new Date('2026-10-16T02:30:00Z'))
    let body
    server.use(http.post(`${API}/manual-hours`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ entry: entry({ work_date: '2026-10-15' }), week_start: WEEK }, { status: 201 })
    }))
    const user = userEvent.setup()
    open()
    expect(await screen.findByRole('combobox', { name: 'Day' })).toHaveTextContent('Today, Thu 15 Oct')
    await fill(user)
    await user.click(send())
    await waitFor(() => expect(body?.work_date).toBe('2026-10-15'))
  })
})

describe('validation shows once a field has been left, and Send waits for all of them', () => {
  test.each([['0.2', 'Between 0.25 and 24 hours'], ['2.1', 'Use quarter hours: .25, .5 or .75'], ['25', 'Between 0.25 and 24 hours']])(
    'hours %s', async (text, message) => {
      const user = userEvent.setup()
      open()
      await user.type(await screen.findByRole('textbox', { name: /^Hours/ }), text)
      expect(screen.queryByText(message)).not.toBeInTheDocument()
      await user.tab()
      expect(screen.getByText(message)).toBeInTheDocument()
      expect(hoursBox()).toHaveAttribute('aria-invalid', 'true')
      expect(send()).toBeDisabled()
    })

  test('hours left empty are refused too', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('textbox', { name: /^Hours/ }))
    await user.tab()
    expect(screen.getByText('Between 0.25 and 24 hours')).toBeInTheDocument()
  })

  test('Other needs details of at least 10 characters', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('dialog')
    await fill(user, { reason: 'Other', details: 'Short' })
    await user.tab()
    expect(screen.getByText('Say what happened (at least 10 characters)')).toBeInTheDocument()
    expect(detailsBox()).toHaveAttribute('aria-invalid', 'true')
    expect(send()).toBeDisabled()
    await user.type(detailsBox(), ' and then some')
    expect(send()).toBeEnabled()
  })

  test('details count toward 500', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('dialog')
    expect(screen.getByText('0/500')).toBeInTheDocument()
    await user.click(detailsBox())
    await user.paste('x'.repeat(520))
    expect(screen.getByText('500/500')).toBeInTheDocument()
  })

  test('a reason is required', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('dialog')
    await user.type(hoursBox(), '2')
    await user.type(notebox(), NOTE)
    expect(send()).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Meeting or call' }))
    expect(send()).toBeEnabled()
  })

  test('Pick a reason shows once the group has been left without a choice', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('textbox', { name: /^Hours/ }))
    await user.tab() // into the radios
    expect(screen.queryByText('Pick a reason')).not.toBeInTheDocument()
    await user.tab() // out of them
    expect(screen.getByText('Pick a reason')).toBeInTheDocument()
    const radios = screen.getByRole('radiogroup')
    expect(radios).toHaveAccessibleDescription('Pick a reason')
    expect(radios).toHaveAttribute('aria-invalid', 'true')
  })

  test('the work note counts and refuses blanks', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('dialog')
    expect(screen.getByText('What you worked on · 0/500')).toBeInTheDocument()
    await user.type(notebox(), '          ')
    await user.tab()
    expect(screen.getByText('At least 10 characters')).toBeInTheDocument()
    expect(notebox()).toHaveAttribute('aria-invalid', 'true')
    await user.type(hoursBox(), '2')
    await user.click(screen.getByRole('radio', { name: 'Meeting or call' }))
    expect(send()).toBeDisabled()
  })
})

describe('hints', () => {
  test('what the day and the week already hold, and overtime', async () => {
    const user = userEvent.setup()
    open({ day: '2026-10-14' })
    expect(await screen.findByText('Already logged that day: 6h · that week: 38h')).toBeInTheDocument()
    await user.type(hoursBox(), '2')
    expect(screen.queryByText(/over 40h/)).not.toBeInTheDocument()
    await user.clear(hoursBox())
    await user.type(hoursBox(), '3')
    expect(screen.getByText('This takes your week over 40h, so it goes to your manager as overtime.')).toBeInTheDocument()
  })

  test('another day asks for its own week', async () => {
    const user = userEvent.setup()
    open({ day: '2026-10-14' })
    await screen.findByText('Already logged that day: 6h · that week: 38h')
    await user.click(screen.getByRole('combobox', { name: 'Day' }))
    await user.click(screen.getByRole('option', { name: 'Sun 11 Oct' }))
    await waitFor(() => expect(weekRequests).toContain('2026-10-05'))
    expect(await screen.findByText('Already logged that day: 0h · that week: 0h')).toBeInTheDocument()
  })

  test('editing leaves the entry itself out of both numbers', async () => {
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK, rows: [], drafts: [],
      totals: { logged: 38, approved: 0 }, entries: [entry({ id: 'x2', milestone_id: 'm2', hours: 6 }), entry()] })))
    open({ entry: entry() })
    expect(await screen.findByText('Already logged that day: 6h · that week: 35.5h')).toBeInTheDocument()
  })

  test('timer drafts of that day count, rejected entries do not', async () => {
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK, rows: [],
      drafts: [{ milestone_id: 'm3', work_date: '2026-10-14', hours: 1.5, note: '' }],
      totals: { logged: 10, approved: 0 }, entries: [entry({ id: 'x3', milestone_id: 'm2', hours: 4, status: 'approved' }),
        entry({ id: 'x4', milestone_id: 'm4', hours: 3, status: 'rejected' })] })))
    open({ day: '2026-10-14' })
    expect(await screen.findByText('Already logged that day: 5.5h · that week: 10h')).toBeInTheDocument()
  })
})

describe('sending', () => {
  test('one POST with the exact body, and a waiting button', async () => {
    const bodies = []
    let release
    const gate = new Promise((r) => { release = r })
    server.use(http.post(`${API}/manual-hours`, async ({ request }) => {
      bodies.push(await request.json())
      await gate
      return HttpResponse.json({ entry: entry(), week_start: WEEK }, { status: 201 })
    }))
    const user = userEvent.setup()
    open({ day: '2026-10-14' })
    await screen.findByRole('dialog')
    await fill(user, { details: '   ' })
    await user.dblClick(send())
    const waiting = await screen.findByRole('button', { name: 'Sending…' })
    expect(waiting).toBeDisabled()
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies).toEqual([{ milestone_id: 'm1', work_date: '2026-10-14', hours: '2.5', reason: 'forgot_timer',
      details: null, note: NOTE }])
    release()
    await screen.findByText('closed')
    expect(bodies).toHaveLength(1)
  })

  test('.5 enables Send and goes out as 0.5', async () => {
    let body
    server.use(http.post(`${API}/manual-hours`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ entry: entry({ hours: 0.5 }), week_start: WEEK }, { status: 201 })
    }))
    const user = userEvent.setup()
    open()
    await screen.findByRole('dialog')
    await fill(user, { hours: '.5' })
    expect(send()).toBeEnabled()
    await user.click(send())
    await waitFor(() => expect(body?.hours).toBe('0.5'))
  })

  test('an edit sends .5 as 0.5 too', async () => {
    let body
    server.use(http.put(`${API}/manual-hours/e1`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ entry: entry({ hours: 0.5 }) })
    }))
    const user = userEvent.setup()
    open({ entry: entry() })
    await screen.findByRole('dialog', { name: 'Edit manual hours' })
    await user.clear(hoursBox())
    await user.type(hoursBox(), '.5')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(body?.hours).toBe('0.5'))
  })

  test('details and note are sent trimmed', async () => {
    let body
    server.use(http.post(`${API}/manual-hours`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ entry: entry(), week_start: WEEK }, { status: 201 })
    }))
    const user = userEvent.setup()
    open()
    await screen.findByRole('dialog')
    await fill(user, { hours: '1', reason: 'Other', details: '  Power cut at the office  ', note: `  ${NOTE}  ` })
    await user.click(send())
    await waitFor(() => expect(body).toBeTruthy())
    expect(body).toMatchObject({ reason: 'other', details: 'Power cut at the office', note: NOTE, hours: '1' })
  })

  test('closes, toasts and refreshes the week and the manual list', async () => {
    server.use(http.post(`${API}/manual-hours`, () => HttpResponse.json({ entry: entry(), week_start: WEEK }, { status: 201 })))
    const user = userEvent.setup()
    open({ day: '2026-10-14' })
    await screen.findByRole('dialog')
    await fill(user)
    const weeksBefore = weekRequests.length
    const probeBefore = probeRequests
    await user.click(send())
    expect(await screen.findByText('Sent 2.5h on Schema Mapping (Wed 14 Oct) for review')).toBeInTheDocument()
    expect(screen.getByText('closed')).toBeInTheDocument()
    await waitFor(() => expect(weekRequests.length).toBeGreaterThan(weeksBefore))
    await waitFor(() => expect(probeRequests).toBeGreaterThan(probeBefore))
  })

  test('a server error shows in the dialog and keeps what was typed', async () => {
    server.use(http.post(`${API}/manual-hours`, () => HttpResponse.json({ error: { code: 'CELL_HAS_HOURS',
      message: 'Wed 14 Oct already has 3h on Schema Mapping. Change them on your timesheet.', request_id: 'r1' } }, { status: 409 })))
    const user = userEvent.setup()
    open({ day: '2026-10-14' })
    await screen.findByRole('dialog')
    await fill(user, { reason: 'Meeting or call' })
    await user.click(send())
    const alert = await screen.findByRole('alert')
    expect(within(dialog()).getByRole('alert')).toBe(alert)
    expect(alert).toHaveTextContent('Wed 14 Oct already has 3h on Schema Mapping. Change them on your timesheet.')
    expect(hoursBox()).toHaveValue('2.5')
    expect(screen.getByRole('radio', { name: 'Meeting or call' })).toBeChecked()
    expect(notebox()).toHaveValue(NOTE)
    expect(send()).toBeEnabled()
  })
})

describe('Esc', () => {
  test('closes when idle', async () => {
    const onClosed = vi.fn()
    const user = userEvent.setup()
    open({ onClosed })
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClosed).toHaveBeenCalled())
  })

  test('Cancel closes too', async () => {
    const onClosed = vi.fn()
    open({ onClosed })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onClosed).toHaveBeenCalled()
  })

  test('does nothing while sending', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    server.use(http.post(`${API}/manual-hours`, async () => {
      await gate
      return HttpResponse.json({ entry: entry(), week_start: WEEK }, { status: 201 })
    }))
    const onClosed = vi.fn()
    const user = userEvent.setup()
    open({ onClosed })
    await screen.findByRole('dialog')
    await fill(user)
    await user.click(send())
    await screen.findByRole('button', { name: 'Sending…' })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(onClosed).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
  })
})

describe('editing', () => {
  test('a pending entry: fields prefilled, day as text, Save changes sends a PUT', async () => {
    let body
    server.use(http.put(`${API}/manual-hours/e1`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ entry: entry({ hours: 3 }) })
    }))
    const user = userEvent.setup()
    open({ entry: entry() })
    const d = await screen.findByRole('dialog', { name: 'Edit manual hours' })
    expect(within(d).getByText('Wed 14 Oct')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Day' })).not.toBeInTheDocument()
    expect(hoursBox()).toHaveValue('2.5')
    expect(screen.getByRole('radio', { name: 'Meeting or call' })).toBeChecked()
    expect(notebox()).toHaveValue(NOTE)
    expect(screen.queryByRole('button', { name: 'Send for review' })).not.toBeInTheDocument()
    await user.clear(hoursBox())
    await user.type(hoursBox(), '3')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Sent 3h on Schema Mapping (Wed 14 Oct) for review')).toBeInTheDocument()
    expect(body).toEqual({ hours: '3', reason: 'meeting_or_call', details: null, note: NOTE })
  })

  test('a rejected entry: Fix and resubmit with the reviewer reason', async () => {
    let body
    server.use(http.put(`${API}/manual-hours/e1`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ entry: entry() })
    }))
    open({ entry: entry({ status: 'rejected', rejection_reason: 'Wrong day, please check',
      manual: { reason: 'other', details: 'Power cut at the office' } }) })
    const d = await screen.findByRole('dialog', { name: 'Fix and resubmit' })
    expect(within(d).getByText('Wrong day, please check')).toBeInTheDocument()
    expect(detailsBox()).toHaveValue('Power cut at the office')
    await userEvent.click(screen.getByRole('button', { name: 'Resubmit' }))
    await screen.findByText('closed')
    expect(body).toEqual({ hours: '2.5', reason: 'other', details: 'Power cut at the office', note: NOTE })
  })

  test('a server refusal such as NO_CHANGE shows and keeps the dialog', async () => {
    server.use(http.put(`${API}/manual-hours/e1`, () => HttpResponse.json({ error: { code: 'NO_CHANGE', message: 'Nothing changed' } },
      { status: 400 })))
    open({ entry: entry() })
    await screen.findByRole('dialog', { name: 'Edit manual hours' })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing changed')
    expect(dialog()).toBeInTheDocument()
  })
})

describe('phones and dark mode', () => {
  test('renders at 375px in dark mode without console errors', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    setViewport(375)
    setPrefersDark(true)
    open()
    expect(await screen.findByRole('dialog', { name: 'Log hours manually' })).toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
