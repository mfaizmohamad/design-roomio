/**
 * Minimal, dependency-free PDF writer — embeds a JPEG (our rendered floor plan)
 * as a full-page image with a title block, producing a REAL downloadable `.pdf`
 * (brief §5 floor-plan PDF; DoD: "real downloadable artifacts"). PDF natively
 * supports JPEG via the DCTDecode filter, so we embed the JPEG bytes directly.
 *
 * Pure: takes JPEG bytes + dimensions + title text, returns the PDF bytes. The
 * structure is the canonical 6-object single-page form with a correct xref table.
 */
export interface PdfImageOptions {
  title?: string
  subtitle?: string
  /** page size in points; default A4 landscape (842 × 595). */
  pageWidth?: number
  pageHeight?: number
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/**
 * Fold to ASCII so the standard Helvetica (StandardEncoding) renders the text
 * correctly. Common typographic chars map to readable ASCII; anything else is
 * dropped. (A WinAnsi-encoded font + full mapping would be overkill here.)
 */
function asciiize(s: string): string {
  return s
    .replace(/[—–]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[·•]/g, '-')
    .replace(/…/g, '...')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, '')
}

function pdfEscape(s: string): string {
  return asciiize(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3)
}

/** Build a one-page PDF that places `jpeg` (imgW×imgH) full-page with a title. */
export function pdfFromJpeg(jpeg: Uint8Array, imgW: number, imgH: number, opts: PdfImageOptions = {}): Uint8Array {
  const PW = opts.pageWidth ?? 842
  const PH = opts.pageHeight ?? 595
  const margin = 40
  const titleY = PH - 48
  const subY = PH - 66
  const topPad = opts.title || opts.subtitle ? 86 : margin

  const availW = PW - margin * 2
  const availH = PH - topPad - margin
  const scale = Math.min(availW / imgW, availH / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  const imgX = margin + (availW - drawW) / 2
  const imgY = margin + (availH - drawH) / 2

  let content = ''
  if (opts.title) {
    content += `BT /F1 18 Tf ${num(margin)} ${num(titleY)} Td (${pdfEscape(opts.title)}) Tj ET\n`
  }
  if (opts.subtitle) {
    content += `BT /F1 10 Tf ${num(margin)} ${num(subY)} Td (${pdfEscape(opts.subtitle)}) Tj ET\n`
  }
  content += `q ${num(drawW)} 0 0 ${num(drawH)} ${num(imgX)} ${num(imgY)} cm /Im0 Do Q\n`
  const contentBytes = latin1(content)

  const objects: Array<Uint8Array> = []
  objects[1] = latin1('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = latin1('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects[3] = latin1(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PW)} ${num(PH)}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>`,
  )
  objects[6] = latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  // Assemble the file, recording byte offsets for the xref table.
  const parts: Uint8Array[] = []
  let len = 0
  const push = (b: Uint8Array) => {
    parts.push(b)
    len += b.length
  }
  const pushStr = (s: string) => push(latin1(s))
  const offsets: number[] = new Array(7).fill(0)

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')

  const writeSimpleObj = (n: number) => {
    offsets[n] = len
    pushStr(`${n} 0 obj\n`)
    push(objects[n])
    pushStr('\nendobj\n')
  }

  writeSimpleObj(1)
  writeSimpleObj(2)
  writeSimpleObj(3)

  // obj 4: content stream
  offsets[4] = len
  pushStr(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`)
  push(contentBytes)
  pushStr('\nendstream\nendobj\n')

  // obj 5: image XObject (JPEG / DCTDecode)
  offsets[5] = len
  pushStr(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  )
  push(jpeg)
  pushStr('\nendstream\nendobj\n')

  writeSimpleObj(6)

  // xref
  const xrefOffset = len
  let xref = 'xref\n0 7\n0000000000 65535 f \n'
  for (let i = 1; i <= 6; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pushStr(xref)
  pushStr(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  // concat
  const out = new Uint8Array(len)
  let p = 0
  for (const b of parts) {
    out.set(b, p)
    p += b.length
  }
  return out
}
