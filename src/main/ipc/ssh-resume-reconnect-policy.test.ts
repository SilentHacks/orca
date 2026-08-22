import { describe, expect, it } from 'vitest'
import {
  resolveResumeReconnectAction,
  SUSPEND_PRESUME_DEAD_MS
} from './ssh-resume-reconnect-policy'

describe('resolveResumeReconnectAction', () => {
  it('presumes the link dead after a real (long) sleep', () => {
    expect(resolveResumeReconnectAction(SUSPEND_PRESUME_DEAD_MS)).toBe('reconnect-now')
    expect(resolveResumeReconnectAction(SUSPEND_PRESUME_DEAD_MS + 1)).toBe('reconnect-now')
    expect(resolveResumeReconnectAction(8 * 60 * 60 * 1000)).toBe('reconnect-now')
  })

  it('probes after short suspensions where the link may have survived (#7773)', () => {
    expect(resolveResumeReconnectAction(0)).toBe('probe')
    expect(resolveResumeReconnectAction(1_000)).toBe('probe')
    expect(resolveResumeReconnectAction(SUSPEND_PRESUME_DEAD_MS - 1)).toBe('probe')
  })

  it('probes when no suspend was recorded', () => {
    expect(resolveResumeReconnectAction(null)).toBe('probe')
  })
})
