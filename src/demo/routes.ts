/** Which sample home a path opens, or null for the landing page. `/tour` stays
 *  the duplex so links shared before the second demo keep working; the 4 BHK
 *  house is `/tour/4bhk`. A trailing slash is ignored. Cloudflare Pages serves
 *  index.html for unknown paths, which is what makes a direct link or a reload on
 *  either tour work. */
export type DemoTourId = 'duplex' | 'house'

export const TOUR_PATHS: Record<DemoTourId, string> = { duplex: '/tour', house: '/tour/4bhk' }

export function tourForPath(pathname: string): DemoTourId | null {
  const path = pathname.replace(/\/+$/, '')
  if (path === '/tour' || path === '/tour/duplex') return 'duplex'
  if (path === '/tour/4bhk') return 'house'
  return null
}

/** True on any tour path (kept for callers that only need tour-vs-landing). */
export const isTourPath = (pathname: string): boolean => tourForPath(pathname) !== null
