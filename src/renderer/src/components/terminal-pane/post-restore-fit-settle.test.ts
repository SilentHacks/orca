// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schedulePostRestoreFitSettle } from './post-restore-fit-settle'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { requestStablePaneFit } from '@/lib/pane-manager/pane-fit-resize-observer'

vi.mock('@/lib/pane-manager/pane-fit-resize-observer', () => ({
  requestStablePaneFit: vi.fn()
}))

const requestStablePaneFitMock = vi.mocked(requestStablePaneFit)

function createPane(cols = 80, rows = 24) {
  const terminal = { cols, rows }
  const pane = {
    terminal,
    fitAddon: {
      proposeDimensions: vi.fn(() => ({ cols, rows }) as { cols: number; rows: number } | null)
    }
  }
  return pane as unknown as ManagedPane & {
    terminal: { cols: number; rows: number }
    fitAddon: { proposeDimensions: ReturnType<typeof vi.fn> }
  }
}

describe('schedulePostRestoreFitSettle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    requestStablePaneFitMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('heals through requestStablePaneFit once metrics settle to a diverged grid', () => {
    const pane = createPane(80, 24)
    // Cell metrics settle one check in: the container now holds more columns.
    pane.fitAddon.proposeDimensions.mockReturnValueOnce({ cols: 80, rows: 24 })
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 120, rows: 30 })

    schedulePostRestoreFitSettle(pane, { isCurrent: () => true })

    vi.advanceTimersByTime(100)
    expect(requestStablePaneFitMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(requestStablePaneFitMock).toHaveBeenCalledTimes(1)
    expect(requestStablePaneFitMock).toHaveBeenCalledWith(pane, undefined)
  })

  it('forwards onSettled to requestStablePaneFit', () => {
    const pane = createPane(80, 24)
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 120, rows: 30 })
    const onSettled = vi.fn()

    schedulePostRestoreFitSettle(pane, { isCurrent: () => true, onSettled })

    vi.advanceTimersByTime(100)
    expect(requestStablePaneFitMock).toHaveBeenCalledWith(pane, onSettled)
  })

  it('does nothing while the proposed grid matches the terminal', () => {
    const pane = createPane(80, 24)
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 80, rows: 24 })

    schedulePostRestoreFitSettle(pane, { isCurrent: () => true })

    vi.advanceTimersByTime(2_000)
    expect(requestStablePaneFitMock).not.toHaveBeenCalled()
  })

  it('re-arms one final check after a coalesced unchanged-grid burst', () => {
    const pane = createPane(80, 24)
    // Whole schedule fires against one stale layout frame: every read agrees.
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 80, rows: 24 })

    schedulePostRestoreFitSettle(pane, { isCurrent: () => true })

    vi.advanceTimersByTime(800)
    expect(requestStablePaneFitMock).not.toHaveBeenCalled()

    // Layout restores late; the final check must still see the diverged grid.
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 120, rows: 30 })
    vi.advanceTimersByTime(2_000)
    expect(requestStablePaneFitMock).toHaveBeenCalledTimes(1)
  })

  it('does not re-arm once two consecutive reads agree', () => {
    const pane = createPane(80, 24)
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 80, rows: 24 })

    schedulePostRestoreFitSettle(pane, { isCurrent: () => true })
    vi.advanceTimersByTime(2_100)
    vi.advanceTimersByTime(2_100)

    // First pass arms one final check (single read); the final check's read
    // matches the prior one, so nothing further is scheduled.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores transient measurement failures and heals on a later check', () => {
    const pane = createPane(80, 24)
    pane.fitAddon.proposeDimensions.mockReturnValueOnce(null)
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 120, rows: 30 })

    schedulePostRestoreFitSettle(pane, { isCurrent: () => true })

    vi.advanceTimersByTime(100)
    expect(requestStablePaneFitMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(requestStablePaneFitMock).toHaveBeenCalledTimes(1)
  })

  it('stops checking once isCurrent goes stale', () => {
    const pane = createPane(80, 24)
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 120, rows: 30 })
    let current = true

    schedulePostRestoreFitSettle(pane, { isCurrent: () => current })

    current = false
    vi.advanceTimersByTime(2_000)
    expect(requestStablePaneFitMock).not.toHaveBeenCalled()
  })

  it('cancel clears pending checks', () => {
    const pane = createPane(80, 24)
    pane.fitAddon.proposeDimensions.mockReturnValue({ cols: 120, rows: 30 })

    const cancel = schedulePostRestoreFitSettle(pane, { isCurrent: () => true })
    cancel()

    vi.advanceTimersByTime(2_000)
    expect(requestStablePaneFitMock).not.toHaveBeenCalled()
  })
})
