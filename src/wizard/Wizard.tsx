import { useEffect, useState } from 'react'
import { useStore, type Stage } from '../store'
import { useLighting } from '../../lighting/src/store'
import { showEditingHints } from '../../lighting/src/contract'
import { RoomView } from '../three/RoomView'
import { captureView } from '../three/cameraBus'
import { saveDesign, storageMode } from '../repository'
import { ApiError } from '../api'
import { toast } from '../toast'
import { confirmDialog } from '../confirm'
import { isDirty, markClean } from '../dirty'
import { Step1Shape } from './Step1Shape'
import { Step2Dimensions } from './Step2Dimensions'
import { Step3Openings } from './Step3Openings'
import { Step4Style } from './Step4Style'
import { Furnish } from './Furnish'
import { MobileGate, useSmallScreen } from './MobileGate'
import { useHouse } from '../three/houseSession'

// `start` and `listings` render their own full-page screens (StartScreen / Listings), not the
// Wizard chrome — so the Wizard's per-stage hint/header maps only cover the wizard stages.
const HINTS: Record<Exclude<Stage, 'start' | 'listings'>, string> = {
  step1: 'Drag to orbit · scroll to zoom',
  step2: 'Drag a wall to resize, or type an exact length',
  step3: 'Pick a style, then click a wall to place it',
  step4: 'Choose a wall colour and floor finish',
  furnish: 'Click a piece to add · drag to move · it snaps to walls',
}

const META: Record<Exclude<Stage, 'start' | 'listings'>, { eyebrow: string; title: string }> = {
  step1: { eyebrow: 'Step 1 of 4', title: 'Set the shape and size' },
  step2: { eyebrow: 'Step 2 of 4', title: 'Adjust your dimensions' },
  step3: { eyebrow: 'Step 3 of 4', title: 'Add doors and windows' },
  step4: { eyebrow: 'Step 4 of 4', title: 'Choose your room style' },
  furnish: { eyebrow: 'Furnish', title: 'Furnish the room' },
}

function NameBadge() {
  const name = useStore((s) => s.design.name)
  const setName = useStore((s) => s.setName)
  return (
    <input
      className="name-badge"
      value={name}
      spellCheck={false}
      onChange={(e) => setName(e.target.value)}
      onFocus={(e) => e.target.select()}
    />
  )
}

export function Wizard() {
  const stage = useStore((s) => s.stage) as Exclude<Stage, 'start' | 'listings'>
  const next = useStore((s) => s.next)
  const back = useStore((s) => s.back)
  const setStage = useStore((s) => s.setStage)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const meta = META[stage]
  const lightMode = useLighting((s) => s.lightMode)
  const [saved, setSaved] = useState(false)
  const [sidebarClosed, setSidebarClosed] = useState(false)
  const smallScreen = useSmallScreen()

  const onSave = async () => {
    try {
      // snapshot the live camera view so reopening restores the exact viewpoint
      const view = captureView()
      const design = useHouse.getState().snapshotDesign(view)
      await saveDesign(design)
      markClean() // the saved design is now the clean baseline (CODE-16)
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } catch (e) {
      setSaved(false)
      // A 401 is handled centrally (api.ts → auth.ts): the user is routed back
      // to the login screen with a session-expired notice — no toast needed.
      if (!(e instanceof ApiError && e.status === 401)) {
        toast(e instanceof ApiError && e.status === 409
          ? 'This design changed in another tab. Your unsaved changes are still here; reopen the latest version before saving.'
          : "Couldn't save your design — check your connection and try again.", 'error')
      }
    }
  }

  // CODE-16: leaving for the start screen abandons the current room (there's no
  // resume path), so confirm when there are unsaved edits before discarding.
  const goHome = async () => {
    if (isDirty()) {
      const ok = await confirmDialog({
        title: 'Leave without saving?',
        body: 'You have unsaved changes to this room. They will be lost if you leave.',
        confirmLabel: 'Leave',
        cancelLabel: 'Keep editing',
        danger: true,
      })
      if (!ok) return
    }
    setStage('start')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const st = useStore.getState()
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        st.redo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selectedFurnitureId) {
          st.removeFurniture(st.selectedFurnitureId)
          e.preventDefault()
        } else if (st.selectedOpeningId) {
          st.removeOpening(st.selectedOpeningId)
          e.preventDefault()
        }
      } else if (e.key === 'Escape') {
        st.selectFurniture(null)
        st.selectOpening(null)
        st.setPlacingStyle(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Below ~700px the panel + canvas + floating tool panels can't coexist — show the
  // branded larger-screen gate instead of a broken editor (RESP-01). The 2D screens
  // (start, listings) are not gated.
  if (smallScreen) return <MobileGate />

  return (
    <div className={`wizard-shell${sidebarClosed ? ' sidebar-closed' : ''}`}>
      {/* Keep the editor mounted so hiding it preserves drafts and scroll position. */}
      <div className="panel" id="wizard-sidebar" hidden={sidebarClosed}>
        <div className="panel-scroll">
          <p className="eyebrow">{meta.eyebrow}</p>
          <h1 className="title">{meta.title}</h1>
          {stage === 'step1' && <Step1Shape />}
          {stage === 'step2' && <Step2Dimensions />}
          {stage === 'step3' && <Step3Openings />}
          {stage === 'step4' && <Step4Style />}
          {stage === 'furnish' && <Furnish />}
        </div>
        <div className="panel-foot">
          {stage !== 'step1' && (
            <button className="btn btn-ghost" onClick={back}>
              Go back
            </button>
          )}
          {stage !== 'furnish' ? (
            <button className="btn btn-primary" onClick={next}>
              {stage === 'step4' ? 'Design this room' : 'Next'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onSave}>
              {saved ? 'Saved ✓' : storageMode() === 'cloud' ? 'Save to account' : 'Save design'}
            </button>
          )}
        </div>
      </div>

      <div className="stage">
        <RoomView />
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarClosed((closed) => !closed)}
          aria-controls="wizard-sidebar"
          aria-expanded={!sidebarClosed}
          aria-label={sidebarClosed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarClosed ? 'Show sidebar' : 'Hide sidebar'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d={sidebarClosed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <NameBadge />
        <div className="vp-tools">
          <button className="home-btn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
            ↶
          </button>
          <button className="home-btn" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">
            ↷
          </button>
          <button className="home-btn" onClick={() => useStore.getState().fitView()} title="Fit view">
            ⤢
          </button>
          <button className="home-btn" onClick={goHome} title="Home">
            ⌂
          </button>
        </div>
        {showEditingHints(lightMode) && <div className="vp-hint">{HINTS[stage]}</div>}
      </div>
    </div>
  )
}
