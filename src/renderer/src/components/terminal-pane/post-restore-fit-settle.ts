import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { requestStablePaneFit } from '@/lib/pane-manager/pane-fit-resize-observer'

// Why: the one-shot fit after SSH reattach or a desktop-fit release can land
// on a grid smaller than the container — xterm cell metrics keep settling for
// a few frames after replay paint / WebGL attach, and on an idle restored
// terminal neither the pane ResizeObserver (needs a pixel change) nor the
// output-driven foreground drift check ever fires again. These delayed checks
// give the settled metrics a second chance via the same stable-fit path the
// tab-switch reveal heal uses.
const POST_RESTORE_SETTLE_CHECK_DELAYS_MS = [100, 300, 800]
// Why: after system resume macOS coalesces the deadlines above to fire before
// Chromium lays out the window at its restored bounds; a settled-looking grid
// then is read against a stale layout. One late check re-validates once the
// compositor has actually restored the frame.
const POST_RESTORE_SETTLE_FINAL_DELAY_MS = 2_000

type PostRestoreFitSettleDeps = {
  // Why: settle timers outlive pane rebinds and component unmounts; every
  // check re-validates against live state before touching xterm.
  isCurrent: () => boolean
  onSettled?: () => void
}

export function schedulePostRestoreFitSettle(
  pane: ManagedPane,
  deps: PostRestoreFitSettleDeps
): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  // Why: after system resume the whole deadline schedule can fire against one
  // stale layout frame, so an unchanged grid is not proof of settlement. One
  // late check re-validates once the compositor has actually restored bounds.
  const armFinalCheck = (): void => {
    if (finalTimer !== null) {
      return
    }
    finalTimer = setTimeout(() => {
      finalTimer = null
      check()
    }, POST_RESTORE_SETTLE_FINAL_DELAY_MS)
    timers.add(finalTimer)
  }
  let finalTimer: ReturnType<typeof setTimeout> | null = null
  let lastProposed: { cols: number; rows: number } | null = null
  const check = (): void => {
    if (!deps.isCurrent()) {
      cancel()
      return
    }
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
      // Why: stable-fit rather than a raw fit — a wobble still in progress
      // would reflow xterm on a transient grid and corrupt restored TUIs.
      requestStablePaneFit(pane, deps.onSettled)
    }
    // Why: an unchanged grid is not proof of a settled layout after sleep —
    // the whole schedule can fire against one stale frame. Keep the final
    // check armed unless two consecutive reads agree.
    if (
      lastProposed === null ||
      proposed === null ||
      lastProposed.cols !== proposed.cols ||
      lastProposed.rows !== proposed.rows
    ) {
      armFinalCheck()
    }
    lastProposed = proposed
  }
  const cancel = (): void => {
    // Why bare globals: some test harnesses stub `window` without timer fns.
    for (const id of timers) {
      clearTimeout(id)
    }
    timers.clear()
  }
  for (const delay of POST_RESTORE_SETTLE_CHECK_DELAYS_MS) {
    const id = setTimeout(() => {
      timers.delete(id)
      check()
    }, delay)
    timers.add(id)
  }
  return cancel
}
