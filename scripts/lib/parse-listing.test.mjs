import { describe, it, expect } from 'vitest'
import { extractPhones, parseListing, classifyKind, relativeToMinutes } from './parse-listing.mjs'

describe('extractPhones — Indian mobile numbers, various formats', () => {
  it('pulls plain, spaced, +91 and multiple numbers', () => {
    expect(extractPhones('call 9876543210')).toEqual(['9876543210'])
    expect(extractPhones('dm 91467 70398')).toEqual(['9146770398'])
    expect(extractPhones('+91 88685 36367 or 7742412193')).toEqual(['8868536367', '7742412193'])
  })
  it('normalizes 91/0 prefixes and dedupes', () => {
    expect(extractPhones('918668536367 and 08668536367')).toEqual(['8668536367'])
  })
  it('ignores non-mobile digit runs (pins, prices, years)', () => {
    expect(extractPhones('rent 15000 for 2026, area 400 sqft')).toEqual([])
    expect(extractPhones('12345')).toEqual([]) // too short
  })
})

describe('classifyKind — offering (keep) vs seeking (drop)', () => {
  const k = (s) => classifyKind(' ' + s.toLowerCase() + ' ')
  it('a place available for rent is offering', () => {
    expect(k('2 BHK available for rent in Andheri')).toBe('offering')
    expect(k('PG accommodation available for girls')).toBe('offering')
    expect(k('Semi furnished 1RK, immediate possession')).toBe('offering')
  })
  it('"flatmate wanted / looking for a flatmate" is offering (they HAVE the place)', () => {
    expect(k('Female Flatmate Wanted for premium 2BHK')).toBe('offering')
    expect(k('Looking for a male flatmate to share a room')).toBe('offering')
  })
  it('someone asking for a flat/room is seeking', () => {
    expect(k('Looking for a 1BHK flat in Powai budget 20k')).toBe('seeking')
    expect(k('Need a room near Kharadi, moving next week')).toBe('seeking')
    expect(k('Hi, searching for a place to stay in Thane')).toBe('seeking')
  })
})

describe('parseListing — fields', () => {
  it('parses rent in k / comma / plain', () => {
    expect(parseListing('rent 15k').rent).toBe(15000)
    expect(parseListing('Budget: 25,000 per month').rent).toBe(25000)
    expect(parseListing('₹18000 rent').rent).toBe(18000)
  })
  it('rejects implausible rent', () => {
    expect(parseListing('area 400 sq ft').rent).toBeNull()
  })
  it('parses BHK / RK, location, gender, occupancy', () => {
    const p = parseListing('Female single occupancy in a 2 BHK at Andheri East')
    expect(p.bhk).toBe('2BHK')
    expect(p.location).toBe('Andheri East')
    expect(p.gender).toBe('female')
    expect(p.occupancy).toBe('single')
    expect(parseListing('1rk available').bhk).toBe('1RK')
  })
  it('prefers the longer locality name (Andheri East over Andheri)', () => {
    expect(parseListing('room in Andheri East').location).toBe('Andheri East')
  })
  it('does NOT match a locality inside another word (Sion in "visionary"/"inclusion")', () => {
    expect(parseListing('a visionary initiative, accelerated digital inclusion').location).toBeNull()
    expect(parseListing('flat available in Sion east').location).toBe('Sion')
  })
})

describe('relativeToMinutes', () => {
  it('maps FB relative times, tolerating null', () => {
    expect(relativeToMinutes('5m')).toBe(5)
    expect(relativeToMinutes('3h')).toBe(180)
    expect(relativeToMinutes('2d')).toBe(2880)
    expect(relativeToMinutes('Yesterday')).toBe(1440)
    expect(relativeToMinutes(null)).toBeNull()
    expect(relativeToMinutes('')).toBeNull()
  })
})
