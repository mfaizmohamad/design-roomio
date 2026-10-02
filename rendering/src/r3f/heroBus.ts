// Module bus for the hero-render exporter (mirrors src/three/cameraBus.ts). <HeroRender> (inside the
// Canvas, has the renderer) registers a function that reads the converged path-traced canvas as a PNG
// data URL; the DOM-side <RenderControls> calls it to download / hand off to C's export or B's capture.

export type HeroExporter = () => string | null

let exporter: HeroExporter | null = null

export function setHeroExporter(fn: HeroExporter | null): void {
  exporter = fn
}

export function getHeroExporter(): HeroExporter | null {
  return exporter
}
