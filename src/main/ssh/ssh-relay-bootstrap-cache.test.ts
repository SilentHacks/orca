import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../persistence/loading-store/user-data-path', () => ({
  getCanonicalUserDataPath: () => '/tmp/orca-test-userdata'
}))

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  normalizeCachedRelayBootstrap,
  readCachedRelayBootstrap,
  writeCachedRelayBootstrap,
  type CachedRelayBootstrap
} from './ssh-relay-bootstrap-cache'

const validEntry = (): CachedRelayBootstrap => ({
  fullVersion: '0.1.0+abcdef012345',
  platform: 'linux-x64',
  remoteHome: '/home/user',
  remoteRelayDir: '/home/user/.orca-remote/relay-0.1.0+abcdef012345',
  nodePath: '/usr/bin/node',
  sockPath: '/home/user/.orca-remote/relay.sock',
  credentialFile: '/home/user/.orca-remote/relay.sock.credential',
  savedAt: Date.now()
})

describe('ssh-relay-bootstrap-cache', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset()
    vi.mocked(writeFileSync).mockReset()
    vi.mocked(mkdirSync).mockReset()
  })

  it('normalizes a complete entry and rejects missing fields', () => {
    expect(normalizeCachedRelayBootstrap(validEntry())).not.toBeNull()
    expect(normalizeCachedRelayBootstrap({ ...validEntry(), nodePath: '' })).toBeNull()
    expect(normalizeCachedRelayBootstrap({ ...validEntry(), savedAt: 'nope' })).toBeNull()
    expect(normalizeCachedRelayBootstrap(null)).toBeNull()
  })

  it('rejects entries older than the cache horizon', () => {
    const stale = { ...validEntry(), savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }
    expect(normalizeCachedRelayBootstrap(stale)).toBeNull()
  })

  it('round-trips entries through the sidecar file per target', () => {
    vi.mocked(readFileSync).mockReturnValue(Buffer.from(JSON.stringify({ 'ssh-1': validEntry() })))
    expect(readCachedRelayBootstrap('ssh-1')?.sockPath).toContain('relay.sock')
    expect(readCachedRelayBootstrap('ssh-2')).toBeNull()
  })

  it('treats a corrupt cache file as empty', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(readCachedRelayBootstrap('ssh-1')).toBeNull()
  })

  it('write failures do not throw', () => {
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('{}'))
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(() => writeCachedRelayBootstrap('ssh-1', validEntry())).not.toThrow()
  })
})
