import { useMemo, useState } from 'react'
import { ImageIcon, Maximize2, TriangleAlert } from 'lucide-react'

import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton'
import { useTranslation } from '@/i18n'
import { localImageFileUrl } from '@/lib/attachmentImages'
import { ImageGalleryModal } from './ImageGalleryModal'

type GeneratedImage = {
  path: string
  mimeType: string
  revisedPrompt?: string
}

type ImageGenerationResult = {
  type: 'image_generation_result'
  operation: 'generate' | 'edit'
  inputImageCount: number
  providerId: string
  providerKind: string
  model: string
  prompt: string
  images: GeneratedImage[]
  durationMs: number
}

type Props = {
  input: unknown
  result?: { content: unknown; isError: boolean } | null
  compact?: boolean
  isPending?: boolean
  durationMs?: number
}

export function ImageGenerationBlock({
  input,
  result,
  compact = false,
  durationMs,
}: Props) {
  const t = useTranslation()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const inputRecord = isRecord(input) ? input : {}
  const parsedResult = result && !result.isError
    ? parseImageGenerationResult(result.content)
    : null
  const requestedCount = integerInRange(inputRecord.count, 1, 4)
  const slotCount = requestedCount ?? parsedResult?.images.length ?? 1
  const prompt = stringValue(inputRecord.prompt) ?? parsedResult?.prompt ?? ''
  const isEdit = (
    Array.isArray(inputRecord.referenced_image_paths) && inputRecord.referenced_image_paths.length > 0
  ) || (
    // Persisted calls from before the official imagegen argument alignment.
    Array.isArray(inputRecord.input_images) && inputRecord.input_images.length > 0
  ) || parsedResult?.operation === 'edit'
  const isWaiting = !result
  const errorText = result?.isError ? contentText(result.content) : ''
  const galleryImages = useMemo(
    () => (parsedResult?.images ?? []).map((image, index) => ({
      src: localImageFileUrl(image.path),
      name: fileName(image.path) || t('tool.generatedImageAlt', { index: index + 1 }),
    })),
    [parsedResult, t],
  )
  const ratio = cssAspectRatio(
    stringValue(inputRecord.aspect_ratio),
    stringValue(inputRecord.size),
  )
  const waitingLabel = isEdit
    ? slotCount === 1
      ? t('tool.imageGenerationEditingOne')
      : t('tool.imageGenerationEditing', { count: slotCount })
    : slotCount === 1
      ? t('tool.imageGenerationGeneratingOne')
      : t('tool.imageGenerationGenerating', { count: slotCount })
  const completeCount = parsedResult?.images.length ?? 0
  const completeLabel = isEdit
    ? completeCount === 1
      ? t('tool.imageGenerationEditCompleteOne')
      : t('tool.imageGenerationEditComplete', { count: completeCount })
    : completeCount === 1
      ? t('tool.imageGenerationCompleteOne')
      : t('tool.imageGenerationComplete', { count: completeCount })
  const failedLabel = isEdit
    ? t('tool.imageGenerationEditFailed')
    : t('tool.imageGenerationFailed')
  const statusLabel = isWaiting
    ? waitingLabel
    : result?.isError
      ? failedLabel
      : completeLabel
  const visibleDuration = durationMs ?? parsedResult?.durationMs
  const mediaWidthClass = slotCount > 1
    ? 'w-full'
    : ratio === '2 / 3'
      ? 'w-full max-w-[520px]'
      : ratio === '1 / 1'
        ? 'w-full max-w-[640px]'
        : 'w-full max-w-[780px]'

  return (
    <div
      data-testid="image-generation-block"
      data-layout="media-first"
      className={`min-w-0 ${compact ? 'mb-0' : 'mb-3'}`}
    >
      <div
        className="mb-2 flex min-h-5 items-center gap-1.5 text-[12px] text-[var(--color-text-tertiary)]"
        title={parsedResult
          ? `${parsedResult.model} · ${parsedResult.providerId}${prompt ? ` · ${prompt}` : ''}`
          : prompt || undefined}
      >
        {result?.isError ? (
          <TriangleAlert aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-[var(--color-error)]" />
        ) : (
          <ImageIcon aria-hidden size={14} strokeWidth={1.75} className="shrink-0" />
        )}
        <span className={result?.isError ? 'text-[var(--color-on-error-container)]' : undefined}>
          {statusLabel}
        </span>
        {isWaiting ? (
          <span
            aria-hidden
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text-tertiary)]"
          />
        ) : null}
        {!isWaiting && typeof visibleDuration === 'number' ? (
          <span className="font-mono tabular-nums text-[var(--color-outline)]">
            {formatDuration(visibleDuration)}
          </span>
        ) : null}
      </div>

      <div className={mediaWidthClass}>
        {isWaiting ? (
          <SkeletonGroup
            label={waitingLabel}
            className={`grid gap-2.5 ${slotCount === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}
          >
            {Array.from({ length: slotCount }, (_, index) => (
              <div
                key={index}
                data-testid="image-generation-slot"
                className="overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-surface-container-low)]"
                style={{ aspectRatio: ratio }}
              >
                <Skeleton shape="block" width="100%" height="100%" radius="lg" tone="strong" />
              </div>
            ))}
          </SkeletonGroup>
        ) : (
          <div className={`grid gap-2.5 ${slotCount === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {Array.from({ length: slotCount }, (_, index) => {
              const image = parsedResult?.images[index]
              if (image) {
                const src = localImageFileUrl(image.path)
                return (
                  <button
                    key={image.path}
                    type="button"
                    data-testid="image-generation-slot"
                    onClick={() => setActiveIndex(index)}
                    className="group/image relative block w-full overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] text-left transition-[border-color,transform] duration-200 hover:border-[var(--color-outline)] active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                    style={{ aspectRatio: ratio }}
                  >
                    <img
                      src={src}
                      alt={t('tool.generatedImageAlt', { index: index + 1 })}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                    <span className="absolute bottom-2 right-2 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface)] text-[var(--color-text-primary)] opacity-0 shadow-[var(--shadow-card)] transition-[opacity,transform] duration-200 group-hover/image:translate-y-0 group-hover/image:opacity-100 group-focus-visible/image:translate-y-0 group-focus-visible/image:opacity-100">
                      <Maximize2 aria-hidden size={15} strokeWidth={1.75} />
                    </span>
                  </button>
                )
              }

              return (
                <div
                  key={index}
                  data-testid="image-generation-slot"
                  data-error="true"
                  className="flex items-center justify-center rounded-[var(--radius-xl)] border border-[var(--color-error)] bg-[var(--color-error-container)] p-5 text-center text-xs text-[var(--color-on-error-container)]"
                  style={{ aspectRatio: ratio }}
                >
                  <span>
                    {result?.isError
                      ? errorText || failedLabel
                      : t('tool.imageGenerationMissing')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {activeIndex !== null && galleryImages[activeIndex] ? (
        <ImageGalleryModal
          open
          images={galleryImages}
          activeIndex={activeIndex}
          onClose={() => setActiveIndex(null)}
          onSelect={setActiveIndex}
        />
      ) : null}
    </div>
  )
}

export function parseImageGenerationResult(content: unknown): ImageGenerationResult | null {
  const value = parseContentValue(content)
  if (
    !isRecord(value) ||
    value.type !== 'image_generation_result' ||
    typeof value.providerId !== 'string' ||
    typeof value.providerKind !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.prompt !== 'string' ||
    typeof value.durationMs !== 'number' ||
    !Array.isArray(value.images)
  ) {
    return null
  }

  const images = value.images.flatMap((item): GeneratedImage[] => {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.mimeType !== 'string') {
      return []
    }
    return [{
      path: item.path,
      mimeType: item.mimeType,
      ...(typeof item.revisedPrompt === 'string'
        ? { revisedPrompt: item.revisedPrompt }
        : {}),
    }]
  })
  if (images.length === 0) return null

  return {
    type: 'image_generation_result',
    operation: value.operation === 'edit' ? 'edit' : 'generate',
    inputImageCount: typeof value.inputImageCount === 'number'
      ? value.inputImageCount
      : 0,
    providerId: value.providerId,
    providerKind: value.providerKind,
    model: value.model,
    prompt: value.prompt,
    images,
    durationMs: value.durationMs,
  }
}

function parseContentValue(content: unknown): unknown {
  if (isRecord(content)) return content
  const text = contentText(content)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => typeof item === 'string'
        ? item
        : isRecord(item) && typeof item.text === 'string'
          ? item.text
          : '')
      .filter(Boolean)
      .join('\n')
  }
  return isRecord(content) ? JSON.stringify(content) : ''
}

function cssAspectRatio(aspectRatio?: string, size?: string): string {
  const requested = aspectRatio && aspectRatio !== 'auto'
    ? aspectRatio
    : size === '1024x1536'
      ? '2:3'
      : size === '1536x1024'
        ? '3:2'
        : '1:1'
  const [width, height] = requested.split(':').map(Number)
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0
    ? `${width} / ${height}`
    : '1 / 1'
}

function integerInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const seconds = Math.round(durationMs / 100) / 10
  return `${seconds}s`
}
