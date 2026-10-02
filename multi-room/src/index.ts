/**
 * Public API for the Roomio multi-room / connectors module (Agent C).
 *
 * The House WRAPS Agent A's RoomDesign. Everything here is optional to use: a
 * single-room design loads and renders unchanged; rooms, connectors, and the
 * guidance evaluators are all opt-in. Pure logic — no rendering, no I/O — so Agent
 * A's front-end or Agent B's camera engine can consume it without coupling.
 */

// Schema
export type {
  House,
  HouseRoom,
  Footprint,
  Connector,
  ConnectorType,
  RoomType,
  SharedWall,
  Swing,
} from './types'
export { HOUSE_SCHEMA_VERSION, ROOM_TYPES, CONNECTOR_TYPES } from './types'

// Interior (Agent A's model, mirrored read-only)
export type { RoomDesign, Opening, FurnitureItem, Vec2, Wall } from './interior'

// House construction + placement
export {
  createHouse,
  wrapSingleRoom,
  roomFromInterior,
  addRoom,
  moveRoom,
  getRoom,
  footprintFromInterior,
} from './house'

// Persistence (backward-compatible load)
export {
  coerceHouse,
  loadHouseJSON,
  saveHouseJSON,
  looksLikeHouse,
  looksLikeRoomDesign,
  housesFromDesignMap,
} from './persistence'

// Connectors (placement + wall-cutting in both rooms)
export {
  placeConnector,
  suggestPlacement,
  connectorOpenings,
  openingsForRoom,
  wallPartsWithConnectors,
  connectorWorldPoint,
  type DerivedOpening,
  type PlaceConnectorInput,
} from './connectors'

// Geometry
export { findSharedWalls, areAdjacent, worldCorners, worldWalls, toWorld } from './geometry/placement'
export { swingArc, swingHitsFurniture, type SwingArc, type SwingHit } from './geometry/swing'

// Taxonomies + data
export {
  ROOM_TYPE_INFO,
  ROOM_TYPE_LIST,
  essentialsFor,
  guidanceFor,
  missingAssetsFor,
  type RoomTypeInfo,
  type Essential,
} from './data/roomTypes'
export {
  CONNECTOR_TYPE_INFO,
  CONNECTOR_TYPE_LIST,
  connectorInfo,
  isOpenConnector,
  MIN_PASSAGE_WIDTH,
  type ConnectorTypeInfo,
} from './data/connectorTypes'
export { allAssetGaps, assetRequestSummary, type AssetGap } from './data/assetRequests'

// Adjacency suggestions (AC1–AC9)
export {
  evaluateAdjacency,
  type AdjacencySuggestion,
  type AdjacencyRuleId,
  type Severity,
} from './adjacency'

// Kitchen + bathroom guidance
export {
  evaluateWorkTriangle,
  islandFits,
  kitchenGuidance,
  findTriangleFixtures,
  type WorkTriangleResult,
  type KitchenGuidance,
} from './kitchen'
export {
  checkFixtureClearance,
  clearanceZone,
  bathroomGuidance,
  type ClearanceResult,
  type BathroomGuidance,
} from './bathroom'
