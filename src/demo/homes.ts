// Home registry for the PUBLIC DEMO build only. vite.demo.config.ts swaps this in
// for src/data/homes/index.ts, so the demo bundle carries exactly the two sample
// homes below and none of the registry entries' names, source citations or plan notes.
//
// The geometry is the duplex we modelled; every user-facing string here is our own.
// Do NOT import EMBERCREST or PANDAUL (the objects) from here — only their *_LEVELS.
// Pulling in an object would put a client's name, a locality or a source citation
// into public JS; scripts/demo-leak-check.mjs fails the build if that happens.
import type { MultiLevelHome } from '../data/homes/types'
import { EMBERCREST_LEVELS } from '../data/homes/embercrest'
import { PANDAUL_LEVELS } from '../data/homes/pandaul'

export type { MultiLevelHome, HomeLevelSpec } from '../data/homes/types'

export const SAMPLE_DUPLEX: MultiLevelHome = {
  id: 'sample-duplex',
  title: 'Roomio Sample Duplex',
  emoji: '🏠',
  blurb: '3 BHK duplex · double-height living',
  reference: 'Roomio demo model.',
  planNote: 'Roomio demo model. Room sizes are approximate; wall thickness, ceiling heights and curved balconies are simplified.',
  levels: EMBERCREST_LEVELS.map((level) => ({
    ...level,
    rooms: level.rooms.map((room) => ({
      ...room,
      // Procedural furniture only. The one GLB in the private fixture is a
      // third-party sample model; the demo ships nothing we did not make.
      furniture: room.furniture.map(({ assetRef: _assetRef, ...item }) => item),
    })),
  })),
}

/** Single-storey 4 BHK traced from a ground-floor CAD plan. Already procedural-
 *  only (no assetRef), but strip defensively like the duplex so a GLB added to
 *  the private fixture later can never ride along into the demo. */
export const SAMPLE_HOUSE: MultiLevelHome = {
  id: 'sample-house',
  title: 'Roomio Sample 4 BHK House',
  emoji: '🏡',
  blurb: '4 BHK independent house · single storey',
  reference: 'Roomio demo model.',
  planNote: 'Roomio demo model. Room sizes are approximate; wall thickness is simplified.',
  levels: PANDAUL_LEVELS.map((level) => ({
    ...level,
    rooms: level.rooms.map((room) => ({
      ...room,
      furniture: room.furniture.map(({ assetRef: _assetRef, ...item }) => item),
    })),
  })),
}

export const HOMES: MultiLevelHome[] = [SAMPLE_DUPLEX, SAMPLE_HOUSE]

export const HOME_MAP: Record<string, MultiLevelHome> = Object.fromEntries(HOMES.map((h) => [h.id, h]))
