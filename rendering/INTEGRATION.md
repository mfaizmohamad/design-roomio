# Rendering integration — Agent G → Agent D / A merge

The realism layer is a **drop-in**. Mounting it = adding ONE component inside the app's existing
`<Canvas>` + one optional UI panel. **No `<Canvas>` prop changes.** Renderer ownership with E stays
clean. Everything is verified standalone in the harness (`npm run verify` in `/rendering`).

## The seam — who owns what on the renderer

- **`<Canvas shadows flat …>` stays EXACTLY as-is:**
  - `shadows` (⇒ PCFSoftShadowMap) = **Agent E** (the sun is E's shadow caster). UNCHANGED.
  - `flat` (⇒ `THREE.NoToneMapping`) = **KEEP IT.** G's EffectComposer owns ACESFilmic tone mapping
    as a post pass. If anyone removes `flat` or sets `gl.toneMapping`, ACES applies **twice**
    (washed-out / clipped). Renderer must stay NoToneMapping; tone-map only in the composer.
  - `gl.preserveDrawingBuffer` = **B** (frame capture). UNCHANGED — composited frames still capture.
- **G adds:** `scene.environment` (IBL) + an `EffectComposer` (AO + bloom + exposure + ACES). Both are
  `<Canvas>` CHILDREN — nothing else changes.
- **E keeps:** hemisphere/ambient fill, per-room task/accent lights, the sun + shadow config. G does
  **not** touch E's light units (legacy/non-physical). See the IBL co-tune note below.

## The diff — `src/three/RoomView.tsx` (1 import block + 1 child + 1 overlay)

1) imports (top of file):
```ts
import { RealismLayer } from '../../rendering/src/r3f/RealismLayer'
import { RenderControls } from '../../rendering/src/ui/RenderControls'
```

2) inside `<Canvas>`, as a direct child — e.g. right after `<color attach="background" …/>`:
```tsx
<RealismLayer />
```
This single mount covers **both** single-room and whole-house mode — `HouseView` renders inside this
same Canvas (there is only one `<Canvas>` in the app, RoomView:179), and IBL + the composer apply
globally.

3) outside the Canvas (sibling of `<FlythroughHud/>` / `<LightingControls/>`), the quality panel:
```tsx
<RenderControls anchorLeftPx={12} anchorBottomPx={12} />
```
Bottom-left is currently free (E's panel is top-right, B's HUD bottom-right, the toolbar top-centre).

4) **Root `package.json`** needs the deps (like B added `canvas-record`):
```
npm i -E @react-three/postprocessing@2.19.1 postprocessing@6.37.8
```
(`n8ao` is vendored by `@react-three/postprocessing` — not needed as a separate root dep. Pin EXACT:
`@react-three/postprocessing@3.x` requires React 19 / R3F 9 and will NOT mount on this React 18 / R3F 8.)

## IBL co-tune with E — the one real interaction (please decide)

`scene.environment` (IBL) ADDS image-based ambient ON TOP of E's `hemisphere(0.85) + ambient(0.32)`
fill. At full strength that double-counts ambient and washes the room flat under ACES. Two options:

- **(A) DEFAULT NOW (conservative, no E change):** G runs IBL at a modest `environmentIntensity` (0.55).
  It adds **reflections** (chrome/metal/glass now reflect the room) + subtle bounce on top of E's fill.
  Looks good; verified in the harness. **No change needed from E.** This is what ships by default.
- **(B) IDEAL (needs E):** E reduces the flat fill (hemisphere ~0.25, ambient ~0.08) and G raises IBL
  to ~1.0 — IBL becomes the primary, softer, directional ambient (the brief's "lean on IBL for
  ambient"). **REQUEST → AGENT-E:** willing to cut the flat fill when IBL is active?

G ships (A) so nothing regresses; (B) is a coordinated upgrade once E signs off.

## Flythrough (B) interaction

The EffectComposer takes over the render loop (renderPriority 1) and reads the active camera, so B's
camera swap (`set({camera})`) composes fine. But N8AO + bloom cost FPS during a walk — recommend the
flythrough sets `useRender.getState().setQuality('low')` on enter and restores on exit (low keeps the
cheap IBL + tone-mapping foundation, drops the heavy AO). Co-tune with B. The hero path-trace (G5) is
static-camera only — never runs during a walk.

## Emissive bulbs (the "bulbs glow" acceptance)

Bloom is selective by HDR luminance (`luminanceThreshold ≈ 1.0`). The `MaterialEnhancer` lifts any
authored `emissiveIntensity` ×8, so A's lamp shades (~0.45) and TV screens (~0.35) cross the threshold
and glow, proportional to their authored value — **no A-source edits**. When E toggles a room light,
the bulb fixture's own emissive (if any) + the changed lighting both update live. For E's bare
point/spot bulbs that have NO fixture mesh, G can attach matching emissive fixture meshes — a follow-on
(REQUEST → AGENT-E for light position/color/type, which G reads from the lighting store).
