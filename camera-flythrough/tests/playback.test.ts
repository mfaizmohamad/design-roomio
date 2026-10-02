import { describe, it, expect } from 'vitest'
import { Playback } from '../src/engine/playback'
import type { CameraPath } from '../src/contract/pathSchema'

function pathOf(over: Partial<CameraPath> = {}): CameraPath {
  return {
    version: '1.0',
    coordinateSpace: 'world-meters',
    fps: 30,
    duration: 8,
    loop: false,
    eyeHeight: 1.6,
    lookAheadEps: 0.02,
    fov: 60,
    controlPoints: [
      { position: [-2, 1.6, 2], lookAt: null, dwell: 0 },
      { position: [-1, 1.6, -1], lookAt: null, dwell: 0 },
      { position: [1, 1.6, 1], lookAt: null, dwell: 0 },
      { position: [2, 1.6, -2], lookAt: null, dwell: 0 },
    ],
    ...over,
  }
}

describe('Playback — constant speed (arc length)', () => {
  it('samples are ~evenly spaced in distance over the timeline (no dwell)', () => {
    const pb = new Playback()
    expect(pb.setPath(pathOf())).toBe(true)
    const total = pb.getTotalTime()
    expect(total).toBeCloseTo(8, 5) // duration, no dwell
    const N = 200
    const dists: number[] = []
    let prev = pb.sampleAt(0)!.position.clone()
    for (let i = 1; i <= N; i++) {
      const p = pb.sampleAt((i / N) * total)!.position
      dists.push(p.distanceTo(prev))
      prev = p.clone()
    }
    const max = Math.max(...dists)
    const min = Math.min(...dists)
    // constant-speed ⇒ step distances nearly uniform
    expect(max / min).toBeLessThan(1.15)
  })
})

describe('Playback — dwell + timeline', () => {
  it('dwell extends total time and holds position', () => {
    const p = pathOf()
    p.controlPoints[1].dwell = 2
    const pb = new Playback()
    pb.setPath(p)
    expect(pb.getTotalTime()).toBeCloseTo(10, 5) // 8 + 2

    // find a τ inside the hold at point #1 and confirm position is steady
    // point #1 is partway along; sample a small window and expect near-zero motion
    const total = pb.getTotalTime()
    let holdFound = false
    for (let t = 0; t < total; t += 0.05) {
      const a = pb.sampleAt(t)!.position
      const b = pb.sampleAt(t + 0.05)!.position
      if (a.distanceTo(b) < 1e-4 && t > 0.5 && t < total - 0.5) { holdFound = true; break }
    }
    expect(holdFound).toBe(true)
  })
})

describe('Playback — transport', () => {
  it('play advances and stops at the end (non-loop)', () => {
    const pb = new Playback()
    pb.setPath(pathOf({ duration: 4 }))
    pb.play()
    expect(pb.isPlaying()).toBe(true)
    let guard = 0
    while (pb.isPlaying() && guard++ < 1000) pb.update(0.1)
    expect(pb.progress01()).toBeCloseTo(1, 2)
    expect(pb.isPlaying()).toBe(false)
  })

  it('loop wraps and keeps playing', () => {
    const pb = new Playback()
    pb.setPath(pathOf({ loop: true, duration: 2 }))
    pb.play()
    for (let i = 0; i < 40; i++) pb.update(0.1) // 4s > one 2s loop
    expect(pb.isPlaying()).toBe(true)
    expect(pb.progress01()).toBeGreaterThanOrEqual(0)
    expect(pb.progress01()).toBeLessThanOrEqual(1)
  })

  it('seek sets progress', () => {
    const pb = new Playback()
    pb.setPath(pathOf())
    pb.seek(0.5)
    expect(pb.progress01()).toBeCloseTo(0.5, 5)
  })
})

describe('Playback — look targets', () => {
  it('look-ahead target differs from position (camera turns)', () => {
    const pb = new Playback()
    pb.setPath(pathOf())
    const pose = pb.sampleAt(pb.getTotalTime() * 0.3)!
    expect(pose.position.distanceTo(pose.target)).toBeGreaterThan(0.05)
  })

  it('explicit per-point look-at is honored at that point', () => {
    const p = pathOf()
    p.controlPoints[0].lookAt = [9, 0.5, 9]
    const pb = new Playback()
    pb.setPath(p)
    const pose = pb.sampleAt(0)! // at first control point
    expect(pose.target.x).toBeCloseTo(9, 3)
    expect(pose.target.z).toBeCloseTo(9, 3)
  })

  it('returns null for < 2 control points', () => {
    const pb = new Playback()
    const p = pathOf()
    p.controlPoints = [p.controlPoints[0]]
    expect(pb.setPath(p)).toBe(false)
    expect(pb.currentPose()).toBe(null)
  })
})
