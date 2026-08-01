export const MODEL_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number]
export type ModelReasoningApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

export type ModelReasoningProfile = {
  family: 'deepseek-v4' | 'kimi-k3' | 'kimi-coding' | 'glm-5.2' | 'glm-legacy' | 'minimax' | 'mimo'
  apiFormats: readonly ModelReasoningApiFormat[]
  supportedReasoningEfforts: readonly ModelReasoningEffort[]
  defaultReasoningEffort?: ModelReasoningEffort
  effortAliases?: Partial<Record<ModelReasoningEffort, ModelReasoningEffort>>
  claudeCodeCapabilities: string
}

// Protocol compatibility only tells us where to put an effort value. Each
// model family accepts a different subset, so this registry is the shared
// authority for the desktop picker, runtime validation, and Claude Code env.
// Unknown models intentionally receive no effort until their vendor contract
// is documented here.
type ModelReasoningRegistryEntry = ModelReasoningProfile & {
  matches: (modelId: string) => boolean
}

const ANTHROPIC_AND_OPENAI_CHAT = ['anthropic', 'openai_chat'] as const

const MODEL_REASONING_REGISTRY: readonly ModelReasoningRegistryEntry[] = [
  {
    family: 'deepseek-v4',
    apiFormats: ANTHROPIC_AND_OPENAI_CHAT,
    supportedReasoningEfforts: ['high', 'max'],
    defaultReasoningEffort: 'high',
    effortAliases: {
      low: 'high',
      medium: 'high',
      xhigh: 'max',
    },
    claudeCodeCapabilities: 'thinking,effort,adaptive_thinking,max_effort',
    matches: modelId => (
      modelId.startsWith('deepseek-v4') ||
      modelId === 'deepseek-chat' ||
      modelId === 'deepseek-reasoner'
    ),
  },
  {
    family: 'kimi-k3',
    apiFormats: ANTHROPIC_AND_OPENAI_CHAT,
    supportedReasoningEfforts: ['low', 'high', 'max'],
    defaultReasoningEffort: 'high',
    effortAliases: {
      medium: 'high',
      xhigh: 'max',
    },
    claudeCodeCapabilities: 'thinking,required_thinking,effort,max_effort',
    matches: modelId => (
      modelId === 'k3' ||
      modelId.startsWith('k3-') ||
      modelId === 'kimi-k3' ||
      modelId.startsWith('kimi-k3-')
    ),
  },
  {
    family: 'kimi-coding',
    apiFormats: ANTHROPIC_AND_OPENAI_CHAT,
    supportedReasoningEfforts: [],
    claudeCodeCapabilities: 'thinking,required_thinking',
    matches: modelId => (
      modelId.startsWith('kimi-for-coding') ||
      modelId.startsWith('kimi-k2.')
    ),
  },
  {
    family: 'glm-5.2',
    apiFormats: ANTHROPIC_AND_OPENAI_CHAT,
    supportedReasoningEfforts: ['high', 'max'],
    defaultReasoningEffort: 'max',
    effortAliases: {
      low: 'high',
      medium: 'high',
      xhigh: 'max',
    },
    claudeCodeCapabilities: 'thinking,effort,max_effort',
    matches: modelId => modelId === 'glm-5.2' || modelId.startsWith('glm-5.2-'),
  },
  {
    family: 'glm-legacy',
    apiFormats: ANTHROPIC_AND_OPENAI_CHAT,
    supportedReasoningEfforts: [],
    claudeCodeCapabilities: 'thinking',
    matches: modelId => modelId.startsWith('glm-'),
  },
  {
    family: 'minimax',
    apiFormats: ANTHROPIC_AND_OPENAI_CHAT,
    supportedReasoningEfforts: [],
    claudeCodeCapabilities: 'thinking,adaptive_thinking',
    matches: modelId => modelId.startsWith('minimax-'),
  },
  {
    family: 'mimo',
    apiFormats: ANTHROPIC_AND_OPENAI_CHAT,
    supportedReasoningEfforts: [],
    claudeCodeCapabilities: 'thinking',
    matches: modelId => modelId.startsWith('mimo-'),
  },
]

export function normalizeReasoningModelId(modelId: string): string {
  const normalized = modelId
    .trim()
    .replace(/\[1m\]$/i, '')
    .replace(/:1m$/i, '')
    .toLowerCase()
  const namespaceSeparator = normalized.lastIndexOf('/')
  return namespaceSeparator >= 0
    ? normalized.slice(namespaceSeparator + 1)
    : normalized
}

export function isModelReasoningEffort(value: string): value is ModelReasoningEffort {
  return (MODEL_REASONING_EFFORTS as readonly string[]).includes(value)
}

export function resolveModelReasoningProfile(
  modelId: string,
  apiFormat?: ModelReasoningApiFormat,
): ModelReasoningProfile | undefined {
  const normalizedModelId = normalizeReasoningModelId(modelId)
  const entry = MODEL_REASONING_REGISTRY.find((candidate) => (
    candidate.matches(normalizedModelId) &&
    (apiFormat === undefined || candidate.apiFormats.includes(apiFormat))
  ))
  if (!entry) return undefined

  const { matches: _matches, ...profile } = entry
  return profile
}

export function normalizeModelReasoningEffort(
  modelId: string,
  requestedEffort: ModelReasoningEffort | undefined,
  apiFormat?: ModelReasoningApiFormat,
): ModelReasoningEffort | undefined {
  if (requestedEffort === undefined) return undefined
  const profile = resolveModelReasoningProfile(modelId, apiFormat)
  if (!profile || profile.supportedReasoningEfforts.length === 0) return undefined
  if (profile.supportedReasoningEfforts.includes(requestedEffort)) return requestedEffort

  const aliased = profile.effortAliases?.[requestedEffort]
  return aliased && profile.supportedReasoningEfforts.includes(aliased)
    ? aliased
    : profile.defaultReasoningEffort
}

export function getClaudeCodeModelCapabilities(
  modelId: string,
  apiFormat?: ModelReasoningApiFormat,
): string {
  return resolveModelReasoningProfile(modelId, apiFormat)?.claudeCodeCapabilities ?? 'none'
}
