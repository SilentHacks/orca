// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  getHeldMobileFitPtyIds,
  useDesktopPresenceAutoRestore
} from './desktop-presence-auto-restore'
import { setDriverForPty } from '@/lib/pane-manager/mobile-driver-state'
import { setFitOverride } from '@/lib/pane-manager/mobile-fit-overrides'

const mockState = vi.hoisted(() => ({
  restoreMock: vi.fn<(ptyIds: string[], settings?: unknown) => Promise<boolean>>(),
  settings: null as { mobileAutoRestoreFitMs: number | null } | null
}))

vi.mock('./terminal-fit-restore', () => ({
  restoreTerminalFitsToDesktop: mockState.restoreMock
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settings: typeof mockState.settings }) => unknown) =>
    selector({ settings: mockState.settings })
}))

function clearMobileState(): void {
  setDriverForPty('pty-1', { kind: 'idle' })
  setFitOverride('pty-1', 'desktop-fit', 0, 0)
}

async function flushFrames(frames = 3): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  }
}

describe('getHeldMobileFitPtyIds', () => {
  beforeEach(() => {
    mockState.restoreMock.mockReset().mockResolvedValue(false)
    mockState.settings = { mobileAutoRestoreFitMs: 0 }
    clearMobileState()
  })

  it('reports mobile-fit overrides whose driver is no longer mobile', () => {
    setFitOverride('pty-1', 'mobile-fit', 45, 20)
    setDriverForPty('pty-1', { kind: 'idle' })
    expect(getHeldMobileFitPtyIds()).toEqual(['pty-1'])
  })

  it('excludes ptys an active mobile driver still owns', () => {
    setFitOverride('pty-1', 'mobile-fit', 45, 20)
    setDriverForPty('pty-1', { kind: 'mobile', clientId: 'phone-a' })
    expect(getHeldMobileFitPtyIds()).toEqual([])
  })
})

describe('useDesktopPresenceAutoRestore', () => {
  beforeEach(() => {
    mockState.restoreMock.mockReset().mockResolvedValue(false)
    mockState.settings = { mobileAutoRestoreFitMs: 0 }
    clearMobileState()
  })

  afterEach(() => {
    clearMobileState()
  })

  it('restores a held override immediately when the preference is Immediate', async () => {
    setFitOverride('pty-1', 'mobile-fit', 45, 20)
    setDriverForPty('pty-1', { kind: 'idle' })

    const { unmount } = renderHook(() => useDesktopPresenceAutoRestore())
    await flushFrames()

    expect(mockState.restoreMock).toHaveBeenCalledWith(['pty-1'], {
      mobileAutoRestoreFitMs: 0
    })
    unmount()
  })

  it('does nothing while a mobile driver is still active', async () => {
    setFitOverride('pty-1', 'mobile-fit', 45, 20)
    setDriverForPty('pty-1', { kind: 'mobile', clientId: 'phone-a' })

    const { unmount } = renderHook(() => useDesktopPresenceAutoRestore())
    await flushFrames()

    expect(mockState.restoreMock).not.toHaveBeenCalled()
    unmount()
  })

  it('restores on window focus when the hold appears after mount', async () => {
    const { unmount } = renderHook(() => useDesktopPresenceAutoRestore())
    await flushFrames()
    expect(mockState.restoreMock).not.toHaveBeenCalled()

    // The phone dies mid-session: driver flips idle, override stays held.
    setDriverForPty('pty-1', { kind: 'idle' })
    setFitOverride('pty-1', 'mobile-fit', 45, 20)
    window.dispatchEvent(new Event('focus'))
    await flushFrames()

    expect(mockState.restoreMock).toHaveBeenCalledWith(['pty-1'], {
      mobileAutoRestoreFitMs: 0
    })
    unmount()
  })

  it('stays inert for non-Immediate preferences', async () => {
    mockState.settings = { mobileAutoRestoreFitMs: null }
    setFitOverride('pty-1', 'mobile-fit', 45, 20)
    setDriverForPty('pty-1', { kind: 'idle' })

    const { unmount } = renderHook(() => useDesktopPresenceAutoRestore())
    window.dispatchEvent(new Event('focus'))
    await flushFrames()

    expect(mockState.restoreMock).not.toHaveBeenCalled()
    unmount()
  })
})
