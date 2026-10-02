import { describe, expect, it } from 'vitest'
import { useHouse } from './three/houseSession'
// The backend validator is plain JS because the Node server is a separate package.
// @ts-expect-error server JS has no frontend TypeScript declaration
import { validateWholeHome } from '../server/designValidation.js'

describe('cloud save contract', () => {
  it('accepts the actual Embercrest snapshot produced by the editor', () => {
    expect(useHouse.getState().loadHome('embercrest')).toBe(true)
    const saved = useHouse.getState().snapshotDesign()
    expect(validateWholeHome(saved)).toBeNull()
  })
})
