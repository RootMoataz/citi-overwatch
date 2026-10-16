// A clickable row (DataTable) or card (CardList) opens its record; a control inside it (a link, button, checkbox or menu
// item) does its own job instead, and the click must not also open the record.
const INTERACTIVE = 'a,button,input,select,textarea,label,[role="button"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="link"]'

/** Whether a click handled on a row or card (`e.currentTarget`) landed on a control inside it. */
export function onInnerControl(e) {
  const inner = e.target.closest?.(INTERACTIVE)
  return Boolean(inner && inner !== e.currentTarget && e.currentTarget.contains(inner))
}
