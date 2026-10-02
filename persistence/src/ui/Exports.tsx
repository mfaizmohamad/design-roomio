/**
 * Exports section (brief §5): image snapshot, furniture shopping list, floor-plan
 * PDF. The flythrough VIDEO is Agent B's (camera_path + F6 MP4 exporter) — surfaced
 * here as a hand-off, not rebuilt. Each export produces a real downloadable file.
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { RoomioDesign } from '../envelope/types'
import { exportImagePNG, exportShoppingCSV, exportFloorPlanPDF } from '../export/exporters'
import { T, btnGhost } from '../ui/theme'

export function ExportsSection({ design }: { design: RoomioDesign }) {
  const [done, setDone] = useState<string | null>(null)
  const flash = (label: string) => {
    setDone(label)
    setTimeout(() => setDone((d) => (d === label ? null : d)), 1600)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          style={btnGhost}
          data-testid="export-image"
          onClick={() => { if (exportImagePNG(design)) flash('image') }}
        >
          🖼 Image (PNG)
        </button>
        <button
          style={btnGhost}
          data-testid="export-shopping"
          onClick={() => { if (exportShoppingCSV(design)) flash('shopping') }}
        >
          🧾 Shopping list (CSV)
        </button>
        <button
          style={btnGhost}
          data-testid="export-pdf"
          onClick={() => { if (exportFloorPlanPDF(design)) flash('pdf') }}
        >
          📐 Floor-plan PDF
        </button>
        <button
          style={{ ...btnGhost, opacity: 0.6, cursor: 'default' }}
          data-testid="export-video"
          title="The flythrough video is produced by Roomio's camera tool (Agent B's MP4 export) in the editor."
          disabled
        >
          🎬 Flythrough video — in editor
        </button>
      </div>
      {done && <div style={doneNote}>Downloaded {labelFor(done)} ✓</div>}
    </div>
  )
}

function labelFor(k: string): string {
  return k === 'image' ? 'image' : k === 'shopping' ? 'shopping list' : 'floor-plan PDF'
}

const doneNote: CSSProperties = { fontSize: 12, color: T.good, fontWeight: 600 }
