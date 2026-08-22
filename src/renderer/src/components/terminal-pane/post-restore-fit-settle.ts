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
  const timers = new Set<number>()
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
  }
  const cancel = (): void => {
    for (const id of timers) {
      window.clearTimeout(id)
    }
    timers.clear()
  }
  for (const delay of POST_RESTORE_SETTLE_CHECK_DELAYS_MS) {
    const id = window.setTimeout(() => {
      timers.delete(id)
      check()
    }, delay)
    timers.add(id)
  }
  return cancel
}
