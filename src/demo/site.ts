// Public contact details shown in the demo's footer. Empty string ⇒ that link is
// not rendered, so the site can ship before a value is known.
export const SITE = {
  /** Personal LinkedIn profile, e.g. https://www.linkedin.com/in/your-name */
  linkedinUrl: 'https://www.linkedin.com/in/prathameshvj/',
  /** Contact address for the footer's mailto link. */
  contactEmail: 'pratameshjadhav@gmail.com',
}

/** The URL if it is an https LinkedIn profile/company URL, else null. Guards the
 *  footer's href against a typo that would turn it into a broken or unsafe link
 *  (`javascript:` or a lookalike domain). */
export function linkedinHref(url: string): string | null {
  try {
    const u = new URL(url)
    const okHost = u.hostname === 'linkedin.com' || u.hostname.endsWith('.linkedin.com')
    return u.protocol === 'https:' && okHost && /^\/(in|company)\/[^/]+/.test(u.pathname) ? u.href : null
  } catch {
    return null
  }
}

/** `mailto:` href for a plausible address, else null. */
export function mailtoHref(email: string): string | null {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email) ? `mailto:${email}` : null
}
