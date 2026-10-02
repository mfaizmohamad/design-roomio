/**
 * Agent H harness — faithful furniture built the way Agent A's Furniture3D does it:
 * primitive geometries + meshStandardMaterial, a single item color threaded through shade()
 * (body/cushions ≈ item color, legs darker, feet metal-ish). NO role tags — so the harness
 * exercises Agent H's color/lightness slot HEURISTIC exactly as it must work on A's corpus.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useTextureStore, ITEM_COLOR, type Target } from './textureStore'

/** Mirror of A's shade(): multiply HSL lightness (linear, via THREE.Color) by a factor. */
function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)))
  return '#' + c.getHexString()
}

const cm = (v: number) => v / 100

function useRegister(target: Target) {
  const ref = useRef<THREE.Group>(null)
  const register = useTextureStore((s) => s.registerGroup)
  useEffect(() => {
    register(target, ref.current)
    return () => register(target, null)
  }, [register, target])
  return ref
}

function Box(props: {
  size: [number, number, number]
  position: [number, number, number]
  color: string
  roughness?: number
  metalness?: number
}) {
  return (
    <mesh position={props.position} castShadow receiveShadow>
      <boxGeometry args={props.size} />
      <meshStandardMaterial color={props.color} roughness={props.roughness ?? 0.7} metalness={props.metalness ?? 0} />
    </mesh>
  )
}

export function Sofa({ position = [0, 0, 0] as [number, number, number] }) {
  const ref = useRegister('sofa')
  const W = cm(210)
  const D = cm(95)
  const legH = cm(12)
  const armW = cm(20)
  const leg = shade(ITEM_COLOR, 0.45)
  const cush = shade(ITEM_COLOR, 1.12)
  const innerW = W - armW * 2
  return (
    <group ref={ref} position={position}>
      {/* fabric body (raw item color) */}
      <Box size={[W, cm(18), D]} position={[0, legH + cm(9), 0]} color={ITEM_COLOR} roughness={0.8} />
      <Box size={[W, cm(40), cm(16)]} position={[0, legH + cm(38), -D / 2 + cm(8)]} color={ITEM_COLOR} roughness={0.8} />
      <Box size={[armW, cm(34), D]} position={[-W / 2 + armW / 2, legH + cm(30), 0]} color={ITEM_COLOR} roughness={0.8} />
      <Box size={[armW, cm(34), D]} position={[W / 2 - armW / 2, legH + cm(30), 0]} color={ITEM_COLOR} roughness={0.8} />
      {/* seat + back cushions (a lighter shade of the item color) */}
      <Box size={[innerW / 2 - cm(2), cm(14), D - cm(20)]} position={[-innerW / 4, legH + cm(25), cm(4)]} color={cush} roughness={0.85} />
      <Box size={[innerW / 2 - cm(2), cm(14), D - cm(20)]} position={[innerW / 4, legH + cm(25), cm(4)]} color={cush} roughness={0.85} />
      <Box size={[innerW, cm(26), cm(12)]} position={[0, legH + cm(42), -D / 2 + cm(16)]} color={cush} roughness={0.85} />
      {/* feet (dark, metal-ish — must NOT be textured) */}
      {[[-W / 2 + cm(10), -D / 2 + cm(10)], [W / 2 - cm(10), -D / 2 + cm(10)], [-W / 2 + cm(10), D / 2 - cm(10)], [W / 2 - cm(10), D / 2 - cm(10)]].map(
        ([x, z], i) => (
          <mesh key={i} position={[x, legH / 2, z]} castShadow>
            <cylinderGeometry args={[cm(3), cm(3), legH, 14]} />
            <meshStandardMaterial color={leg} roughness={0.4} metalness={0.3} />
          </mesh>
        ),
      )}
    </group>
  )
}

/** A freestanding tub: a cylinder scaled non-uniformly to an ellipse (like A's
 *  buildTubFreestanding) — its DEFAULT UVs stretch, so this is the triplanar fallback case. */
export function Tub({ position = [0, 0, 0] as [number, number, number] }) {
  const ref = useRegister('tub')
  const W = cm(160)
  const D = cm(75)
  const H = cm(58)
  return (
    <group ref={ref} position={position}>
      <mesh position={[0, H / 2, 0]} scale={[W / 2, 1, D / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 0.86, H, 36]} />
        <meshStandardMaterial color={ITEM_COLOR} roughness={0.5} metalness={0} />
      </mesh>
    </group>
  )
}

export function Table({ position = [0, 0, 0] as [number, number, number] }) {
  const ref = useRegister('table')
  const W = cm(120)
  const D = cm(60)
  const H = cm(45)
  const top = cm(4)
  const legR = cm(3)
  const leg = shade(ITEM_COLOR, 0.55)
  return (
    <group ref={ref} position={position}>
      {/* wood top (raw item color) */}
      <Box size={[W, top, D]} position={[0, H - top / 2, 0]} color={ITEM_COLOR} roughness={0.45} />
      {[[-W / 2 + cm(8), -D / 2 + cm(8)], [W / 2 - cm(8), -D / 2 + cm(8)], [-W / 2 + cm(8), D / 2 - cm(8)], [W / 2 - cm(8), D / 2 - cm(8)]].map(
        ([x, z], i) => (
          <mesh key={i} position={[x, (H - top) / 2, z]} castShadow>
            <boxGeometry args={[legR * 2, H - top, legR * 2]} />
            <meshStandardMaterial color={leg} roughness={0.5} metalness={0} />
          </mesh>
        ),
      )}
    </group>
  )
}
