import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCanonicalUserDataPath } from '../persistence/loading-store/user-data-path'

// Why: every relay deploy re-derives the same deterministic bootstrap (platform,
// home, version dir, node path) with ~10 sequential exec round trips before it
// can probe whether the still-alive relay socket is reusable. The socket path is
// deterministic per target (hash of the target id), so a sidecar cache lets the
// warm path go straight to the socket probe + --connect. Safe to lose: any miss
// or mismatch falls back to the full probe sequence.

export type CachedRelayBootstrap = {
  /** Content-hashed relay build the remote dir belongs to; a local app update mismatches and invalidates. */
  fullVersion: string
  platform: string
  remoteHome: string
  remoteRelayDir: string
  nodePath: string
  sockPath: string
  credentialFile: string
  savedAt: number
}

const CACHE_FILE_NAME = 'ssh-relay-bootstrap-cache.json'
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000

function cacheFilePath(): string {
  return join(getCanonicalUserDataPath(), CACHE_FILE_NAME)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function normalizeCachedRelayBootstrap(value: unknown): CachedRelayBootstrap | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const entry = value as Record<string, unknown>
  if (
    !isNonEmptyString(entry.fullVersion) ||
    !isNonEmptyString(entry.platform) ||
    !isNonEmptyString(entry.remoteHome) ||
    !isNonEmptyString(entry.remoteRelayDir) ||
    !isNonEmptyString(entry.nodePath) ||
    !isNonEmptyString(entry.sockPath) ||
    !isNonEmptyString(entry.credentialFile) ||
    typeof entry.savedAt !== 'number' ||
    !Number.isFinite(entry.savedAt)
  ) {
    return null
  }
  if (Date.now() - entry.savedAt > MAX_CACHE_AGE_MS) {
    return null
  }
  return { ...entry, savedAt: entry.savedAt } as CachedRelayBootstrap
}

function readCacheFile(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(cacheFilePath(), 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readCachedRelayBootstrap(targetId: string): CachedRelayBootstrap | null {
  return normalizeCachedRelayBootstrap(readCacheFile()[targetId])
}

export function writeCachedRelayBootstrap(targetId: string, entry: CachedRelayBootstrap): void {
  try {
    const all = readCacheFile()
    all[targetId] = entry
    mkdirSync(getCanonicalUserDataPath(), { recursive: true })
    writeFileSync(cacheFilePath(), JSON.stringify(all, null, 2), 'utf-8')
  } catch (error) {
    // Why: best-effort derived state — a failed write only costs the next deploy the full probe path.
    console.warn(
      `[ssh-relay] Bootstrap cache write failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
