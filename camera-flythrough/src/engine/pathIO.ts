import type { CameraPath } from '../contract/pathSchema'
import { validatePath } from '../contract/pathSchema'

/**
 * Path persistence — the CameraPath artifact saves/reloads as JSON per
 * /shared/camera_path_schema.json, so a flythrough is reusable + shareable
 * (and the front-end can persist it alongside a RoomDesign).
 */

const LS_KEY = 'roomio.flythrough.path'

export function serializePath(path: CameraPath): string {
  return JSON.stringify(path, null, 2)
}

/** Parse + validate untrusted JSON text into a CameraPath. Throws on invalid. */
export function parsePath(text: string): CameraPath {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    throw new Error('not valid JSON')
  }
  const res = validatePath(obj)
  if (!res.ok || !res.path) throw new Error(res.errors.join('; '))
  return res.path
}

/** Trigger a browser download of the path as <name>.json. */
export function downloadPath(path: CameraPath, filename?: string) {
  const blob = new Blob([serializePath(path)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `${(path.name || 'camera-path').replace(/[^\w.-]+/g, '_')}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Read a CameraPath from a user-selected File (validates). */
export function readPathFile(file: File): Promise<CameraPath> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(parsePath(String(reader.result)))
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(new Error('could not read file'))
    reader.readAsText(file)
  })
}

export function saveToLocal(path: CameraPath) {
  localStorage.setItem(LS_KEY, serializePath(path))
}

export function loadFromLocal(): CameraPath | null {
  const text = localStorage.getItem(LS_KEY)
  if (!text) return null
  try {
    return parsePath(text)
  } catch {
    return null
  }
}
