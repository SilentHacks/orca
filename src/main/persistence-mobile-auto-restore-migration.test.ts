import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PersistedState } from '../shared/persisted-state-types'
import { testState, createStore, writeDataFile, readDataFile } from './persistence-test-harness'

// Stub the ~/.ssh/config parser so the test drives the real Store deterministically, not the operator's actual ~/.ssh/config.
const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn()
}))

vi.mock('./telemetry/client', () => ({ track: trackMock }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: getCohortAtEmitMock }))

function seedSettings(settings: Record<string, unknown>): void {
  writeDataFile({
    schemaVersion: 1,
    ...({ settings } as Partial<PersistedState>)
  })
}

function persistedSettings(): Record<string, unknown> {
  const data = readDataFile() as { settings?: Record<string, unknown> }
  return data.settings ?? {}
}

describe('mobileAutoRestoreFitMs immediate-default migration', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
    loadUserSshConfigMock.mockReset()
    sshConfigHostsToTargetsMock.mockReset()
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('flips a persisted legacy null to 0 once and stamps the guard', async () => {
    seedSettings({ mobileAutoRestoreFitMs: null })

    const store = await createStore()
    expect(store.getSettings().mobileAutoRestoreFitMs).toBe(0)
    expect(store.getSettings().mobileAutoRestoreFitDefaultedToImmediate).toBe(true)

    store.flush()
    const saved = persistedSettings()
    expect(saved.mobileAutoRestoreFitMs).toBe(0)
    expect(saved.mobileAutoRestoreFitDefaultedToImmediate).toBe(true)
  })

  it('keeps a deliberate Indefinite choice once the guard is stamped', async () => {
    seedSettings({
      mobileAutoRestoreFitMs: null,
      mobileAutoRestoreFitDefaultedToImmediate: true
    })

    const store = await createStore()
    expect(store.getSettings().mobileAutoRestoreFitMs).toBeNull()
    expect(store.getSettings().mobileAutoRestoreFitDefaultedToImmediate).toBe(true)
  })

  it('never overrides an explicit finite preference', async () => {
    seedSettings({ mobileAutoRestoreFitMs: 60_000 })

    const store = await createStore()
    expect(store.getSettings().mobileAutoRestoreFitMs).toBe(60_000)
    expect(store.getSettings().mobileAutoRestoreFitDefaultedToImmediate).toBe(true)
  })

  it('profiles missing the key entirely load the immediate default', async () => {
    seedSettings({ theme: 'system' })

    const store = await createStore()
    expect(store.getSettings().mobileAutoRestoreFitMs).toBe(0)
  })
})
