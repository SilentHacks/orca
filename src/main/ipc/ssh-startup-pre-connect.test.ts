import { describe, expect, it } from 'vitest'
import {
  selectStartupPreConnectTargetIds,
  type StartupPreConnectTarget
} from './ssh-startup-pre-connect'

describe('selectStartupPreConnectTargetIds', () => {
  it('selects known, non-passphrase, non-runtime-owned targets', () => {
    const targets = new Map<string, StartupPreConnectTarget | undefined>([
      ['dev-box', { id: 'dev-box' }],
      ['locked-box', { id: 'locked-box', lastRequiredPassphrase: true }],
      ['runtime-ssh-remote', { id: 'runtime-ssh-remote' }],
      ['gone-box', undefined]
    ])
    expect(
      selectStartupPreConnectTargetIds({
        connectionIdsAtShutdown: ['dev-box', 'locked-box', 'runtime-ssh-remote', 'gone-box'],
        targets
      })
    ).toEqual(['dev-box'])
  })

  it('deduplicates ids across session partitions', () => {
    const targets = new Map<string, StartupPreConnectTarget | undefined>([
      ['dev-box', { id: 'dev-box' }]
    ])
    expect(
      selectStartupPreConnectTargetIds({
        connectionIdsAtShutdown: ['dev-box', 'dev-box'],
        targets
      })
    ).toEqual(['dev-box'])
  })
})
