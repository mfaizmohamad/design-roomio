import { useRef, useState } from 'react'

type SavedEnquiry = { id: string; key: string }
type EnquiryFormProps = { releaseId: string }

const storageKey = (releaseId: string) => `roomio-enquiry:${releaseId}`
const readSaved = (releaseId: string): SavedEnquiry | null => {
  try {
    const raw = sessionStorage.getItem(storageKey(releaseId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'id' in parsed && 'key' in parsed &&
        typeof parsed.id === 'string' && typeof parsed.key === 'string') return parsed as SavedEnquiry
  } catch { /* A blocked or corrupt browser store must not stop browsing. */ }
  return null
}

/** Contact request for a published release; a request is never a booking confirmation. */
export function EnquiryForm({ releaseId }: EnquiryFormProps) {
  // Keep a failed network attempt's key: a server success followed by a lost
  // response must replay the same logical enquiry instead of creating a lead.
  const pendingKey = useRef<string | null>(null)
  const [saved, setSaved] = useState<SavedEnquiry | null>(() => readSaved(releaseId))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [contactConsent, setContactConsent] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!contactConsent) { setError('Please agree to be contacted about this home.'); return }
    if (!email.trim() && !phone.trim()) { setError('Enter an email address or phone number.'); return }
    const key = pendingKey.current ?? crypto.randomUUID()
    pendingKey.current = key
    setBusy(true)
    try {
      const response = await fetch(`/api/releases/${releaseId}/enquiries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: key, name: name.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
          contactConsent: { accepted: true, noticeVersion: 'pilot-v1' }, marketingConsent }),
      })
      if (!response.ok) throw new Error('We could not save your enquiry. Please try again.')
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') {
        throw new Error('We could not confirm your enquiry. Please try again.')
      }
      const next = { id: body.id, key }
      try { sessionStorage.setItem(storageKey(releaseId), JSON.stringify(next)) } catch { /* session storage is optional */ }
      setSaved(next)
      pendingKey.current = null
      setName(''); setEmail(''); setPhone(''); setMessage('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not save your enquiry.')
    } finally { setBusy(false) }
  }

  const withdraw = async () => {
    if (!saved) return
    setError(''); setBusy(true)
    try {
      const response = await fetch(`/api/releases/enquiries/${saved.id}`, {
        method: 'DELETE', headers: { 'X-Enquiry-Key': saved.key },
      })
      if (!response.ok) throw new Error('Withdrawal could not be completed. Please try again.')
      try { sessionStorage.removeItem(storageKey(releaseId)) } catch { /* optional */ }
      setSaved(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Withdrawal could not be completed.')
    } finally { setBusy(false) }
  }

  if (saved) return <section aria-label="Enquiry status">
    <p>Your request to be contacted was stored. It is not a booking or reservation.</p>
    <button type="button" disabled={busy} onClick={withdraw}>Withdraw and delete contact details</button>
    <p>This browser tab keeps a withdrawal key for this session. If you close it, contact the developer to request deletion.</p>
    {error && <p role="alert">{error}</p>}
  </section>

  return <form onSubmit={submit} aria-label="Enquire about this home">
    <h2>Ask about this home</h2>
    <p>Share your details only if you want the developer’s sales team to contact you about this published home. This request is not a booking or reservation.</p>
    <label>Name <input required maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>Email <input type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Phone (international format, e.g. +919876543210) <input type="tel" maxLength={16} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
    <label>Message (optional) <textarea maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
    <label><input type="checkbox" required checked={contactConsent} onChange={(event) => setContactConsent(event.target.checked)} /> I agree to be contacted about this home using the details above.</label>
    <label><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /> I separately agree to receive marketing updates.</label>
    <p>Your enquiry is stored for the developer’s sales team. You can withdraw in this browser session; contact the developer later to request deletion. A retention period will be stated in the developer’s published privacy notice before a live pilot.</p>
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Send enquiry'}</button>
    {error && <p role="alert">{error}</p>}
  </form>
}
