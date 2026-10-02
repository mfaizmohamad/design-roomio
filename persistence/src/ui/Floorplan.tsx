/**
 * Floor-plan canvas component — draws a House top-down (reuses renderFloorplan).
 * Used as the live editor preview and the library card thumbnail fallback. Redraws
 * on house change and on resize (devicePixelRatio-aware for crisp lines).
 */
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { House } from '../scene/slices'
import { renderFloorplan } from '../render/floorplan'

export function Floorplan({
  house,
  labels = true,
  furniture = true,
  style,
}: {
  house: House
  labels?: boolean
  furniture?: boolean
  style?: CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const parent = canvas.parentElement
      const cssW = parent?.clientWidth || 600
      const cssH = parent?.clientHeight || 400
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      renderFloorplan(ctx, house, { width: cssW, height: cssH, labels, furniture })
    }
    draw()
    const ro = new ResizeObserver(draw)
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  }, [house, labels, furniture])

  return <canvas ref={ref} style={{ display: 'block', ...style }} />
}
