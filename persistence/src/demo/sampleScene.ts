/**
 * Sample furnished scenes for the demo harness (NOT app data). The real app feeds
 * persistence a live House from A's editor + C's multi-room + E's lighting; here we
 * fabricate faithful-shaped scenes so the harness can RUN and be verified end-to-end.
 */
import type { House, HouseRoom, FurnitureItem, LightingStateLike } from '../scene/slices'
import { uid } from '../util/id'

function rectCorners(w: number, l: number) {
  return [
    { x: 0, z: 0 },
    { x: w, z: 0 },
    { x: w, z: l },
    { x: 0, z: l },
  ]
}

function item(
  archetype: string,
  category: string,
  name: string,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  color: string,
  rotation = 0,
): FurnitureItem {
  return { id: uid('f'), archetype, category, name, x, z, rotation, w, d, h, color }
}

function room(
  id: string,
  name: string,
  type: HouseRoom['type'],
  w: number,
  l: number,
  placement: { x: number; z: number; rotation?: number },
  furniture: FurnitureItem[],
  wallColor = '#e9e6df',
): HouseRoom {
  const now = Date.now()
  return {
    room_id: id,
    type,
    footprint: { shape: 'rectangular', x: placement.x, z: placement.z, rotation: placement.rotation ?? 0, w, l },
    interior: {
      id,
      name,
      unit: 'cm',
      shape: 'rect',
      corners: rectCorners(w, l),
      wallHeight: 270,
      wallThickness: 12,
      openings: [],
      materials: { wallColor, floorTexture: 'oak' },
      furniture,
      createdAt: now,
      updatedAt: now,
    },
  }
}

/** A single furnished bedroom (the common single-room case). */
export function sampleBedroom(): House {
  const w = 420
  const l = 360
  const r = room('room-bed', 'Bedroom', 'bedroom', w, l, { x: 0, z: 0 }, [
    item('bed-queen', 'bed', 'Queen Bed', w / 2, l - 120, 165, 212, 50, '#8a9bb0'),
    item('storage-wardrobe', 'storage', 'Wardrobe', 60, 60, 120, 60, 200, '#6b5b4a'),
    item('table-side', 'table', 'Nightstand', w / 2 - 110, l - 40, 45, 40, 50, '#7a6a58'),
    item('decor-rug', 'decor', 'Rug', w / 2, l / 2, 200, 140, 2, '#c9a98f'),
  ])
  return {
    schema_version: '1.0',
    house_id: uid('house'),
    name: 'My Bedroom',
    rooms: [r],
    connectors: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** A small two-room house (living + kitchen) to exercise multi-room + floor-plan. */
export function sampleTwoRoom(): House {
  const living = room('room-living', 'Living Room', 'living', 480, 400, { x: 0, z: 0 }, [
    item('sofa-3', 'sofa', '3-Seater Sofa', 240, 340, 220, 95, 85, '#5b6b73'),
    item('table-coffee', 'table', 'Coffee Table', 240, 230, 110, 60, 40, '#6b5b4a'),
    item('decor-tv', 'storage', 'TV Unit', 240, 40, 160, 40, 50, '#3a3a3a'),
    item('decor-rug', 'decor', 'Rug', 240, 250, 280, 180, 2, '#b9a07f'),
  ])
  const kitchen = room('room-kitchen', 'Kitchen', 'kitchen', 360, 400, { x: 480, z: 0 }, [
    item('storage-dresser', 'storage', 'Counter', 180, 40, 320, 60, 90, '#cfc6b8'),
    item('table-round', 'table', 'Dining Table', 180, 280, 110, 110, 75, '#7a6a58'),
  ])
  return {
    schema_version: '1.0',
    house_id: uid('house'),
    name: 'My Apartment',
    rooms: [living, kitchen],
    connectors: [
      {
        connector_id: uid('c'),
        type: 'cased_opening',
        between: ['room-living', 'room-kitchen'],
        shared_wall: { room_a_wall: 1, room_b_wall: 3 },
        position_along_wall: 0.5,
        width_cm: 120,
        swing: null,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** A minimal E-shaped lighting slice (opaque to us; proves round-trip). */
export function sampleLighting(roomIds: string[]): LightingStateLike {
  const rooms: Record<string, unknown> = {}
  for (const id of roomIds) {
    rooms[id] = {
      lights: [
        { id: 'amb_fill', type: 'hemisphere', layer: 'ambient', color: '#ffffff', intensity: 0.8 },
        { id: 'ceil_1', type: 'ceiling', layer: 'task', color: '#fff1e0', intensity: 0.8, warmth: 'warm' },
      ],
    }
  }
  return {
    version: '1.0',
    timeOfDay: 0.55,
    northOffsetDeg: 0,
    barVisible: false,
    northVisible: false,
    sun: { enabled: true, maxElevationDeg: 60, warmthShift: true, intensityScale: 1, domeRadiusM: 30 },
    rooms,
  }
}
