import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { requestStablePaneFit } from '@/lib/pane-manager/pane-fit-resize-observer'

// Why: system resume can land while the compositor has not yet restored window
// bounds, so the immediate wake fit reads a stale layout frame and xterm stays
// parked at a grid smaller than the container. Timers alone cannot detect this
// (the whole schedule fires against the same stale frame), so one extra pass
// runs after layout catches up, healing through the same stable-fit path as
// the reveal heal.
const POST_RESUME_SETTLE_DELAY_MS = 250

type PostResumeFitSettleDeps = {
  isVisible: () => boolean
}

export function schedulePostResumeFitSettle(
  managerRef: React.RefObject<PaneManager | null>,
  deps: PostResumeFitSettleDeps
): () => void {
  const run = (): void => {
    const manager = managerRef.current
    if (!manager || !deps.isVisible()) {
      return
    }
    const panes: ReturnType<PaneManager['getPanes']> =
      typeof manager.getPanes === 'function' ? manager.getPanes() : []
    for (const pane of panes) {
      let proposed: { cols: number; rows: number } | null = null
      try {
        proposed = pane.fitAddon.proposeDimensions() ?? null
      } catch {
        proposed = null
      }
      if (
        proposed &&
        proposed.cols > 0 &&
        proposed.rows > 0 &&
        (pane.terminal.cols !== proposed.cols || pane.terminal.rows !== proposed.rows)
      ) {
        requestStablePaneFit(pane)
      }
    }
  }
  // Why bare globals: some test harnesses stub `window` without timer fns.
  if (typeof requestAnimationFrame !== 'function' || typeof setTimeout !== 'function') {
    run()
    return () => {}
  }
  const frameId = requestAnimationFrame(() => setTimeout(run, POST_RESUME_SETTLE_DELAY_MS))
  return () => cancelAnimationFrame(frameId)
}
