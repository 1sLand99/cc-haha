import { describe, expect, test } from 'bun:test'

import {
  getClaudeCodeModelCapabilities,
  getModelReasoningCapabilityOverride,
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
    expect(normalizeModelReasoningEffort('glm-5.1', 'high', 'anthropic')).toBeUndefined()
  })

  test('does not expose controllable effort for MiniMax or older Kimi models', () => {
    expect(resolveModelReasoningProfile('MiniMax-M3[1m]')?.supportedReasoningEfforts).toEqual([])
    expect(normalizeModelReasoningEffort('MiniMax-M3', 'high', 'anthropic')).toBeUndefined()
    expect(normalizeModelReasoningEffort('kimi-k2.7-code', 'max', 'anthropic')).toBeUndefined()
  })

  test('passes unlisted compatible models through to Claude Code', () => {
    expect(resolveModelReasoningProfile('claude-opus-5', 'anthropic')).toMatchObject({
      family: 'generic',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
    expect(normalizeModelReasoningEffort('claude-opus-5', 'xhigh', 'anthropic')).toBe('xhigh')
    expect(getClaudeCodeModelCapabilities('claude-opus-5', 'anthropic')).toBe(
      'thinking,effort,adaptive_thinking,xhigh_effort,max_effort',
    )
  })

  test('keeps future family versions out of documented legacy exceptions', () => {
    for (const modelId of ['glm-5.3', 'minimax-m4', 'mimo-v3']) {
      expect(resolveModelReasoningProfile(modelId, 'anthropic')?.family).toBe('generic')
    }
    expect(normalizeModelReasoningEffort('future-model', 'max', 'openai_chat')).toBe('max')
  })

  test('applies explicit slot capabilities before model profiles', () => {
    const models = {
      main: 'claude-opus-5',
      haiku: 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-5',
      opus: 'claude-opus-5',
    }
    const env = {
      ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: 'none',
    }
    const sonnetOverride = getModelReasoningCapabilityOverride(
      'claude-sonnet-5',
      models,
      env,
    )

    expect(sonnetOverride).toBe('none')
    expect(getModelReasoningCapabilityOverride('claude-opus-5', models, env)).toBeUndefined()
    expect(resolveModelReasoningProfile(
      'claude-sonnet-5',
      'anthropic',
      sonnetOverride,
    )?.supportedReasoningEfforts).toEqual([])
    expect(normalizeModelReasoningEffort(
      'claude-sonnet-5',
      'xhigh',
      'anthropic',
      sonnetOverride,
    )).toBeUndefined()
  })

  test('does not apply generic capabilities to unsupported protocols', () => {
    expect(resolveModelReasoningProfile('k3', 'openai_responses')).toBeUndefined()
    expect(resolveModelReasoningProfile('future-model', 'openai_responses')).toBeUndefined()
    expect(normalizeModelReasoningEffort('k3', 'high', 'openai_responses')).toBeUndefined()
  })
})
