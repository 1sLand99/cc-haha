import { z } from 'zod/v4'

import {
  getImageGenerationRuntimeConfig,
} from '../../services/imageGeneration/config.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  generateImages,
  type ImageGenerationOutput,
} from './backend.js'
import { IMAGE_GEN_TOOL_NAME } from './constants.js'

const ASPECT_RATIOS = [
  'auto',
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '2:1',
  '1:2',
  '19.5:9',
  '9:19.5',
  '20:9',
  '9:20',
] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z
      .string()
      .min(1)
      .describe('A complete visual prompt describing the image to generate'),
    count: z
      .number()
      .int()
      .min(1)
      .max(4)
      .default(1)
      .describe('Number of variations for this exact prompt, from 1 to 4'),
    input_images: z
      .array(z.strictObject({
        path: z
          .string()
          .min(1)
          .describe('Absolute path from an [Image source: ...] attachment or a prior ImageGen result'),
        role: z
          .enum(['edit_target', 'reference', 'style_reference', 'composite_source'])
          .describe('How this ordered image should influence the edit'),
      }))
      .min(1)
      .max(3)
      .optional()
      .describe('Ordered source images for editing, compositing, or visual reference'),
    model: z
      .string()
      .min(1)
      .optional()
      .describe('Override the configured image model only when the user asks for one'),
    aspect_ratio: z
      .enum(ASPECT_RATIOS)
      .optional()
      .describe('Requested output aspect ratio'),
    resolution: z
      .enum(['1k', '2k'])
      .optional()
      .describe('Requested image resolution when supported'),
    size: z
      .enum(['auto', '1024x1024', '1024x1536', '1536x1024'])
      .optional()
      .describe('OpenAI-compatible image size'),
    quality: z.enum(['auto', 'low', 'medium', 'high']).optional(),
    background: z.enum(['auto', 'opaque', 'transparent']).optional(),
    output_format: z.enum(['png', 'jpeg', 'webp']).optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const generatedImageSchema = z.object({
  path: z.string(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  revisedPrompt: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    type: z.literal('image_generation_result'),
    operation: z.enum(['generate', 'edit']),
    inputImageCount: z.number().int().min(0).max(3),
    providerId: z.string(),
    providerKind: z.enum(['openai_oauth', 'grok_oauth', 'openai_images']),
    model: z.string(),
    prompt: z.string(),
    images: z.array(generatedImageSchema).min(1),
    durationMs: z.number().nonnegative(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const ImageGenTool = buildTool({
  name: IMAGE_GEN_TOOL_NAME,
  searchHint: 'generate images or artwork from a visual prompt',
  maxResultSizeChars: 100_000,
  strict: true,
  shouldDefer: true,
  async description() {
    return 'Generate one or more images with the image provider configured for this desktop session.'
  },
  async prompt() {
    return `Use this tool when the user asks to generate or edit an image. For edits, pass ordered input_images using only paths surfaced by [Image source: ...] in the current conversation or returned by a prior ImageGen call; repeat preservation constraints in every edit prompt. One call represents one distinct prompt; use count only for variations of that same prompt. The tool saves finished raster images locally and returns their absolute paths. If a provider call fails, do not retry ImageGen automatically; explain the error and wait for the user to decide.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return getImageGenerationRuntimeConfig() !== null
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.count} image(s): ${input.prompt}`
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  getToolUseSummary(input) {
    return input?.prompt?.trim() || null
  },
  getActivityDescription(input) {
    if (input?.input_images?.length) {
      return input.count && input.count > 1
        ? `Editing ${input.count} image variations`
        : 'Editing image'
    }
    return input?.count && input.count > 1
      ? `Generating ${input.count} images`
      : 'Generating image'
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    const config = getImageGenerationRuntimeConfig()
    if (!config) {
      throw new Error(
        'Image generation is not configured for the current provider. Enable it in provider settings.',
      )
    }
    return {
      data: await generateImages(input, config, {
        signal: context.abortController.signal,
      }),
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(output),
    }
  },
} satisfies ToolDef<InputSchema, ImageGenerationOutput>)
