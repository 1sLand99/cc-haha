import { cx } from '@/lib/cx'

/**
 * The 「哈」 seal — the "印" of 「纸 · 墨 · 印」.
 *
 * A terracotta rounded square holding one serif glyph. It replaces the raster
 * app icon inside the app chrome: the icon is a fixed bitmap, so it kept its
 * own colors under all six palettes while everything around it moved, and it
 * had no size below 32px that stayed legible.
 *
 * The glyph is Chinese, and only the latin cut of Noto Serif SC is
 * self-hosted, so it renders in the platform serif named by `--font-headline`
 * (Songti SC on macOS, Source Han Serif / SimSun elsewhere). That is the same
 * fallback the handoff prototype relies on.
 */
export type BrandSealSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * The three sizes the handoff calls for — sidebar 32, collapsed rail 38, empty
 * state 80 — plus a 24px one for dense chrome. The inner rule only appears at
 * `xl`: at 38px and below it closes up into a smudge.
 */
const SIZES: Record<BrandSealSize, {
  box: string
  radius: string
  glyph: string
  shadow: string
  rule: boolean
}> = {
  sm: { box: 'h-6 w-6', radius: 'rounded-[7px]', glyph: 'text-[12px]', shadow: 'shadow-[0_1px_2px_rgba(64,30,12,0.28)]', rule: false },
  md: { box: 'h-8 w-8', radius: 'rounded-[9px]', glyph: 'text-[16px]', shadow: 'shadow-[0_1px_3px_rgba(64,30,12,0.3)]', rule: false },
  lg: { box: 'h-[38px] w-[38px]', radius: 'rounded-[11px]', glyph: 'text-[18px]', shadow: 'shadow-[0_1px_3px_rgba(64,30,12,0.3)]', rule: false },
  xl: { box: 'h-20 w-20', radius: 'rounded-[22px]', glyph: 'text-[42px]', shadow: 'shadow-[0_10px_28px_rgba(100,45,20,0.3)]', rule: true },
}

export type BrandSealProps = {
  size?: BrandSealSize
  className?: string
}

export function BrandSeal({ size = 'md', className }: BrandSealProps) {
  const spec = SIZES[size]

  return (
    <span
      // Decorative: the product name sits next to it in the sidebar and above
      // it on the empty state, so announcing "哈" as well is duplicate noise.
      aria-hidden="true"
      className={cx(
        'relative inline-flex flex-shrink-0 items-center justify-center bg-[var(--color-brand)]',
        spec.box,
        spec.radius,
        spec.shadow,
        className,
      )}
    >
      {spec.rule && (
        <span className="pointer-events-none absolute inset-[5px] rounded-[17px] border-[1.5px] border-[var(--color-brand-seal-rule)]" />
      )}
      <span
        className={cx('font-black leading-none text-[var(--color-on-primary)]', spec.glyph)}
        style={{ fontFamily: 'var(--font-headline)' }}
      >
        哈
      </span>
    </span>
  )
}
