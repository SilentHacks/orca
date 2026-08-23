import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock/app' }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('0.1.0+abcdef012345')
}))

vi.mock('./relay-protocol', () => ({
  RELAY_VERSION: '0.1.0',
  RELAY_REMOTE_DIR: '.orca-remote',
  parseUnameToRelayPlatform: vi.fn((os: string, arch: string) => {
    const normalizedOs = os.toLowerCase()
    const normalizedArch = arch.toLowerCase()
    const relayArch = normalizedArch === 'arm64' || normalizedArch === 'aarch64' ? 'arm64' : 'x64'
    if (normalizedOs === 'windows' || normalizedOs === 'win32') {
      return `win32-${relayArch}`
    }
    if (normalizedOs === 'darwin') {
      return `darwin-${relayArch}`
    }
    if (normalizedOs === 'linux') {
      return `linux-${relayArch}`
    }
    return null
  }),
  RELAY_SENTINEL: 'ORCA-RELAY v0.1.0 READY\n',
  RELAY_SENTINEL_TIMEOUT_MS: 10_000
}))

vi.mock('./ssh-relay-deploy-helpers', () => ({
  uploadDirectory: vi.fn().mockResolvedValue(undefined),
  waitForSentinel: vi.fn().mockResolvedValue({
    write: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn()
  }),
  isUnconfirmedSshCommandTermination: (error: unknown) =>
    error instanceof Error &&
    (error as Error & { sshChannelCloseConfirmed?: boolean }).sshChannelCloseConfirmed === false,
  execCommand: vi.fn().mockResolvedValue('__ORCA_REMOTE_PLATFORM__ Linux x86_64')
}))

vi.mock('./ssh-remote-node-resolution', () => ({
  resolveRemoteNodePath: vi.fn().mockResolvedValue('/usr/bin/node')
}))

vi.mock('./ssh-relay-endpoint-credential', () => ({
  writeRelayEndpointCredential: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./ssh-relay-bootstrap-cache', () => ({
  readCachedRelayBootstrap: vi.fn().mockReturnValue(null),
  writeCachedRelayBootstrap: vi.fn()
}))

vi.mock('./ssh-relay-versioned-install', () => ({
  readLocalFullVersion: vi.fn().mockReturnValue('0.1.0+abcdef012345'),
  computeRemoteRelayDir: (home: string, v: string) => `${home}/.orca-remote/relay-${v}`,
  isRelayAlreadyInstalled: vi.fn().mockResolvedValue(true),
  finalizeInstall: vi.fn().mockResolvedValue(undefined),
  abandonInstall: vi.fn().mockResolvedValue(undefined),
  gcOldRelayVersions: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./ssh-relay-install-lock', () => ({
  acquireInstallLock: vi.fn().mockResolvedValue(undefined),
  RELAY_INSTALL_LOCK_NAME: '.install-lock'
}))

vi.mock('./ssh-relay-repair-lock', () => ({
  tryAcquireRelayRepairLock: vi.fn().mockResolvedValue('acquired')
}))

vi.mock('./ssh-connection-utils', () => ({
  shellEscape: (s: string) => `'${s}'`,
  createSshOperationAbortError: () =>
    Object.assign(new Error('SSH operation was cancelled'), {
      name: 'AbortError'
    })
}))

import { deployAndLaunchRelay } from './ssh-relay-deploy'
import { execCommand, waitForSentinel } from './ssh-relay-deploy-helpers'
import {
  readCachedRelayBootstrap,
  writeCachedRelayBootstrap,
  type CachedRelayBootstrap
} from './ssh-relay-bootstrap-cache'
import type { SshConnection } from './ssh-connection'

function makeMockConnection(): SshConnection {
  return {
    canRunConcurrentExecCommands: vi.fn().mockReturnValue(true),
    exec: vi.fn().mockResolvedValue({
      on: vi.fn(),
      stderr: { on: vi.fn() },
      stdin: {},
      stdout: { on: vi.fn() },
      close: vi.fn()
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    sftp: vi.fn().mockResolvedValue({
      mkdir: vi.fn((_p: string, cb: (err: Error | null) => void) => cb(null)),
      createWriteStream: vi.fn().mockReturnValue({
        on: vi.fn(),
        end: vi.fn()
      }),
      end: vi.fn()
    })
  } as unknown as SshConnection
}

function queueLaunchNamespaceAndDeadSocketProbe(): void {
  vi.mocked(execCommand).mockResolvedValueOnce('').mockResolvedValueOnce('DEAD')
}

function queueFullPathSequence(): void {
  vi.mocked(execCommand)
    .mockResolvedValueOnce('__ORCA_REMOTE_PLATFORM__ Linux x86_64')
    .mockResolvedValueOnce('/home/user')
    .mockResolvedValueOnce('ORCA-NATIVE-DEPS-OK')
  queueLaunchNamespaceAndDeadSocketProbe()
  vi.mocked(execCommand).mockResolvedValueOnce('READY')
}

const cachedEntry = (): CachedRelayBootstrap => ({
  fullVersion: '0.1.0+abcdef012345',
  platform: 'linux-x64',
  remoteHome: '/home/user',
  remoteRelayDir: '/home/user/.orca-remote/relay-0.1.0+abcdef012345',
  nodePath: '/usr/bin/node',
  sockPath: '/home/user/.orca-remote/relay-0.1.0+abcdef012345/relay-c0ffee.sock',
  credentialFile: '/home/user/.orca-remote/relay-0.1.0+abcdef012345/relay-c0ffee.sock.credential',
  savedAt: Date.now()
})

describe('deployAndLaunchRelay cached bootstrap fast path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execCommand).mockReset().mockResolvedValue('__ORCA_REMOTE_PLATFORM__ Linux x86_64')
    vi.mocked(waitForSentinel).mockReset().mockResolvedValue({
      write: vi.fn(),
      onData: vi.fn(),
      onClose: vi.fn()
    })
    vi.mocked(readCachedRelayBootstrap).mockReset().mockReturnValue(null)
    vi.mocked(writeCachedRelayBootstrap).mockReset()
  })

  it('reconnects via cached bootstrap with only a socket probe and --connect', async () => {
    const conn = makeMockConnection()
    vi.mocked(readCachedRelayBootstrap).mockReturnValue(cachedEntry())
    vi.mocked(execCommand).mockResolvedValueOnce('ALIVE\n')

    const result = await deployAndLaunchRelay(conn, undefined, undefined, 'ssh-1')

    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(execCommand)).toHaveBeenCalledWith(
      conn,
      expect.stringContaining('test -S'),
      expect.anything()
    )
    expect(conn.exec).toHaveBeenCalledWith(
      expect.stringContaining('relay.js --connect'),
      expect.anything()
    )
    expect(result.remoteRelayDir).toBe('/home/user/.orca-remote/relay-0.1.0+abcdef012345')
    expect(result.sockPath).toContain('relay-c0ffee.sock')
  })

  it('falls back to the full path when the cached socket is dead', async () => {
    const conn = makeMockConnection()
    vi.mocked(readCachedRelayBootstrap).mockReturnValue(cachedEntry())
    vi.mocked(execCommand).mockResolvedValueOnce('DEAD\n')
    queueFullPathSequence()

    const result = await deployAndLaunchRelay(conn, undefined, undefined, 'ssh-1')

    expect(vi.mocked(execCommand)).toHaveBeenCalledWith(
      conn,
      "printf '\\n%s ' '__ORCA_REMOTE_PLATFORM__'; uname -sm",
      expect.anything()
    )
    expect(result.platform).toBe('linux-x64')
    expect(vi.mocked(writeCachedRelayBootstrap)).toHaveBeenCalledWith('ssh-1', expect.anything())
  })

  it('falls back when the local relay version no longer matches the cache', async () => {
    const conn = makeMockConnection()
    vi.mocked(readCachedRelayBootstrap).mockReturnValue({
      ...cachedEntry(),
      fullVersion: '0.9.0+stale000000000'
    })
    queueFullPathSequence()

    await deployAndLaunchRelay(conn, undefined, undefined, 'ssh-1')

    // First exec is the platform probe — the stale cache never probed the socket.
    expect(vi.mocked(execCommand).mock.calls[0]?.[1]).toContain('uname -sm')
  })

  it('saves the bootstrap after a successful full deploy', async () => {
    const conn = makeMockConnection()
    queueFullPathSequence()

    await deployAndLaunchRelay(conn, undefined, undefined, 'ssh-1')

    expect(vi.mocked(writeCachedRelayBootstrap)).toHaveBeenCalledWith(
      'ssh-1',
      expect.objectContaining({
        platform: 'linux-x64',
        remoteHome: '/home/user',
        nodePath: '/usr/bin/node'
      })
    )
  })
})
