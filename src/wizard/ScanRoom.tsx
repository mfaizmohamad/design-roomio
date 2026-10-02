import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { ARCHETYPES, CATEGORY_ORDER } from '../data/archetypes'
import {
  requestDetection,
  fetchDetection,
  SAMPLE_IDS,
  type DetectionResult,
  type Proposal,
} from '../detect'

// "Scan a room photo" — suggestion-only detection UI. The user uploads a photo
// (or tries a committed sample fixture); we poll the server for proposals and
// render one confirmable row per proposal. Nothing is added to the design until
// the user clicks "Add" (or "Add all"); the dropdown lets them correct a guess.
//
// Inline-styled (no src/index.css edits) to match the IKEA-clean look: white
// card, rounded corners, subtle #e6e3dd borders.

const POLL_INTERVAL_MS = 1500
// ~120s budget: the first scan after the watcher/model is cold (model load + a
// large photo) can take over a minute; a 60s cap timed those out spuriously.
const MAX_POLLS = 80

const BORDER = '#e6e3dd'

/** Per-row UI state: the (possibly corrected) archetype id + whether it's added. */
interface RowState {
  archetypeId: string
  added: boolean
}

export function ScanRoom({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'done'>('idle')
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [rows, setRows] = useState<RowState[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // A monotonically increasing token so a poll loop that was superseded (e.g.
  // the user picked a different sample mid-poll) stops applying its results.
  const runRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Stop any in-flight poll loop when the panel unmounts.
  useEffect(() => () => { runRef.current++ }, [])

  /** Poll fetchDetection(id) until it resolves to a non-pending result. */
  async function pollForResult(id: string) {
    const run = ++runRef.current
    setPhase('analyzing')
    setResult(null)
    setRows([])
    setErrorMsg(null)

    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      // Bail if a newer run started or the panel closed.
      if (run !== runRef.current) return
      try {
        const data = await fetchDetection(id)
        if (run !== runRef.current) return
        if (data.status !== 'pending') {
          finishWithResult(data as DetectionResult)
          return
        }
      } catch (err) {
        if (run !== runRef.current) return
        setErrorMsg(err instanceof Error ? err.message : 'Detection failed')
        setPhase('done')
        return
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }

    // Timed out — treat as "nothing detected" so the user can add manually.
    if (run !== runRef.current) return
    setErrorMsg('Detection timed out')
    setPhase('done')
  }

  function finishWithResult(data: DetectionResult) {
    setResult(data)
    setRows(
      (data.proposals || []).map((p) => ({
        archetypeId: p.archetype_id,
        added: false,
      })),
    )
    setPhase('done')
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // allow re-selecting the same file later
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result
      if (typeof dataUrl !== 'string') return
      const run = ++runRef.current
      setPhase('analyzing')
      setResult(null)
      setRows([])
      setErrorMsg(null)
      try {
        const id = await requestDetection(dataUrl)
        if (run !== runRef.current) return
        // pollForResult bumps the run token again; that's fine — it supersedes
        // this one and the guard above already passed.
        await pollForResult(id)
      } catch (err) {
        if (run !== runRef.current) return
        setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
        setPhase('done')
      }
    }
    reader.readAsDataURL(file)
  }

  function addRow(index: number) {
    const proposal = result?.proposals[index]
    const row = rows[index]
    if (!proposal || !row || row.added) return
    const store = useStore.getState()
    const newId = store.addFurnitureCentered(row.archetypeId)
    if (newId) {
      store.updateFurniture(newId, { color: proposal.color_hex })
    }
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, added: true } : r)))
  }

  function addAll() {
    if (!result) return
    const store = useStore.getState()
    result.proposals.forEach((proposal, i) => {
      if (rows[i]?.added) return
      const newId = store.addFurnitureCentered(rows[i].archetypeId)
      if (newId) store.updateFurniture(newId, { color: proposal.color_hex })
    })
    setRows((rs) => rs.map((r) => ({ ...r, added: true })))
  }

  function setRowArchetype(index: number, archetypeId: string) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, archetypeId } : r)))
  }

  const hasProposals =
    phase === 'done' &&
    result &&
    result.status === 'ok' &&
    result.proposals.length > 0

  const showEmptyMsg =
    phase === 'done' &&
    (!result ||
      result.status === 'error' ||
      result.proposals.length === 0 ||
      !!errorMsg)

  const allAdded = rows.length > 0 && rows.every((r) => r.added)

  return (
    <div
      style={{
        background: '#fff',
        border: `1.5px solid ${BORDER}`,
        borderRadius: 14,
        padding: '18px 18px 20px',
        marginBottom: 22,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* ---- Header ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          gap: 10,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700 }}>Scan a room photo</span>
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close"
          style={{
            border: 'none',
            background: 'none',
            fontSize: 20,
            lineHeight: 1,
            color: 'var(--ink-2)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* ---- Upload + samples ---- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: `1.5px solid ${BORDER}`,
            borderRadius: 999,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            background: '#fbfaf7',
          }}
        >
          📤 Upload a photo
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
        </label>

        <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>or try a sample:</span>
        {SAMPLE_IDS.map((id) => (
          <button
            key={id}
            onClick={() => pollForResult(id)}
            style={{
              border: `1.5px solid ${BORDER}`,
              borderRadius: 999,
              padding: '6px 12px',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              background: '#fff',
              color: 'var(--ink-2)',
            }}
          >
            {id}
          </button>
        ))}
      </div>

      {/* ---- Analyzing state ---- */}
      {phase === 'analyzing' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 16,
            fontSize: 14,
            color: 'var(--ink-2)',
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              border: '2px solid #d9d5cd',
              borderTopColor: '#111',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'roomio-spin 0.8s linear infinite',
            }}
          />
          <span>Analyzing your photo…</span>
          {/* keyframes inlined here so we don't touch src/index.css */}
          <style>{`@keyframes roomio-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ---- Empty / error state ---- */}
      {showEmptyMsg && (
        <p style={{ marginTop: 16, fontSize: 14, color: 'var(--ink-2)' }}>
          {result?.status === 'error'
            ? "Couldn't read that photo — it may be an unsupported format. Try a JPEG or PNG."
            : errorMsg
              ? errorMsg
              : "Couldn't detect anything — add furniture manually."}
        </p>
      )}

      {/* ---- Proposals ---- */}
      {hasProposals && result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.proposals.map((p, i) => (
              <ProposalRow
                key={i}
                proposal={p}
                archetypeId={rows[i]?.archetypeId ?? p.archetype_id}
                added={rows[i]?.added ?? false}
                onArchetypeChange={(id) => setRowArchetype(i, id)}
                onAdd={() => addRow(i)}
              />
            ))}
          </div>

          <button
            onClick={addAll}
            disabled={allAdded}
            style={{
              marginTop: 14,
              width: '100%',
              border: 'none',
              borderRadius: 999,
              padding: '9px 14px',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: allAdded ? 'default' : 'pointer',
              background: allAdded ? '#e6e3dd' : '#111',
              color: allAdded ? 'var(--ink-2)' : '#fff',
            }}
          >
            {allAdded ? 'All added ✓' : 'Add all'}
          </button>
        </div>
      )}
    </div>
  )
}

function ProposalRow({
  proposal,
  archetypeId,
  added,
  onArchetypeChange,
  onAdd,
}: {
  proposal: Proposal
  archetypeId: string
  added: boolean
  onArchetypeChange: (id: string) => void
  onAdd: () => void
}) {
  const pct = Math.round((proposal.confidence ?? 0) * 100)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: '10px 12px',
        background: '#fbfaf7',
      }}
    >
      {/* Color swatch + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span
          title={proposal.color_hex}
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            border: `1px solid ${BORDER}`,
            background: proposal.color_hex,
            flex: 'none',
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: 'var(--ink-2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 84,
          }}
        >
          {proposal.color_name}
        </span>
      </div>

      {/* Archetype dropdown (pre-selected to the proposal's guess) */}
      <select
        value={archetypeId}
        onChange={(e) => onArchetypeChange(e.target.value)}
        style={{
          flex: '1 1 160px',
          minWidth: 140,
          fontSize: 13,
          padding: '6px 8px',
          borderRadius: 8,
          border: `1.5px solid ${BORDER}`,
          background: '#fff',
          color: 'var(--ink)',
        }}
      >
        {CATEGORY_ORDER.map((cat) => {
          const items = ARCHETYPES.filter((a) => a.category === cat.id)
          if (!items.length) return null
          return (
            <optgroup key={cat.id} label={cat.label}>
              {items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>

      {/* Confidence badge */}
      <span
        title="Detection confidence"
        style={{
          flex: 'none',
          fontSize: 11.5,
          fontWeight: 700,
          color: 'var(--ink-2)',
          background: '#f0eee8',
          borderRadius: 999,
          padding: '3px 8px',
        }}
      >
        {pct}%
      </span>

      {/* Add button */}
      <button
        onClick={onAdd}
        disabled={added}
        style={{
          flex: 'none',
          border: added ? `1.5px solid ${BORDER}` : 'none',
          borderRadius: 999,
          padding: '6px 14px',
          fontSize: 12.5,
          fontWeight: 700,
          cursor: added ? 'default' : 'pointer',
          background: added ? '#fff' : '#111',
          color: added ? 'var(--ink-2)' : '#fff',
        }}
      >
        {added ? 'Added ✓' : 'Add'}
      </button>
    </div>
  )
}
