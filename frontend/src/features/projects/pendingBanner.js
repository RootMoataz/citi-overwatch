// The "<N>h awaiting approval" banners on the Budget and Hours tabs: MUI's Alert puts its action higher than the text,
// so the banner centres its parts and the action slot drops its top padding, keeping the link on the message's line.
export const BANNER_PROPS = { sx: { alignItems: 'center' }, slotProps: { action: { sx: { pt: 0, alignItems: 'center' } } } }
