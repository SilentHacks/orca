import { describe, expect, it } from 'vitest'
import { AUTO_RESTORE_FIT_OPTIONS, autoRestoreValueFromMs } from './mobile-auto-restore-options'

describe('auto restore fit options', () => {
  it('maps 0 to the immediate option and back', () => {
    const immediate = AUTO_RESTORE_FIT_OPTIONS.find((o) => o.value === 'immediate')
    expect(immediate?.ms).toBe(0)
    expect(autoRestoreValueFromMs(0)).toBe('immediate')
  })

  it('keeps null mapped to indefinite', () => {
    expect(autoRestoreValueFromMs(null)).toBe('indefinite')
    expect(autoRestoreValueFromMs(undefined)).toBe('indefinite')
  })
})
