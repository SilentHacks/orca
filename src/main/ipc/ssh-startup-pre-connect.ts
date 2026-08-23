import { isRuntimeOwnedSshTargetId } from '../../shared/execution-host'

// Why: the first SSH connect at app launch is otherwise gated behind the
// renderer's sequential startup hydration (settings → repos → session →
// worktrees → onboarding) before it issues ssh:connect. Main already knows
// which targets were live at shutdown, so it can start TCP + handshake +
// relay deploy while the renderer hydrates; the renderer's later
// ssh:connect joins the in-flight attempt via connectInFlight.

export type StartupPreConnectTarget = {
  id: string
  lastRequiredPassphrase?: boolean
}

export function selectStartupPreConnectTargetIds(args: {
  connectionIdsAtShutdown: string[]
  targets: Map<string, StartupPreConnectTarget | undefined>
}): string[] {
  const selected: string[] = []
  for (const targetId of args.connectionIdsAtShutdown) {
    // Why: runtime-owned ids route through the paired remote runtime, not a local ssh2 transport.
    if (isRuntimeOwnedSshTargetId(targetId)) {
      continue
    }
    const target = args.targets.get(targetId)
    // Why: passphrase targets match the renderer's startup partition — defer
    // them to tab focus so boot never stacks credential dialogs.
    if (!target || target.lastRequiredPassphrase) {
      continue
    }
    selected.push(targetId)
  }
  return [...new Set(selected)]
}
