import { describe, expect, it } from 'vitest'
import { normalizeRuntimeSelection } from './runtimeSelection'

describe('normalizeRuntimeSelection', () => {
  it.each([
    ['Claude Official', null],
    ['ChatGPT Official', 'openai-official'],
  ])('keeps xhigh for %s', (_name, providerId) => {
    const selection = {
      providerId,
      modelId: providerId ? 'gpt-5.6-sol' : 'claude-opus-4-8',
      effortLevel: 'xhigh' as const,
    }

    expect(normalizeRuntimeSelection(selection)).toBe(selection)
  })

  it('maps xhigh to max for a Claude-compatible custom provider', () => {
    expect(normalizeRuntimeSelection({
      providerId: 'kimi-provider',
      modelId: 'k3',
      effortLevel: 'xhigh',
    })).toEqual({
      providerId: 'kimi-provider',
      modelId: 'k3',
      effortLevel: 'max',
    })
  })

  it('maps documented aliases and removes effort from models without the capability', () => {
    expect(normalizeRuntimeSelection({
      providerId: 'deepseek-provider',
      modelId: 'deepseek-v4-pro',
      effortLevel: 'medium',
    }, 'anthropic')).toEqual({
      providerId: 'deepseek-provider',
      modelId: 'deepseek-v4-pro',
      effortLevel: 'high',
    })

    expect(normalizeRuntimeSelection({
      providerId: 'minimax-provider',
      modelId: 'MiniMax-M3[1m]',
      effortLevel: 'high',
    }, 'anthropic')).toEqual({
      providerId: 'minimax-provider',
      modelId: 'MiniMax-M3[1m]',
    })

    expect(normalizeRuntimeSelection({
      providerId: 'custom-provider',
      modelId: 'future-model',
      effortLevel: 'high',
    }, 'openai_responses')).toEqual({
      providerId: 'custom-provider',
      modelId: 'future-model',
    })
  })

  it('preserves unknown persisted selections until their provider protocol is available', () => {
    const selection = {
      providerId: 'custom-provider',
      modelId: 'relay-specific-model',
      effortLevel: 'high' as const,
    }

    expect(normalizeRuntimeSelection(selection)).toBe(selection)
  })

  it('uses the Grok model default when xhigh is unsupported', () => {
    expect(normalizeRuntimeSelection({
      providerId: 'grok-official',
      modelId: 'grok-4.5',
      effortLevel: 'xhigh',
    })).toEqual({
      providerId: 'grok-official',
      modelId: 'grok-4.5',
      effortLevel: 'high',
    })
  })

  it('removes effort from a non-reasoning Grok model', () => {
    expect(normalizeRuntimeSelection({
      providerId: 'grok-official',
      modelId: 'grok-composer-2.5-fast',
      effortLevel: 'xhigh',
    })).toEqual({
      providerId: 'grok-official',
      modelId: 'grok-composer-2.5-fast',
    })
  })
})
