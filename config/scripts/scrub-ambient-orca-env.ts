// Why: running the suite from inside Orca exports Orca's own spawn-env keys into
// the ambient environment. Tests that assert exact env contents (e.g.
// pty-subprocess-env-inheritance) then see real values where they expect none.
const ORCA_AMBIENT_ENV_KEYS = [
  'ORCA_OPENCODE_CONFIG_DIR',
  'ORCA_MIMOCODE_HOME',
  'ORCA_OMP_STATUS_EXTENSION',
  'ORCA_CODEX_HOME',
  'ORCA_AGENT_TEAMS_SHIM_DIR',
  'ORCA_REMOTE_CLI_BIN_DIR',
  'ORCA_HISTFILE'
]

for (const key of ORCA_AMBIENT_ENV_KEYS) {
  delete process.env[key]
}
