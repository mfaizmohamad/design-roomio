/** Null means a uniform fit would misrepresent at least one reviewed dimension. */
export const fitMeasuredModel = (
  meshM: { w: number; d: number; h: number },
  measuredCm: { w: number; d: number; h: number },
): number | null => {
  const mesh = [meshM.w, meshM.d, meshM.h]
  const measured = [measuredCm.w, measuredCm.d, measuredCm.h]
  if (!mesh.every((n) => Number.isFinite(n) && n > 0) ||
      !measured.every((n) => Number.isFinite(n) && n > 0)) return null
  const scale = Math.min(...mesh.map((n, i) => measured[i] / 100 / n))
  const matches = mesh.every((n, i) =>
    Math.abs(n * scale * 100 - measured[i]) <= Math.max(2, measured[i] * 0.01))
  return matches ? scale : null
}
