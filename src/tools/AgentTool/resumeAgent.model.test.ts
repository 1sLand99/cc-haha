import { describe, expect, test } from 'bun:test'
import {
  resolveResumedAgentModelOverride,
  resolveResumedAgentOwnerAgentId,
} from './resumeAgent.js'

describe('resumed Agent model override', () => {
  test('retains a valid per-invocation model alias', () => {
    expect(resolveResumedAgentModelOverride('fable')).toBe('fable')
    expect(resolveResumedAgentModelOverride('haiku')).toBe('haiku')
  })

  test('keeps old or malformed metadata from injecting a model', () => {
    expect(resolveResumedAgentModelOverride(undefined)).toBeUndefined()
    expect(resolveResumedAgentModelOverride('provider-owned-model')).toBeUndefined()
    expect(resolveResumedAgentModelOverride(7)).toBeUndefined()
  })
})

describe('resumed Agent lifecycle owner', () => {
  test('keeps the in-memory nested owner when root SendMessage resumes it', () => {
    expect(resolveResumedAgentOwnerAgentId(
      undefined,
      'original-parent',
      { ownerAgentId: 'stale-sidecar-parent' },
    )).toBe('original-parent')
  })

  test('restores the nested owner from metadata after a cold task eviction', () => {
    expect(resolveResumedAgentOwnerAgentId(
      undefined,
      undefined,
      { ownerAgentId: 'persisted-parent' },
    )).toBe('persisted-parent')
  })

  test('uses the current nested caller and leaves a root run unowned', () => {
    expect(resolveResumedAgentOwnerAgentId(
      'current-parent',
      'original-parent',
      { ownerAgentId: 'persisted-parent' },
    )).toBe('current-parent')
    expect(resolveResumedAgentOwnerAgentId(undefined, undefined, null)).toBeUndefined()
  })
})
