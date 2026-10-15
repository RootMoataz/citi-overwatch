import { GlobalStyles } from '@mui/material'

/**
 * The print stylesheet (Print / PDF on the dashboard and the Budget tab, or the browser's own print):
 * only the page content, on white, with no sidebar, top bar, buttons, filters or tabs; cards and table rows
 * don't split across pages; charts shrink to the page width. The light theme itself comes from usePrinting().
 */
const PRINT = {
  '@page': { margin: '12mm' },
  '@media print': {
    // The app shell paints the page background too, so the page and its outer wrappers go white.
    'html, body, #root, #root > div, main': { backgroundColor: '#fff !important', color: '#111C27', colorScheme: 'light' },
    '*': { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' },
    [['.MuiAppBar-root', '.MuiDrawer-root', 'nav', 'button', '.MuiButton-root', '.MuiIconButton-root', '[role="toolbar"]',
      '.MuiTextField-root', '.MuiAutocomplete-root', '.MuiTabs-root', '.MuiSnackbar-root', '.MuiTooltip-popper',
      '[data-print="hide"]'].join(', ')]: { display: 'none !important' },
    '[data-print="only"]': { display: 'block !important' },
    main: { padding: '0 !important', margin: '0 !important', maxWidth: 'none !important', width: '100% !important' },
    '.MuiPaper-root, .MuiCard-root': { boxShadow: 'none !important', backgroundColor: '#fff !important' },
    '.MuiPaper-root, .MuiCard-root, section, tr, li, .MuiChartsWrapper-root': { breakInside: 'avoid', pageBreakInside: 'avoid' },
    'h1, h2, h3': { breakAfter: 'avoid', pageBreakAfter: 'avoid' },
    '.MuiChartsWrapper-root, .MuiChartsSurface-root': { maxWidth: '100% !important' },
    'svg.MuiChartsSurface-root': { width: '100% !important', height: 'auto !important' },
    a: { color: 'inherit !important', textDecoration: 'none !important' },
  },
}

export default function PrintStyles() {
  return <GlobalStyles styles={PRINT} />
}
