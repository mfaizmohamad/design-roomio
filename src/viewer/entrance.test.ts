import { describe, expect, it } from 'vitest'
import { entranceSpawn, ENTRANCE_STEP_IN_CM } from './entrance'
import { useHouse } from '../three/houseSession'
import { HOME_MAP } from '../data/homes'

const rect = (w: number, l: number) => [
  { x: -w / 2, z: -l / 2 },
  { x: w / 2, z: -l / 2 },
  { x: w / 2, z: l / 2 },
  { x: -w / 2, z: l / 2 },
]
const door = (wallId: string, t = 0.5, style: 'single' | 'passage' = 'single') =>
  ({ id: wallId, kind: 'door', style, wallId, t, width: 90, height: 210, sill: 0 }) as const

describe('entranceSpawn', () => {
  it('starts one step inside the foyer front door, facing into the home', () => {
    // 200×100 foyer centred at (1000, 500); w0 runs along its north edge (z = 450)
    const spawn = entranceSpawn([
      { type: 'foyer', pos: { x: 1000, z: 500 }, design: { corners: rect(200, 100), openings: [door('w0')] } },
    ])
    expect(spawn).not.toBeNull()
    expect(spawn!.at.x).toBeCloseTo(1000)
    expect(spawn!.at.z).toBeCloseTo(450 + ENTRANCE_STEP_IN_CM)
    expect(spawn!.face).toEqual({ x: expect.closeTo(0), z: expect.closeTo(1) }) // inward = +z
  })

  it('faces the foyer\'s open passage onward instead of the wall opposite the door', () => {
    // door on north wall w0, passage on east wall w1 (x = +100 local)
    const spawn = entranceSpawn([{
      type: 'foyer', pos: { x: 0, z: 0 },
      design: { corners: rect(200, 100), openings: [door('w0'), door('w1', 0.5, 'passage')] },
    }])!
    // from (0, -50+70) toward (100, 0): mostly +x, slightly -z
    expect(spawn.face.x).toBeGreaterThan(0.9)
    expect(spawn.face.z).toBeLessThan(0)
    expect(Math.hypot(spawn.face.x, spawn.face.z)).toBeCloseTo(1)
  })

  it('skips open passages, upper-floor foyers and non-foyer rooms', () => {
    const corners = rect(200, 100)
    expect(entranceSpawn([{ type: 'foyer', pos: { x: 0, z: 0 }, design: { corners, openings: [door('w0', 0.5, 'passage')] } }])).toBeNull()
    expect(entranceSpawn([{ type: 'foyer', level: 1, pos: { x: 0, z: 0 }, design: { corners, openings: [door('w0')] } }])).toBeNull()
    expect(entranceSpawn([{ type: 'bedroom', pos: { x: 0, z: 0 }, design: { corners, openings: [door('w0')] } }])).toBeNull()
    expect(entranceSpawn([{ type: 'foyer', design: { corners, openings: [door('w0')] } }])).toBeNull() // no position
  })

  it('finds the real duplex front door: the lobby single door, not its passage to the living room', () => {
    // Load the duplex through the same session the tour uses.
    const home = Object.values(HOME_MAP).find((h) => h.levels.some((l) => l.rooms.some((r) => r.type === 'foyer' && r.name === 'Lobby')))!
    expect(useHouse.getState().loadHome(home.id)).toBe(true)
    const rooms = useHouse.getState().rooms
    const lobby = rooms.find((r) => r.design.name === 'Lobby')!
    const spawn = entranceSpawn(rooms)!
    expect(spawn).not.toBeNull()
    // inside the lobby's footprint …
    const halfW = 155 / 2
    const halfL = 193 / 2
    expect(Math.abs(spawn.at.x - lobby.pos!.x)).toBeLessThan(halfW)
    expect(Math.abs(spawn.at.z - lobby.pos!.z)).toBeLessThan(halfL)
    // … and facing a unit direction
    expect(Math.hypot(spawn.face.x, spawn.face.z)).toBeCloseTo(1)
  })
})
