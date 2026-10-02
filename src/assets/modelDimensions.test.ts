import { describe, expect, it } from 'vitest'
import { fitMeasuredModel } from './modelDimensions'

describe('reviewed model dimensions', () => {
  it('accepts a proportional uniform fit, including the 2 cm boundary', () => {
    expect(fitMeasuredModel({ w: 0.8, d: 0.6, h: 0.7 }, { w: 80, d: 60, h: 70 })).toBe(1)
    expect(fitMeasuredModel({ w: 0.8, d: 0.6, h: 0.7 }, { w: 80, d: 60, h: 72 })).not.toBeNull()
  })
  it('rejects a distorted product and invalid mesh instead of silently shrinking it', () => {
    expect(fitMeasuredModel({ w: 0.8, d: 0.4, h: 0.7 }, { w: 80, d: 60, h: 70 })).toBeNull()
    expect(fitMeasuredModel({ w: 0, d: 0.6, h: 0.7 }, { w: 80, d: 60, h: 70 })).toBeNull()
  })
})
