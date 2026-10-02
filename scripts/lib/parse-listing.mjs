/**
 * Pure helpers to turn a raw Facebook flatmate-group post into structured listing
 * fields for Roomio's "no-broker" flat listings. Product decision: BE OPEN — we do
 * NOT redact phone numbers from the text; we also surface them as tel: links for a
 * one-tap Call button. No parsing failure throws; everything degrades to null/[].
 */

// Mumbai (+ a few Pune) localities, longest-first so "Andheri East" wins over "Andheri".
export const AREAS = [
  'Andheri East', 'Andheri West', 'Andheri', 'Lower Parel', 'Navi Mumbai', 'Mira Road', 'Koregaon Park',
  'Bandra', 'Borivali', 'Malad', 'Goregaon', 'Jogeshwari', 'Kandivali', 'Dahisar', 'Powai', 'Chembur',
  'Kurla', 'Ghatkopar', 'Vikhroli', 'Mulund', 'Thane', 'Airoli', 'Ghansoli', 'Kopar Khairane', 'Vashi',
  'Nerul', 'Seawoods', 'Belapur', 'Kharghar', 'Panvel', 'Dadar', 'Parel', 'Worli', 'Colaba', 'Churchgate',
  'Santacruz', 'Khar', 'Vile Parle', 'Juhu', 'Versova', 'Marol', 'Sakinaka', 'Vasai', 'Virar', 'Bhayandar',
  'Kalyan', 'Dombivli', 'Wadala', 'Sion', 'Matunga', 'Mahim', 'Kharadi', 'Hinjewadi', 'Wakad', 'Baner',
  'Hadapsar', 'Viman Nagar', 'Kharadi', 'Goregaon East', 'Goregaon West', 'Malad East', 'Malad West',
]

/** All distinct Indian mobile numbers found in `text`, normalized to 10 digits. */
export function extractPhones(text = '') {
  const phones = new Set()
  // a mobile is 10 digits starting 6-9, optionally +91/91/0-prefixed, with spaces/dashes/dots between
  const re = /(?:\+?91[\s\-.]?|0)?([6-9](?:[\s\-.]?\d){9})(?!\d)/g
  let m
  while ((m = re.exec(text))) {
    const digits = (m[0] || '').replace(/\D/g, '')
    let ten = digits
    if (ten.length === 12 && ten.startsWith('91')) ten = ten.slice(2)
    else if (ten.length === 11 && ten.startsWith('0')) ten = ten.slice(1)
    if (ten.length === 10 && /^[6-9]/.test(ten)) phones.add(ten)
  }
  return [...phones]
}

/** Normalize "15k" / "15,000" / "15000" / "1.5 lakh" to a rupee integer, else null. */
function toRupees(raw) {
  if (!raw) return null
  let s = raw.toLowerCase().replace(/[,\s₹]/g, '')
  let n
  if (/lakh|lac/.test(s)) n = parseFloat(s) * 100000
  else if (s.endsWith('k')) n = parseFloat(s) * 1000
  else n = parseFloat(s)
  if (!isFinite(n)) return null
  n = Math.round(n)
  return n >= 2000 && n <= 500000 ? n : null // plausible monthly-rent range
}

export function parseListing(text = '') {
  const t = ' ' + text.toLowerCase() + ' '

  // rent — prefer a value near a rent/budget keyword, else the first ₹/k-looking amount
  let rent = null
  const near = t.match(/(?:rent|budget|rentals?|per month|pm)\D{0,12}(₹?\s?\d{1,3}(?:[.,]\d{3})+|₹?\s?\d{4,6}|\d{1,3}\.?\d?\s?k|\d(?:\.\d)?\s?(?:lakh|lac))/i)
  const any = t.match(/₹\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,6}|\d{1,3}\s?k)/i) || t.match(/\b(\d{1,3}\s?k)\b/i)
  rent = toRupees((near && near[1]) || (any && any[1])) || null

  // BHK / RK
  const bhkM = t.match(/\b(\d)\s?(bhk|rk)\b/i)
  const bhk = bhkM ? `${bhkM[1]}${bhkM[2].toUpperCase()}` : null

  // locality (first match, longest-name priority). Word-boundary match so "Sion"
  // doesn't match "viSIONary"/"incluSION" — a real bug that mislabelled spam posts.
  let location = null
  for (const a of AREAS) {
    const re = new RegExp('\\b' + a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
    if (re.test(t)) { location = a; break }
  }

  // gender preference (check "female" before "male" — it contains "male")
  const gender = /\b(female|girls?|ladies|women)\b/.test(t) ? 'female'
    : /\b(male|boys?|gents|men)\b/.test(t) ? 'male' : null

  // occupancy
  const occM = t.match(/\b(single|double|triple|twin)\s*(?:occupancy|sharing|occ)\b/i)
  const occupancy = occM ? occM[1].toLowerCase() : null

  const kind = classifyKind(t)
  return { rent, bhk, location, gender, occupancy, kind }
}

/**
 * OFFERING (someone posting a flat/room they HAVE — the listings we keep) vs
 * SEEKING (someone ASKING for a place — we drop these). Seeking is detected first
 * because "looking for a flat/room" is the clearest signal; note "looking for a
 * FLATMATE/roommate" is OFFERING (they have the place, want a person).
 * `t` must be lower-cased and space-padded.
 */
export function classifyKind(t) {
  const seek = /\b(?:looking for|need|require|searching(?: for)?|in search of|want|wanted|hunting for|any(?:one|body)? (?:has|have|with))\b[^.!?\n]{0,40}\b(?:flat|room|\d\s?[br]k|place|apartment|pg|accommodation|studio|house|space|paying guest|1rk|to stay|to rent|on rent)\b/
  const offer = /\b(available|for rent|on rent|vacant|to let|rent out|room available|pg available|bed available|occupancy available|for sale|immediate possession|ready to move|semi[- ]?furnished|fully[- ]?furnished|carpet area|sq\.?\s?ft|sqft|possession)\b/
  // "flatmate wanted", or "looking for a [male/female/working…] flatmate" (allow up to
  // 2 adjectives between the article and the noun). This means they HAVE a place.
  const offerFlatmate = /\b(?:flat ?mate|room ?mate|tenant|paying guest)\s+(?:wanted|required|needed|available)\b|\b(?:looking for|need(?:ed)?|require)\s+(?:a |an )?(?:\w+\s+){0,2}(?:flat ?mate|room ?mate|tenant|paying guest)\b/
  // priority: "flatmate/roommate wanted" (or "looking for a flatmate") means they HAVE
  // a place → OFFERING, even though "room" appears; only then treat "looking for a
  // flat/room" as SEEKING; then generic offer signals.
  if (offerFlatmate.test(t)) return 'offering'
  if (seek.test(t)) return 'seeking'
  if (offer.test(t)) return 'offering'
  return null
}

/** Rough "minutes ago" for a Facebook relative timestamp ("5m","3h","2d","Yesterday","just now"). */
export function relativeToMinutes(rel = '') {
  if (!rel) return null
  const s = rel.toLowerCase().trim()
  if (!s) return null
  if (/just now|now|a few seconds/.test(s)) return 0
  if (/yesterday/.test(s)) return 24 * 60
  const m = s.match(/(\d+)\s*(m|min|mins|minute|h|hr|hrs|hour|d|day|days|w|wk|week|weeks)\b/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  const u = m[2][0]
  return u === 'm' ? n : u === 'h' ? n * 60 : u === 'd' ? n * 1440 : u === 'w' ? n * 10080 : null
}
