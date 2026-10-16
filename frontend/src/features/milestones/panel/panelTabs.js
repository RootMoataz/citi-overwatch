/** The milestone panel's tabs, in order; `?panel=` carries one of these values. */
export const PANEL_TABS = ['details', 'approvals', 'discussion', 'worklog', 'history', 'notes']

const LABELS = {
  details: 'Details', approvals: 'Approvals', discussion: 'Discussion', worklog: 'Work log', history: 'History', notes: 'Notes',
}

/** The tabs this viewer has: Approvals only for people who decide hours (`view.decides`). */
export const panelTabsFor = (view) => PANEL_TABS
  .filter((value) => value !== 'approvals' || view?.decides)
  .map((value) => ({ value, label: LABELS[value] }))

/** The tab a `?panel=` value opens: itself when the viewer has it, else Details (a typo, or another role's link). */
export const panelTabFor = (view, panel) => (panelTabsFor(view).some((t) => t.value === panel) ? panel : 'details')
