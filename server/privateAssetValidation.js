// The browser loader must never receive a GLB that can fetch another tenant's
// URL or allocate unbounded decoded textures. This is a deliberately narrow v1
// profile: embedded PNG/JPEG textures, triangle meshes and a small set of
// material-only extensions. Compression extensions need a separate resource audit.

export const MAX_GLB_BYTES = 10 * 1024 * 1024
export const MAX_TRIANGLES = 100_000
export const MAX_TEXTURES = 16
export const MAX_DECODED_TEXTURE_BYTES = 64 * 1024 * 1024
const SAFE_EXTENSIONS = new Set([
  'KHR_texture_transform', 'KHR_materials_sheen', 'KHR_materials_specular',
])

export class AssetValidationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const reject = (message, status = 400) => { throw new AssetValidationError(message, status) }
const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const range = (offset, length, total) =>
  nonnegativeInteger(offset) && nonnegativeInteger(length) && offset + length <= total

const jpegDimensions = (bytes) => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) reject('invalid JPEG texture')
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) reject('invalid JPEG texture')
    while (bytes[at] === 0xff) at++
    const marker = bytes[at++]
    if (marker === 0xd9 || marker === 0xda) break
    if (at + 2 > bytes.length) reject('invalid JPEG texture')
    const size = bytes.readUInt16BE(at)
    if (size < 2 || at + size > bytes.length) reject('invalid JPEG texture')
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 7) reject('invalid JPEG texture')
      return [bytes.readUInt16BE(at + 3), bytes.readUInt16BE(at + 5)]
    }
    at += size
  }
  reject('JPEG texture has no dimensions')
}

const imageDimensions = (bytes, mimeType) => {
  if (mimeType === 'image/png') {
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.subarray(12, 16).toString('ascii') !== 'IHDR') reject('invalid PNG texture')
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  reject('unsupported texture format')
}

/**
 * Validate a self-contained GLB and return conservative resource counts.
 * Throws AssetValidationError for bad input; it never fetches referenced URLs.
 */
export function validatePrivateGlb(bytes) {
  if (!Buffer.isBuffer(bytes)) reject('GLB body required')
  if (bytes.length > MAX_GLB_BYTES) reject('GLB too large', 413)
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) reject('invalid GLB header')
  const jsonLength = bytes.readUInt32LE(12)
  if (!range(20, jsonLength, bytes.length) || jsonLength > 1024 * 1024 ||
      jsonLength % 4 || bytes.readUInt32LE(16) !== 0x4e4f534a) reject('invalid GLB JSON chunk')
  let document
  try { document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd()) } catch {
    reject('invalid GLB JSON')
  }
  if (!record(document) ||
      document.asset?.version !== '2.0') reject('invalid glTF document')
  const used = document.extensionsUsed ?? []
  const required = document.extensionsRequired ?? []
  if (!Array.isArray(used) || !Array.isArray(required) ||
      used.some((name) => !SAFE_EXTENSIONS.has(name)) ||
      required.some((name) => !SAFE_EXTENSIONS.has(name) || !used.includes(name))) {
    reject('GLB extensions are not supported')
  }
  const binHeader = 20 + jsonLength
  let bin = Buffer.alloc(0)
  if (binHeader < bytes.length) {
    if (!range(binHeader, 8, bytes.length)) reject('invalid GLB binary chunk')
    const binLength = bytes.readUInt32LE(binHeader)
    if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942 ||
        binLength % 4 || binHeader + 8 + binLength !== bytes.length) reject('invalid GLB binary chunk')
    bin = bytes.subarray(binHeader + 8)
  }
  const buffers = document.buffers ?? []
  if (!Array.isArray(buffers) || buffers.length > 1) reject('invalid GLB buffer')
  if (buffers.length === 1) {
    if (!record(buffers[0]) || Object.hasOwn(buffers[0], 'uri') || !nonnegativeInteger(buffers[0].byteLength) ||
        buffers[0].byteLength > bin.length || bin.length - buffers[0].byteLength > 3) {
      reject('external or invalid GLB buffer')
    }
  } else if (bin.length) reject('unexpected GLB binary chunk')
  const views = document.bufferViews ?? []
  if (!Array.isArray(views) || views.length > 2000) reject('too many GLB buffer views')
  for (const view of views) {
    if (!record(view) || view.buffer !== 0 || !range(view.byteOffset ?? 0, view.byteLength, buffers[0]?.byteLength ?? 0)) {
      reject('invalid GLB buffer view')
    }
  }
  const accessors = document.accessors ?? []
  if (!Array.isArray(accessors) || accessors.length > 2000) reject('too many GLB accessors')
  for (const accessor of accessors) {
    if (!record(accessor) || !nonnegativeInteger(accessor.count) || accessor.count > 1_000_000 ||
        (accessor.bufferView !== undefined && !views[accessor.bufferView]) || accessor.sparse) {
      reject('invalid GLB accessor')
    }
  }
  const meshes = document.meshes ?? []
  if (!Array.isArray(meshes) || meshes.length > 500) reject('too many GLB meshes')
  let triangles = 0
  for (const mesh of meshes) {
    if (!record(mesh) || !Array.isArray(mesh.primitives) || mesh.primitives.length > 100) reject('invalid GLB mesh')
    for (const primitive of mesh.primitives) {
      if (!record(primitive) || (primitive.mode ?? 4) !== 4 || !nonnegativeInteger(primitive.attributes?.POSITION) ||
          !accessors[primitive.attributes.POSITION]) reject('unsupported GLB primitive')
      const indices = primitive.indices === undefined ? null : accessors[primitive.indices]
      if (primitive.indices !== undefined && !indices) reject('invalid GLB indices')
      triangles += Math.floor((indices ?? accessors[primitive.attributes.POSITION]).count / 3)
      if (triangles > MAX_TRIANGLES) reject('triangle budget exceeded', 413)
    }
  }
  const images = document.images ?? []
  if (!Array.isArray(images) || images.length > MAX_TEXTURES) reject('texture count exceeded', 413)
  let decodedTextureBytes = 0
  for (const entry of images) {
    // A URI can be remote, relative or data:; all are refused so the approved
    // version stays self-contained and cannot issue surprise browser requests.
    if (!record(entry) || Object.hasOwn(entry, 'uri') || !nonnegativeInteger(entry.bufferView) || !views[entry.bufferView]) {
      reject('external or invalid GLB texture')
    }
    const view = views[entry.bufferView]
    const image = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    const [width, height] = imageDimensions(image, entry.mimeType)
    if (!width || !height || width > 2048 || height > 2048) reject('texture dimensions exceeded', 413)
    decodedTextureBytes += width * height * 4
    if (decodedTextureBytes > MAX_DECODED_TEXTURE_BYTES) reject('texture memory budget exceeded', 413)
  }
  const nodes = document.nodes ?? []
  if (!Array.isArray(nodes) || nodes.length > 1000) reject('too many GLB nodes')
  for (const node of nodes) {
    if (!record(node) || (node.mesh !== undefined && !meshes[node.mesh]) ||
        (node.children !== undefined && (!Array.isArray(node.children) || node.children.some((id) => !nodes[id])))) {
      reject('invalid GLB node')
    }
  }
  return { bytes: bytes.length, triangles, textures: images.length, decodedTextureBytes }
}
