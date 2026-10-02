/**
 * Agent H — world-space tiling math (H1).
 *
 * A Three.js primitive's UVs are 0..1 per face regardless of physical size, so a naive
 * texture.repeat shows the pattern at different cm-scales on differently-sized meshes.
 * We fix this exactly like the floor does (src/three/textures.ts: repeat = areaCm/100):
 * derive texture.repeat per-mesh from the mesh's world dimensions and the material's
 * `repeat_cm` (how many real-world centimeters ONE tile spans). Pattern density then
 * stays physically consistent across a 210 cm sofa and a 50 cm side table.
 */

/** Number of tile repeats across a face of `worldDimCm`, given `repeatCm` per tile. */
export function repeatFor(worldDimCm: number, repeatCm: number): number {
  if (!(repeatCm > 0) || !(worldDimCm > 0)) return 1
  return worldDimCm / repeatCm
}

/** Per-axis repeats for a rectangular face (width × height in cm). */
export function repeatXY(
  worldWidthCm: number,
  worldHeightCm: number,
  repeatCm: number,
): { x: number; y: number } {
  return { x: repeatFor(worldWidthCm, repeatCm), y: repeatFor(worldHeightCm, repeatCm) }
}

/**
 * The dominant face dimensions (cm) for a box-like mesh, used to size the visible-face
 * tiling. We tile against the two LARGEST extents (the broad faces a user looks at),
 * so e.g. a sofa body (W×H face) and a table top (W×D face) both read at true scale.
 */
export function dominantFaceCm(wCm: number, dCm: number, hCm: number): { u: number; v: number } {
  const dims = [wCm, dCm, hCm].sort((a, b) => b - a)
  return { u: dims[0], v: dims[1] }
}

/** Clamp a user tiling-density value to a sane band (cm per tile). */
export function clampRepeatCm(repeatCm: number, min = 5, max = 400): number {
  if (!Number.isFinite(repeatCm)) return 40
  return repeatCm < min ? min : repeatCm > max ? max : repeatCm
}
