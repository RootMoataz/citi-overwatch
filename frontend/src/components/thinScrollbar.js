/** A thin scrollbar that stays drawn (overlay scrollbars hide until you scroll), for a box that scrolls sideways. */
export const thinScrollbar = (t) => ({
  scrollbarWidth: 'thin',
  scrollbarColor: `${t.palette.action.disabled} transparent`,
  '&::-webkit-scrollbar': { height: 8 },
  '&::-webkit-scrollbar-thumb': { backgroundColor: t.palette.action.disabled, borderRadius: 4 },
})
