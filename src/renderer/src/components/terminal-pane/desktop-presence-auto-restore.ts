import { useEffect, useRef } from 'react'
import { getDriverForPty, onDriverChange } from '@/lib/pane-manager/mobile-driver-state'
import {
  getFitOverrideForPty,
  getMobileFitOverridePtyIds,
  onOverrideChange
} from '@/lib/pane-manager/mobile-fit-overrides'
import { useAppStore } from '@/store'
import { restoreTerminalFitsToDesktop } from './terminal-fit-restore'

// Why: the runtime's auto-restore timer only arms on mobile unsubscribe /
// disconnect events. Two paths never fire it: a phone websocket dying
// uncleanly takes ~30-45s for the heartbeat reaper, and a renderer reload
// rehydrates a held override with no unsubscribe ever coming. When the user
// is sitting at the desktop with the "Immediately" preference, their presence
// is the strongest signal the phone session is over — restore without ever
// painting the held-fit banner.

// Why: exactly the held-fit banner condition (MobileDriverOverlay isHeldAtPhoneFit).
export function getHeldMobileFitPtyIds(): string[] {
  return getMobileFitOverridePtyIds().filter(
    (ptyId) =>
      getFitOverrideForPty(ptyId)?.mode === 'mobile-fit' && getDriverForPty(ptyId).kind !== 'mobile'
  )
}

export function useDesktopPresenceAutoRestore(): void {
  const settings = useAppStore((s) => s.settings)
  const autoRestoreMs = settings?.mobileAutoRestoreFitMs ?? null
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    // Why: only the Immediate preference promises "never show the banner";
    // finite windows and Indefinite keep the explicit Restore UX.
    if (autoRestoreMs !== 0) {
      return
    }
    let restoreInFlight = false
    let scheduledFrame: number | null = null
    const scheduleCheck = (): void => {
      // Why: run before the next paint so the banner never flashes, while
      // coalescing event bursts (reconnect handle rotations) into one check.
      if (scheduledFrame !== null) {
        return
      }
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = null
        void maybeRestore()
      })
    }
    const maybeRestore = async (): Promise<void> => {
      if (restoreInFlight) {
        return
      }
      const heldPtyIds = getHeldMobileFitPtyIds()
      if (heldPtyIds.length === 0) {
        return
      }
      restoreInFlight = true
      try {
        await restoreTerminalFitsToDesktop(heldPtyIds, settingsRef.current ?? undefined)
      } finally {
        restoreInFlight = false
        // Why: a phone can re-hold a PTY mid-restore; re-check once so the
        // final state converges without waiting for another event.
        scheduleCheck()
      }
    }
    const onWindowFocus = (): void => {
      scheduleCheck()
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        scheduleCheck()
      }
    }
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const unsubscribeOverride = onOverrideChange(scheduleCheck)
    const unsubscribeDriver = onDriverChange(scheduleCheck)
    scheduleCheck()
    return () => {
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribeOverride()
      unsubscribeDriver()
      if (scheduledFrame !== null) {
        cancelAnimationFrame(scheduledFrame)
      }
    }
  }, [autoRestoreMs])
}
