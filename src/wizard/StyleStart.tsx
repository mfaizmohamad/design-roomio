import type { CSSProperties, MouseEvent } from 'react'
import { useStore } from '../store'
import { PERSONAS, type PersonaType } from '../data/personas'
import { HOMES } from '../data/homes'
import { openHome } from '../homeLauncher'

const TYPE_LABEL: Record<PersonaType, string> = {
  life_stage: 'Who it’s for',
  interest: 'What you love',
  aesthetic: 'A vibe',
}

const TYPE_ORDER: PersonaType[] = ['life_stage', 'interest', 'aesthetic']

/**
 * "Start from a style that's you" — persona picker shown beside the blank-room
 * wizard. Picking a persona loads a fully-furnished, fully-editable room.
 */
export function StyleStart({ onClose }: { onClose: () => void }) {
  const loadPreset = useStore((s) => s.loadPreset)

  return (
    <div className="start">
      <div className="start-card" style={{ width: 720, maxWidth: '94vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="brand" style={{ marginBottom: 0 }}>
            <span className="dot" />
            Roomio
          </div>
          <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={onClose}>
            ← Back
          </button>
        </div>

        <h1 className="start-title" style={{ marginTop: 22 }}>
          Start from a style that’s you
        </h1>
        <p className="start-sub">
          Pick a persona and load a furnished room built from the elements that recur across real
          Pinterest rooms for that aesthetic. It’s a head start, not a lock-in — everything stays
          editable.
        </p>

        <div
          style={{
            marginTop: 20,
            maxHeight: '58vh',
            overflowY: 'auto',
            paddingRight: 4,
            marginRight: -4,
          }}
        >
          {/* Whole homes first: multi-room duplexes (two levels) rather than one room. */}
          <div style={{ marginBottom: 18 }}>
            <div className="section-label" style={{ marginBottom: 10 }}>
              A whole home
            </div>
            <div style={grid}>
              {HOMES.map((h) => (
                <button
                  key={h.id}
                  onClick={() => openHome(h.id)}
                  title={h.blurb}
                  style={card}
                  onMouseEnter={hoverIn}
                  onMouseLeave={hoverOut}
                  data-testid={`start-home-${h.id}`}
                >
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{h.emoji}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{h.title}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{h.blurb}</span>
                </button>
              ))}
            </div>
          </div>
          {TYPE_ORDER.map((type) => {
            const group = PERSONAS.filter((p) => p.persona_type === type)
            if (!group.length) return null
            return (
              <div key={type} style={{ marginBottom: 18 }}>
                <div className="section-label" style={{ marginBottom: 10 }}>
                  {TYPE_LABEL[type]}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                    gap: 12,
                  }}
                >
                  {group.map((p) => (
                    <button
                      key={p.genre_id}
                      onClick={() => loadPreset(p)}
                      title={p.style_note}
                      style={{
                        textAlign: 'left',
                        border: '1.5px solid #e6e3dd',
                        background: '#fbfaf7',
                        borderRadius: 14,
                        padding: '14px 15px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        transition: 'border-color .12s, transform .12s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#111'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e6e3dd'
                        e.currentTarget.style.transform = 'none'
                      }}
                    >
                      <span style={{ fontSize: 26, lineHeight: 1 }}>{p.emoji}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                        {p.display_name}
                      </span>
                      <span
                        style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45 }}
                      >
                        {p.blurb}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
  gap: 12,
}

const card: CSSProperties = {
  textAlign: 'left',
  border: '1.5px solid #e6e3dd',
  background: '#fbfaf7',
  borderRadius: 14,
  padding: '14px 15px',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  transition: 'border-color .12s, transform .12s',
}

const hoverIn = (e: MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.borderColor = '#111'
  e.currentTarget.style.transform = 'translateY(-1px)'
}

const hoverOut = (e: MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.borderColor = '#e6e3dd'
  e.currentTarget.style.transform = 'none'
}
