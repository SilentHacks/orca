// Why: after a real system sleep the SSH TCP session is dead in practice —
// NAT/firewall state is gone and the socket is half-open. prepareForHostSleep
// already set relay grace 0, so the remote relay, its PTYs and scrollback
// survive indefinitely and a reconnect is lossless. Probing the half-open
// link only adds seconds of latency before the inevitable teardown, so past
// this suspension length resume skips the probe and reconnects immediately.
// Shorter suspends still probe: those links may have survived, and tearing
// down live sessions flashed the overlay (#7773).
export const SUSPEND_PRESUME_DEAD_MS = 10_000

export type ResumeReconnectAction = 'reconnect-now' | 'probe'

export function resolveResumeReconnectAction(sleptMs: number | null): ResumeReconnectAction {
  if (sleptMs == null) {
    return 'probe'
  }
  return sleptMs >= SUSPEND_PRESUME_DEAD_MS ? 'reconnect-now' : 'probe'
}
