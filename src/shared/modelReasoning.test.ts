import { describe, expect, test } from 'bun:test'

import {
  getClaudeCodeModelCapabilities,
  normalizeModelReasoningEffort,
  normalizeReasoningModelId,
  resolveModelReasoningProfile,
} from './modelReasoning.js'

describe('model reasoning capability registry', () => {
  test('normalizes namespaced and 1M model ids before matching', () => {
    expect(normalizeReasoningModelId(' vendor/DeepSeek-V4-Pro[1m] ')).toBe('deepseek-v4-pro')
    expect(resolveModelReasoningProfile('vendor/DeepSeek-V4-Pro[1m]')?.family).toBe('deepseek-v4')
  })

  test('normalizes documented DeepSeek V4 effort aliases', () => {
    expect(normalizeModelReasoningEffort('deepseek-v4-pro', 'medium', 'anthropic')).toBe('high')
    expect(normalizeModelReasoningEffort('deepseek-v4-pro', 'xhigh', 'openai_chat')).toBe('max')
  })

  test('keeps K3 low, high, and max while mapping inherited aliases', () => {
    expect(resolveModelReasoningProfile('k3')?.supportedReasoningEfforts).toEqual([
      'low',
      'high',
      'max',
    ])
    expect(normalizeModelReasoningEffort('k3', 'low', 'anthropic')).toBe('low')
    expect(normalizeModelReasoningEffort('k3', 'medium', 'anthropic')).toBe('high')
    expect(normalizeModelReasoningEffort('k3', 'xhigh', 'anthropic')).toBe('max')
  })

  test('uses GLM-5.2 high and max without enabling effort on older GLM models', () => {
    expect(normalizeModelReasoningEffort('glm-5.2[1m]', 'medium', 'anthropic')).toBe('high')
    expect(normalizeModelReasoningEffort('glm-5.2', 'xhigh', 'openai_chat')).toBe('max')
    expect(normalizeModelReasoningEffort('glm-4.7', 'high', 'anthropic')).toBeUndefined()
  })

  test('does not expose controllable effort for MiniMax or older Kimi models', () => {
    expect(resolveModelReasoningProfile('MiniMax-M3[1m]')?.supportedReasoningEfforts).toEqual([])
    expect(normalizeModelReasoningEffort('MiniMax-M3', 'high', 'anthropic')).toBeUndefined()
    expect(normalizeModelReasoningEffort('kimi-k2.7-code', 'max', 'anthropic')).toBeUndefined()
  })

  test('uses a deny-by-default capability for unknown models and unsupported protocols', () => {
    expect(getClaudeCodeModelCapabilities('future-model')).toBe('none')
    expect(resolveModelReasoningProfile('k3', 'openai_responses')).toBeUndefined()
    expect(normalizeModelReasoningEffort('k3', 'high', 'openai_responses')).toBeUndefined()
  })
})
