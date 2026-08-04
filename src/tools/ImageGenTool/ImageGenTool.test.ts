import { afterEach, describe, expect, test } from 'bun:test'

import {
  IMAGE_GENERATION_API_KEY_ENV_KEY,
  IMAGE_GENERATION_BASE_URL_ENV_KEY,
  IMAGE_GENERATION_MODEL_ENV_KEY,
  IMAGE_GENERATION_PROVIDER_ID_ENV_KEY,
  IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY,
} from '../../services/imageGeneration/config.js'
import { ImageGenTool } from './ImageGenTool.js'

const ENV_KEYS = [
  IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY,
  IMAGE_GENERATION_PROVIDER_ID_ENV_KEY,
  IMAGE_GENERATION_BASE_URL_ENV_KEY,
  IMAGE_GENERATION_API_KEY_ENV_KEY,
  IMAGE_GENERATION_MODEL_ENV_KEY,
] as const

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('ImageGenTool', () => {
  test('is enabled only when the active provider has a complete image runtime', () => {
    for (const key of ENV_KEYS) delete process.env[key]
    expect(ImageGenTool.isEnabled()).toBe(false)

    process.env[IMAGE_GENERATION_PROVIDER_KIND_ENV_KEY] = 'openai_images'
    process.env[IMAGE_GENERATION_PROVIDER_ID_ENV_KEY] = 'relay'
    process.env[IMAGE_GENERATION_MODEL_ENV_KEY] = 'image-model'
    process.env[IMAGE_GENERATION_BASE_URL_ENV_KEY] = 'https://relay.test/v1'
    expect(ImageGenTool.isEnabled()).toBe(false)

    process.env[IMAGE_GENERATION_API_KEY_ENV_KEY] = 'relay-key'
    expect(ImageGenTool.isEnabled()).toBe(true)
  })

  test('defaults to one slot and preserves the structured result for the desktop', () => {
    expect(ImageGenTool.inputSchema.parse({ prompt: 'A paper-cut fox' })).toEqual({
      prompt: 'A paper-cut fox',
      count: 1,
    })

    const output = {
      type: 'image_generation_result' as const,
      operation: 'generate' as const,
      inputImageCount: 0,
      providerId: 'relay',
      providerKind: 'openai_images' as const,
      model: 'image-model',
      prompt: 'A paper-cut fox',
      images: [{ path: '/tmp/fox.png', mimeType: 'image/png' as const }],
      durationMs: 42,
    }
    const block = ImageGenTool.mapToolResultToToolResultBlockParam(
      output,
      'image-tool-use',
    )

    expect(block).toEqual({
      tool_use_id: 'image-tool-use',
      type: 'tool_result',
      content: JSON.stringify(output),
    })
  })

  test('accepts ordered edit targets and reference images', () => {
    expect(ImageGenTool.inputSchema.parse({
      prompt: 'Combine these subjects while preserving their identity',
      input_images: [
        { path: '/staged/first.png', role: 'edit_target' },
        { path: '/staged/second.png', role: 'composite_source' },
      ],
    })).toEqual({
      prompt: 'Combine these subjects while preserving their identity',
      count: 1,
      input_images: [
        { path: '/staged/first.png', role: 'edit_target' },
        { path: '/staged/second.png', role: 'composite_source' },
      ],
    })
  })

  test('tells the agent not to retry provider failures automatically', async () => {
    expect(await ImageGenTool.prompt()).toContain(
      'do not retry ImageGen automatically',
    )
  })
})
