/**
 * Agent H — Photo-Texture Mapping. Public barrel for the drop-in library.
 * Pure pipeline (T1 detect+crop, T2 texture-ify) lands in H1–H3; the R3F apply layer
 * (H4) + persistence (H5) follow. See PROGRESS.md.
 */
export * from './contract'

// T1 detect+crop (reuses Agent B's bbox; client-side crop)
export * from './pipeline/crop'
// T2 texture-ify
export * from './pipeline/tile'
export * from './pipeline/delight'
export * from './pipeline/pbr'
// T1→T2 orchestration + demo photo synthesis
export * from './pipeline/compose'
export * from './pipeline/synth'
// shared utilities
export * from './pipeline/image'
export * from './pipeline/tiling'
export * from './pipeline/sha256'

// T3 apply (R3F): slot targeting + material assembly + reversible group apply
export * from './r3f/slot'
export * from './r3f/material'
export * from './r3f/applyTexture'

// H5 persistence: content-addressed asset store (references, not bytes) + AppliedTexture assembly
export * from './store/assetStore'
export * from './store/persist'
