// Browser-side email relay (EmailJS) for sign-in details.
//
// The live Lambda has no route to the internet, so the server can't send email (see docs/project/DECISIONS.md).
// When it reports email_sent: false, the admin's browser, which does have internet, sends the welcome or reset
// email through one fixed EmailJS template instead. This is off unless the three VITE_EMAILJS_* values are set
// at build time. Forgotten-password codes are never relayed: the code must not pass through the requester's browser.

export const EMAILJS_URL = 'https://api.emailjs.com/api/v1.0/email/send'

const INTRO = {
  welcome: 'An account has been set up for you on Citi Overwatch.',
  reset: 'Your Citi Overwatch password has been reset by an admin.',
}

function config() {
  const env = import.meta.env
  return { service: env.VITE_EMAILJS_SERVICE_ID, template: env.VITE_EMAILJS_TEMPLATE_ID, key: env.VITE_EMAILJS_PUBLIC_KEY }
}

export function relayConfigured() {
  const c = config()
  return Boolean(c.service && c.template && c.key)
}

/** Email someone their username and temporary password. Resolves true when EmailJS accepted it; never throws. */
export async function relayCredentials({ to, name, username, password, kind = 'welcome' }) {
  if (!relayConfigured() || !to) return false
  const c = config()
  try {
    const res = await fetch(EMAILJS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service_id: c.service,
        template_id: c.template,
        user_id: c.key,
        template_params: {
          to_email: to, to_name: name, username, temp_password: password, intro: INTRO[kind] ?? INTRO.welcome,
          signin_url: `${window.location.origin}/login`,
        },
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
