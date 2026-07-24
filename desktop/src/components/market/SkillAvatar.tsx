import type { NormalizedSkill } from '../../types/market'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'

const AVATAR_GRADIENTS = [
  ['#9A5942', '#6F3827'],
  ['#4F746D', '#31564F'],
  ['#6C7651', '#465334'],
  ['#6A687C', '#464558'],
  ['#8A633D', '#634421'],
  ['#647183', '#404C5C'],
] as const

/** Deterministic palette index so every skill keeps a stable, restrained identity color. */
function hashIndex(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % AVATAR_GRADIENTS.length
}

/** First visible character of the name, uppercased (handles CJK and multi-byte chars). */
function initialOf(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? first.toUpperCase() : '?'
}

/**
 * Skill icon with a deterministic letter-avatar fallback. The palette stays
 * deliberately muted so a catalog of community skills still reads as one
 * product rather than a wall of unrelated app icons.
 */
export function SkillAvatar({
  skill,
  size = 40,
  className = '',
}: {
  skill: Pick<NormalizedSkill, 'name' | 'iconUrl'>
  size?: number
  className?: string
}) {
  const [from, to] = AVATAR_GRADIENTS[hashIndex(skill.name)]!
  return (
    <Avatar
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-container)] shadow-[0_1px_2px_rgba(27,28,26,0.08)] ${className}`}
    >
      {skill.iconUrl && <AvatarImage src={skill.iconUrl} alt="" />}
      <AvatarFallback
        data-testid="skill-avatar-fallback"
        style={{
          fontSize: Math.round(size * 0.45),
          background: `linear-gradient(145deg, ${from}, ${to})`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 3px 10px rgba(27,28,26,0.12)',
        }}
        className="select-none rounded-[13px] font-semibold tracking-[-0.04em] text-white"
      >
        {initialOf(skill.name)}
      </AvatarFallback>
    </Avatar>
  )
}
