import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Activity, Pencil, Plug, Puzzle, Trash2, Upload, X } from 'lucide-react'
import { activityStatsApi, type ActivityStatsResponse, type DailyActivity } from '../api/activityStats'
import {
  desktopUiPreferencesApi,
  getProfileAvatarUrl,
  type DesktopProfilePreferences,
} from '../api/desktopUiPreferences'
import { type Locale, useTranslation } from '../i18n'
import { useSettingsStore } from '../stores/settingsStore'
import { publicAssetPath } from '../lib/publicAsset'
import { Alert, AlertDescription } from '../components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog'
import { Avatar } from '../components/ui/avatar'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Skeleton } from '../components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import {
  ActivityHeatmap,
  type ActivityHeatmapDay,
  type ActivityHeatmapMode,
} from '../components/ui/custom/activity-heatmap'
import { IconButton } from '../components/ui/custom/icon-button'
import { LoadingButton } from '../components/ui/custom/loading-button'

type HeatmapDay = ActivityHeatmapDay

type SummaryMetric = {
  label: string
  value: string
  detail?: string
}

type InsightMetric = {
  label: string
  value: string
  detail?: string
}

type PluginRankItem = {
  id: string
  label: string
  count: number
  kind: 'plugin' | 'skill'
}

type HeatmapMode = ActivityHeatmapMode
type ProfileMutation = 'idle' | 'saving' | 'uploadingAvatar' | 'removingAvatar'

const WEEK_COUNT = 52
const WEEKDAY_LABEL_KEYS = [
  'settings.activity.weekday.mon',
  'settings.activity.weekday.wed',
  'settings.activity.weekday.fri',
] as const
const DATE_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
  jp: 'ja-JP',
  kr: 'ko-KR',
}
const DEFAULT_PROFILE: DesktopProfilePreferences = {
  displayName: 'cc-haha',
  subtitle: 'github.com/NanmiCoder/cc-haha',
  avatarFile: null,
  avatarUpdatedAt: null,
}
const DEFAULT_AVATAR_SRC = publicAssetPath('app-icon.png')

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseLocalDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`)
}

function parseUtcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function startOfUtcWeek(date: Date) {
  const next = new Date(date)
  next.setUTCHours(0, 0, 0, 0)
  next.setUTCDate(next.getUTCDate() - next.getUTCDay())
  return next
}

function formatDateLabel(dateKey: string, locale: Locale) {
  return parseLocalDate(dateKey).toLocaleDateString(DATE_LOCALES[locale], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTokens(tokens: number) {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(tokens >= 10_000_000_000 ? 0 : 1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}

function formatInteger(value: number, locale: Locale) {
  return new Intl.NumberFormat(DATE_LOCALES[locale], { maximumFractionDigits: 0 }).format(value)
}

function formatPercent(numerator: number, denominator: number, locale: Locale) {
  if (denominator <= 0) return '0%'
  return new Intl.NumberFormat(DATE_LOCALES[locale], {
    maximumFractionDigits: 0,
    style: 'percent',
  }).format(numerator / denominator)
}

function formatDayCount(value: number, t: ReturnType<typeof useTranslation>) {
  return t(value === 1 ? 'settings.activity.count.dayOne' : 'settings.activity.count.dayOther', { count: value })
}

function formatTaskDuration(duration: number | undefined, locale: Locale, t: ReturnType<typeof useTranslation>) {
  if (!duration || duration <= 0) return t('settings.activity.noDuration')
  const totalMinutes = Math.max(1, Math.round(duration / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (locale === 'zh') {
    if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`
    if (hours > 0) return `${hours} 小时`
    return `${minutes} 分钟`
  }

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

function formatSessionCount(value: number, t: ReturnType<typeof useTranslation>) {
  return t(value === 1 ? 'settings.activity.count.sessionOne' : 'settings.activity.count.sessionOther', { count: value })
}

function formatMessageCount(value: number, t: ReturnType<typeof useTranslation>) {
  return `${value} ${t('settings.activity.messages')}`
}

function formatRunCount(value: number, t: ReturnType<typeof useTranslation>) {
  return t(value === 1 ? 'settings.activity.count.runOne' : 'settings.activity.count.runOther', { count: value })
}

function getModelTokenTotal(usage: ActivityStatsResponse['modelUsage'][string] | undefined) {
  if (!usage) return 0
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0)
  )
}

function formatModelName(model: string) {
  return model
    .replace(/^claude-/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getPluginNameFromToolName(toolName: string) {
  if (!toolName.startsWith('mcp__')) return null
  const parts = toolName.split('__').filter(Boolean)
  const serverName = parts[1]
  if (!serverName) return null
  if (serverName === 'codex_apps' && parts[2]) return parts[2]
  return serverName
}

function formatPluginName(pluginName: string) {
  return pluginName.replace(/_/g, '-')
}

function buildPluginAndSkillRankItems(stats: ActivityStatsResponse | null) {
  const skillItems = Object.entries(stats?.skillUsage ?? {}).map<PluginRankItem>(([skill, count]) => ({
    id: `skill:${skill}`,
    label: `$${skill}`,
    count,
    kind: 'skill',
  }))

  const pluginUsage = new Map<string, number>()
  for (const [toolName, count] of Object.entries(stats?.toolUsage ?? {})) {
    const pluginName = getPluginNameFromToolName(toolName)
    if (!pluginName || count <= 0) continue
    pluginUsage.set(pluginName, (pluginUsage.get(pluginName) || 0) + count)
  }
  const pluginItems = [...pluginUsage.entries()].map<PluginRankItem>(([pluginName, count]) => ({
    id: `plugin:${pluginName}`,
    label: `@${formatPluginName(pluginName)}`,
    count,
    kind: 'plugin',
  }))

  return [...skillItems, ...pluginItems]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6)
}

function withProfileDefaults(profile: Partial<DesktopProfilePreferences> | null | undefined): DesktopProfilePreferences {
  return { ...DEFAULT_PROFILE, ...profile }
}

function getProfileSubtitleHref(subtitle: string) {
  if (/^https?:\/\//i.test(subtitle)) return subtitle
  if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(subtitle)) return `https://${subtitle}`
  return null
}

function sumDailyUsage(days: HeatmapDay[]) {
  return days.reduce(
    (sum, day) => ({
      sessions: sum.sessions + day.sessionCount,
      tokens: sum.tokens + day.tokens,
    }),
    { sessions: 0, tokens: 0 },
  )
}

function getDailyTokenMap(stats: ActivityStatsResponse | null) {
  const map = new Map<string, number>()
  for (const day of stats?.dailyModelTokens ?? []) {
    const total = Object.values(day.tokensByModel).reduce((sum, tokens) => sum + tokens, 0)
    map.set(day.date, total)
  }
  return map
}

function getHeatLevel(day: DailyActivity | undefined, tokens: number, maxScore: number) {
  const sessionCount = day?.sessionCount ?? 0
  if (sessionCount === 0 && tokens === 0) return 0
  if (maxScore <= 0) return 1

  const score = sessionCount * 3 + Math.ceil(tokens / 50_000)
  const ratio = score / maxScore
  if (ratio >= 0.78) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.24) return 2
  return 1
}

function getBarHeight(value: number, maxValue: number) {
  if (value <= 0 || maxValue <= 0) return 0
  return Math.max(1, Math.min(7, Math.ceil((value / maxValue) * 7)))
}

function getBarLevel(value: number, maxValue: number) {
  if (value <= 0) return 0
  if (maxValue <= 0) return 1
  const ratio = value / maxValue
  if (ratio >= 0.78) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.24) return 2
  return 1
}

function buildHeatmapDays(stats: ActivityStatsResponse | null, mode: HeatmapMode) {
  const generatedAt = stats?.generatedAt ? new Date(stats.generatedAt) : new Date()
  const today = parseUtcDate(utcDateKey(generatedAt))

  const finalWeekStart = startOfUtcWeek(today)
  const start = addUtcDays(finalWeekStart, -(WEEK_COUNT - 1) * 7)
  const activityMap = new Map((stats?.dailyActivity ?? []).map((day) => [day.date, day]))
  const tokenMap = getDailyTokenMap(stats)
  const dates: string[] = []
  for (let cursor = new Date(start); cursor <= today; cursor = addUtcDays(cursor, 1)) {
    dates.push(utcDateKey(cursor))
  }

  const scores: number[] = []
  let cumulativeTokens = 0
  for (const dateKey of dates) {
    const day = activityMap.get(dateKey)
    const tokens = tokenMap.get(dateKey) ?? 0
    cumulativeTokens += tokens
    scores.push((day?.sessionCount ?? 0) * 3 + Math.ceil(tokens / 50_000))
  }
  const maxScore = Math.max(...scores, 0)

  const days: HeatmapDay[] = []
  cumulativeTokens = 0
  for (const dateKey of dates) {
    const day = activityMap.get(dateKey)
    const tokens = tokenMap.get(dateKey) ?? 0
    cumulativeTokens += tokens
    days.push({
      date: dateKey,
      sessionCount: day?.sessionCount ?? 0,
      messageCount: day?.messageCount ?? 0,
      toolCallCount: day?.toolCallCount ?? 0,
      tokens,
      level: getHeatLevel(day, tokens, maxScore),
      mode: 'daily',
    })
  }

  if (mode === 'daily') return days

  const weeks = Array.from({ length: WEEK_COUNT }, (_, index) => {
    const rangeStart = dates[index * 7] ?? ''
    const rangeEnd = dates[Math.min(index * 7 + 6, dates.length - 1)] ?? rangeStart
    return {
      rangeStart,
      rangeEnd,
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      tokens: 0,
      cumulativeTokens: 0,
    }
  })

  dates.forEach((dateKey, index) => {
    const week = weeks[Math.floor(index / 7)]
    const day = activityMap.get(dateKey)
    if (!week) return
    week.sessionCount += day?.sessionCount ?? 0
    week.messageCount += day?.messageCount ?? 0
    week.toolCallCount += day?.toolCallCount ?? 0
    week.tokens += tokenMap.get(dateKey) ?? 0
  })

  let runningTotal = 0
  for (const week of weeks) {
    runningTotal += week.tokens
    week.cumulativeTokens = runningTotal
  }

  const maxValue = Math.max(
    ...weeks.map((week) => (mode === 'weekly' ? week.tokens : week.cumulativeTokens)),
    0,
  )

  return dates.map((dateKey, index) => {
    const week = weeks[Math.floor(index / 7)]
    const row = index % 7
    const tokens = mode === 'weekly' ? week?.tokens ?? 0 : week?.cumulativeTokens ?? 0
    const height = getBarHeight(tokens, maxValue)
    const isFilled = height > 0 && row >= 7 - height

    return {
      date: dateKey,
      sessionCount: week?.sessionCount ?? 0,
      messageCount: week?.messageCount ?? 0,
      toolCallCount: week?.toolCallCount ?? 0,
      tokens,
      level: isFilled ? getBarLevel(tokens, maxValue) : 0,
      mode,
      rangeStart: week?.rangeStart,
      rangeEnd: week?.rangeEnd,
    }
  })
}

function buildMonthLabels(days: HeatmapDay[], locale: Locale) {
  if (days.length === 0) return []
  const labels: Array<{ week: number; label: string }> = []
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  if (!firstDay || !lastDay) return labels

  const firstDate = parseLocalDate(firstDay.date)
  const lastDate = parseLocalDate(lastDay.date)
  let previousMonth = -1

  for (let week = 0; week < WEEK_COUNT; week += 1) {
    const weekDate = new Date(firstDate)
    weekDate.setDate(weekDate.getDate() + week * 7)
    if (weekDate > lastDate) break
    if (weekDate.getMonth() !== previousMonth) {
      labels.push({
        week,
        label: weekDate.toLocaleDateString(DATE_LOCALES[locale], { month: 'short' }),
      })
      previousMonth = weekDate.getMonth()
    }
  }

  return labels
}

function getHeatmapCellTitle(day: HeatmapDay, locale: Locale, t: ReturnType<typeof useTranslation>) {
  if (day.mode === 'weekly') {
    return t('settings.activity.weekRange', {
      start: formatDateLabel(day.rangeStart ?? day.date, locale),
      end: formatDateLabel(day.rangeEnd ?? day.date, locale),
    })
  }

  if (day.mode === 'cumulative') {
    return t('settings.activity.cumulativeThrough', {
      date: formatDateLabel(day.rangeEnd ?? day.date, locale),
    })
  }

  return formatDateLabel(day.date, locale)
}

function getHeatmapCellDetail(day: HeatmapDay, t: ReturnType<typeof useTranslation>) {
  if (day.mode === 'cumulative') {
    return t('settings.activity.tokenValue', { tokens: formatTokens(day.tokens) })
  }

  return `${formatSessionCount(day.sessionCount, t)} · ${formatTokens(day.tokens)} ${t('settings.activity.tokens')}`
}

export function ActivitySettings() {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const displayNameInputRef = useRef<HTMLInputElement | null>(null)
  const profileEditTriggerRef = useRef<HTMLButtonElement | null>(null)
  const changeAvatarButtonRef = useRef<HTMLButtonElement | null>(null)
  const removeAvatarTriggerRef = useRef<HTMLButtonElement | null>(null)
  const statsRequestRef = useRef(0)
  const profileRequestRef = useRef(0)
  const profileOperationIdRef = useRef(0)
  const profileMutationRef = useRef<ProfileMutation>('idle')
  const [stats, setStats] = useState<ActivityStatsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<DesktopProfilePreferences>(DEFAULT_PROFILE)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileStatus, setProfileStatus] = useState<string | null>(null)
  const [isProfileLoading, setIsProfileLoading] = useState(true)
  const [isProfileLoaded, setIsProfileLoaded] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [profileMutation, setProfileMutation] = useState<ProfileMutation>('idle')
  const [isRemoveAvatarOpen, setIsRemoveAvatarOpen] = useState(false)
  const [draftDisplayName, setDraftDisplayName] = useState(DEFAULT_PROFILE.displayName)
  const [draftSubtitle, setDraftSubtitle] = useState(DEFAULT_PROFILE.subtitle)
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('daily')
  const isProfileBusy = profileMutation !== 'idle'

  const loadStats = useCallback(async () => {
    const requestId = ++statsRequestRef.current
    setIsLoading(true)
    setError(null)
    try {
      const nextStats = await activityStatsApi.getStats('all')
      if (statsRequestRef.current !== requestId) return
      setStats(nextStats)
    } catch (err) {
      if (statsRequestRef.current !== requestId) return
      setStats(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (statsRequestRef.current === requestId) setIsLoading(false)
    }
  }, [])

  const loadProfile = useCallback(async () => {
    const requestId = ++profileRequestRef.current
    setIsProfileLoading(true)
    setIsProfileLoaded(false)
    setProfileError(null)
    try {
      const result = await desktopUiPreferencesApi.getPreferences()
      if (profileRequestRef.current !== requestId) return
      const nextProfile = withProfileDefaults(result.preferences.profile)
      setProfile(nextProfile)
      setDraftDisplayName(nextProfile.displayName)
      setDraftSubtitle(nextProfile.subtitle)
      setIsProfileLoaded(true)
    } catch (err) {
      if (profileRequestRef.current !== requestId) return
      setProfileError(err instanceof Error ? err.message : String(err))
    } finally {
      if (profileRequestRef.current === requestId) setIsProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStats()
    return () => {
      statsRequestRef.current += 1
    }
  }, [loadStats])

  useEffect(() => {
    void loadProfile()
    return () => {
      profileRequestRef.current += 1
    }
  }, [loadProfile])

  useEffect(() => () => {
    profileOperationIdRef.current += 1
  }, [])

  const days = useMemo(() => buildHeatmapDays(stats, heatmapMode), [heatmapMode, stats])
  const dailyDays = useMemo(() => buildHeatmapDays(stats, 'daily'), [stats])
  const monthLabels = useMemo(() => buildMonthLabels(days, locale), [days, locale])
  const today = dailyDays.length > 0 ? dailyDays[dailyDays.length - 1] : null
  const last30Usage = sumDailyUsage(dailyDays.slice(-30))
  const totalTokens = useMemo(() => {
    return (stats?.dailyModelTokens ?? []).reduce((sum, day) => (
      sum + Object.values(day.tokensByModel).reduce((daySum, tokens) => daySum + tokens, 0)
    ), 0)
  }, [stats])
  const totalToolCalls = useMemo(() => {
    return (stats?.dailyActivity ?? []).reduce((sum, day) => sum + day.toolCallCount, 0)
  }, [stats])
  const totalSkillUses = useMemo(() => {
    return Object.values(stats?.skillUsage ?? {}).reduce((sum, count) => sum + count, 0)
  }, [stats])
  const exploredSkillsCount = Object.keys(stats?.skillUsage ?? {}).length
  const topModel = useMemo(() => {
    return Object.entries(stats?.modelUsage ?? {}).reduce<{
      model: string
      tokens: number
    } | null>((top, [model, usage]) => {
      const tokens = getModelTokenTotal(usage)
      if (tokens <= 0) return top
      if (!top || tokens > top.tokens) return { model, tokens }
      return top
    }, null)
  }, [stats])
  const peakTokens = useMemo(() => {
    return (stats?.dailyModelTokens ?? []).reduce((peak, day) => {
      const dayTotal = Object.values(day.tokensByModel).reduce((sum, tokens) => sum + tokens, 0)
      return Math.max(peak, dayTotal)
    }, 0)
  }, [stats])
  const topPluginItems = useMemo(() => buildPluginAndSkillRankItems(stats), [stats])
  const metrics: SummaryMetric[] = [
    {
      label: t('settings.activity.totalTokens'),
      value: formatTokens(totalTokens),
      detail: formatDayCount(stats?.activeDays ?? 0, t),
    },
    {
      label: t('settings.activity.peakTokens'),
      value: formatTokens(peakTokens),
      detail: stats?.peakActivityDay ? formatDateLabel(stats.peakActivityDay, locale) : undefined,
    },
    {
      label: t('settings.activity.longestTask'),
      value: formatTaskDuration(stats?.longestSession?.duration, locale, t),
      detail: stats?.longestSession ? formatMessageCount(stats.longestSession.messageCount, t) : undefined,
    },
    {
      label: t('settings.activity.currentStreak'),
      value: formatDayCount(stats?.streaks.currentStreak ?? 0, t),
      detail: today ? `${formatTokens(today.tokens)} ${t('settings.activity.tokens')}` : undefined,
    },
    {
      label: t('settings.activity.longestStreak'),
      value: formatDayCount(stats?.streaks.longestStreak ?? 0, t),
      detail: formatSessionCount(last30Usage.sessions, t),
    },
  ]
  const insightMetrics: InsightMetric[] = [
    {
      label: t('settings.activity.activeRate'),
      value: formatPercent(stats?.activeDays ?? 0, stats?.totalDays ?? 0, locale),
    },
    {
      label: t('settings.activity.mostUsedModel'),
      value: topModel ? formatModelName(topModel.model) : t('settings.activity.none'),
      detail: topModel ? `${formatTokens(topModel.tokens)} ${t('settings.activity.tokens')}` : undefined,
    },
    {
      label: t('settings.activity.exploredSkills'),
      value: formatInteger(exploredSkillsCount, locale),
    },
    {
      label: t('settings.activity.totalSkillUses'),
      value: formatInteger(totalSkillUses, locale),
    },
    {
      label: t('settings.activity.totalToolCalls'),
      value: formatInteger(totalToolCalls, locale),
    },
    {
      label: t('settings.activity.totalSessions'),
      value: formatInteger(stats?.totalSessions ?? 0, locale),
    },
  ]
  const avatarSrc = profile.avatarFile ? getProfileAvatarUrl(profile.avatarUpdatedAt) : DEFAULT_AVATAR_SRC
  const avatarClassName = profile.avatarFile
    ? 'h-full w-full object-cover'
    : 'h-full w-full scale-[1.28] object-contain transition-transform'
  const profileSubtitleHref = getProfileSubtitleHref(profile.subtitle)
  const hasUsage = Boolean(stats && (stats.totalSessions > 0 || totalTokens > 0))
  const modeOptions: Array<{ mode: HeatmapMode; label: string; help: string }> = [
    { mode: 'daily', label: t('settings.activity.mode.daily'), help: t('settings.activity.modeHelp.daily') },
    { mode: 'weekly', label: t('settings.activity.mode.weekly'), help: t('settings.activity.modeHelp.weekly') },
    { mode: 'cumulative', label: t('settings.activity.mode.cumulative'), help: t('settings.activity.modeHelp.cumulative') },
  ]

  const beginProfileMutation = (mutation: Exclude<ProfileMutation, 'idle'>) => {
    if (profileMutationRef.current !== 'idle') return null
    const operationId = ++profileOperationIdRef.current
    profileMutationRef.current = mutation
    setProfileMutation(mutation)
    setProfileError(null)
    setProfileStatus(null)
    return operationId
  }

  const finishProfileMutation = (operationId: number) => {
    if (profileOperationIdRef.current !== operationId) return
    profileMutationRef.current = 'idle'
    setProfileMutation('idle')
  }

  const resetProfileDraft = () => {
    setDraftDisplayName(profile.displayName)
    setDraftSubtitle(profile.subtitle)
    setProfileError(null)
  }

  const handleProfileDialogOpenChange = (open: boolean) => {
    if (!open && profileMutationRef.current !== 'idle') return
    setIsEditingProfile(open)
    if (open) {
      setDraftDisplayName(profile.displayName)
      setDraftSubtitle(profile.subtitle)
      setProfileError(null)
      setProfileStatus(null)
    } else {
      resetProfileDraft()
    }
  }

  const saveProfile = async (event?: FormEvent) => {
    event?.preventDefault()
    const operationId = beginProfileMutation('saving')
    if (operationId === null) return
    try {
      const result = await desktopUiPreferencesApi.updateProfilePreferences({
        displayName: draftDisplayName,
        subtitle: draftSubtitle,
      })
      if (profileOperationIdRef.current !== operationId) return
      const nextProfile = withProfileDefaults(result.preferences.profile)
      setProfile(nextProfile)
      setDraftDisplayName(nextProfile.displayName)
      setDraftSubtitle(nextProfile.subtitle)
      setIsEditingProfile(false)
      setProfileStatus(t('settings.activity.profileSaved'))
    } catch (err) {
      if (profileOperationIdRef.current !== operationId) return
      setProfileError(err instanceof Error ? err.message : t('settings.activity.profileSaveFailed'))
    } finally {
      finishProfileMutation(operationId)
    }
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setProfileError(t('settings.activity.avatarInvalidType'))
      return
    }
    if (file.size > 2_000_000) {
      setProfileError(t('settings.activity.avatarTooLarge'))
      return
    }
    const operationId = beginProfileMutation('uploadingAvatar')
    if (operationId === null) return
    try {
      const result = await desktopUiPreferencesApi.uploadProfileAvatar(file)
      if (profileOperationIdRef.current !== operationId) return
      const nextProfile = withProfileDefaults(result.preferences.profile)
      setProfile(nextProfile)
      setProfileStatus(t('settings.activity.profileSaved'))
    } catch (err) {
      if (profileOperationIdRef.current !== operationId) return
      setProfileError(err instanceof Error ? err.message : t('settings.activity.profileSaveFailed'))
    } finally {
      finishProfileMutation(operationId)
    }
  }

  const removeAvatar = async () => {
    const operationId = beginProfileMutation('removingAvatar')
    if (operationId === null) return
    try {
      const result = await desktopUiPreferencesApi.deleteProfileAvatar()
      if (profileOperationIdRef.current !== operationId) return
      setProfile(withProfileDefaults(result.preferences.profile))
      setProfileStatus(t('settings.activity.profileSaved'))
      setIsRemoveAvatarOpen(false)
    } catch (err) {
      if (profileOperationIdRef.current !== operationId) return
      setProfileError(err instanceof Error ? err.message : t('settings.activity.profileSaveFailed'))
    } finally {
      finishProfileMutation(operationId)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1060px] min-w-0 pb-12">
      <section className="relative flex min-h-[176px] flex-col items-center justify-start pt-4 text-center">
        {isProfileLoading ? (
          <>
            <Skeleton className="size-16 rounded-full" aria-label={t('common.loading')} />
            <Skeleton className="mt-4 h-9 w-52" />
            <Skeleton className="mt-2 h-5 w-64 max-w-full" />
          </>
        ) : (
          <>
            <Avatar className="size-16 border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[0_10px_28px_-22px_rgba(15,23,42,0.6)]">
              <img
                src={avatarSrc}
                alt={`${profile.displayName} avatar`}
                className={avatarClassName}
                onError={(event) => {
                  event.currentTarget.src = DEFAULT_AVATAR_SRC
                  event.currentTarget.className = 'h-full w-full scale-[1.28] object-contain transition-transform'
                }}
              />
            </Avatar>
            <div className="group/activity-profile mt-4 flex max-w-full items-center justify-center gap-2">
              <h1 className="max-w-[min(720px,calc(100%-2.25rem))] truncate text-[28px] font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-[34px]">
                {profile.displayName}
              </h1>
              <Dialog open={isEditingProfile} onOpenChange={handleProfileDialogOpenChange}>
                <DialogTrigger asChild>
                  <IconButton
                    ref={profileEditTriggerRef}
                    label={t('settings.activity.editProfile')}
                    variant="ghost"
                    className="mt-1 opacity-0 group-hover/activity-profile:opacity-100 focus-visible:opacity-100"
                    disabled={!isProfileLoaded}
                  >
                    <Pencil aria-hidden="true" />
                  </IconButton>
                </DialogTrigger>
                <DialogContent
                  showCloseButton={false}
                  className="max-h-[min(88vh,620px)] w-[min(92vw,440px)] overflow-y-auto"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    displayNameInputRef.current?.focus()
                  }}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    queueMicrotask(() => profileEditTriggerRef.current?.focus())
                  }}
                  onEscapeKeyDown={(event) => {
                    if (profileMutationRef.current !== 'idle') event.preventDefault()
                  }}
                  onPointerDownOutside={(event) => event.preventDefault()}
                  onInteractOutside={(event) => event.preventDefault()}
                >
                  <DialogHeader className="relative">
                    <DialogTitle className="text-base">
                      {t('settings.activity.editProfile')}
                    </DialogTitle>
                    <DialogDescription className="text-xs leading-5">
                      {t('settings.activity.displayNameHelper')}
                    </DialogDescription>
                    <IconButton
                      label={t('settings.activity.cancelEdit')}
                      variant="ghost"
                      className="absolute -right-1 -top-1"
                      disabled={isProfileBusy}
                      onClick={() => handleProfileDialogOpenChange(false)}
                    >
                      <X aria-hidden="true" />
                    </IconButton>
                  </DialogHeader>

                  <form className="grid gap-5" onSubmit={saveProfile}>
                    <div className="grid gap-2">
                      <Label htmlFor="activity-profile-display-name">
                        {t('settings.activity.displayName')}
                      </Label>
                      <Input
                        ref={displayNameInputRef}
                        id="activity-profile-display-name"
                        value={draftDisplayName}
                        maxLength={80}
                        required
                        disabled={isProfileBusy}
                        onChange={(event) => setDraftDisplayName(event.target.value)}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="activity-profile-subtitle">
                        {t('settings.activity.subtitle')}
                      </Label>
                      <Input
                        id="activity-profile-subtitle"
                        value={draftSubtitle}
                        maxLength={160}
                        required
                        disabled={isProfileBusy}
                        onChange={(event) => setDraftSubtitle(event.target.value)}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="activity-profile-avatar">
                        {t('settings.activity.avatar')}
                      </Label>
                      <p id="activity-profile-avatar-help" className="text-xs text-[var(--color-text-tertiary)]">
                        {t('settings.activity.avatarHelper')} {t('settings.activity.avatarImmediate')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          ref={avatarInputRef}
                          id="activity-profile-avatar"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          aria-describedby="activity-profile-avatar-help"
                          disabled={isProfileBusy}
                          onChange={handleAvatarChange}
                        />
                        <LoadingButton
                          ref={changeAvatarButtonRef}
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={profileMutation === 'uploadingAvatar'}
                          disabled={isProfileBusy}
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          <Upload aria-hidden="true" />
                          {t('settings.activity.changeAvatar')}
                        </LoadingButton>
                        {profile.avatarFile && (
                          <AlertDialog
                            open={isRemoveAvatarOpen}
                            onOpenChange={(open) => {
                              if (profileMutationRef.current === 'removingAvatar' && !open) return
                              setIsRemoveAvatarOpen(open)
                            }}
                          >
                            <AlertDialogTrigger asChild>
                              <Button
                                ref={removeAvatarTriggerRef}
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={isProfileBusy}
                              >
                                <Trash2 aria-hidden="true" />
                                {t('settings.activity.removeAvatar')}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent
                              onCloseAutoFocus={(event) => {
                                event.preventDefault()
                                queueMicrotask(() => {
                                  const target = removeAvatarTriggerRef.current ?? changeAvatarButtonRef.current
                                  target?.focus()
                                })
                              }}
                            >
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {t('settings.activity.removeAvatarTitle')}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t('settings.activity.removeAvatarDescription')}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              {profileError && (
                                <Alert variant="destructive">
                                  <AlertDescription>{profileError}</AlertDescription>
                                </Alert>
                              )}
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={profileMutation === 'removingAvatar'}>
                                  {t('common.cancel')}
                                </AlertDialogCancel>
                                <LoadingButton
                                  type="button"
                                  variant="destructive"
                                  loading={profileMutation === 'removingAvatar'}
                                  onClick={removeAvatar}
                                >
                                  {t('settings.activity.removeAvatar')}
                                </LoadingButton>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>

                    {profileError && !isRemoveAvatarOpen && (
                      <Alert variant="destructive">
                        <AlertDescription>{profileError}</AlertDescription>
                      </Alert>
                    )}
                    {profileStatus && (
                      <div role="status" className="text-xs text-[var(--color-success)]">
                        {profileStatus}
                      </div>
                    )}

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isProfileBusy}
                        onClick={() => handleProfileDialogOpenChange(false)}
                      >
                        {t('settings.activity.cancelEdit')}
                      </Button>
                      <LoadingButton
                        type="submit"
                        loading={profileMutation === 'saving'}
                        disabled={isProfileBusy}
                      >
                        {t('settings.activity.saveProfile')}
                      </LoadingButton>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            {profileSubtitleHref ? (
              <a
                href={profileSubtitleHref}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex max-w-full items-center justify-center gap-2 truncate text-base text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
              >
                <span>{profile.subtitle}</span>
              </a>
            ) : (
              <div className="mt-2 max-w-full truncate text-base text-[var(--color-text-tertiary)]">
                {profile.subtitle}
              </div>
            )}
          </>
        )}

        {profileStatus && !isEditingProfile && (
          <Badge role="status" variant="outline" className="mt-3 border-[var(--color-success)]/30 text-[var(--color-success)]">
            {profileStatus}
          </Badge>
        )}
        {profileError && !isEditingProfile && (
          <Alert variant="destructive" className="mt-3 max-w-md">
            <AlertDescription>{profileError}</AlertDescription>
            {!isProfileLoaded && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-1 justify-self-start"
                onClick={() => void loadProfile()}
              >
                {t('common.retry')}
              </Button>
            )}
          </Alert>
        )}
      </section>

      {!error && (
        <Card className="activity-summary-panel mx-auto mt-7 w-full max-w-[900px] overflow-hidden rounded-2xl bg-[var(--color-border)] p-px shadow-[0_12px_34px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="activity-summary-grid grid gap-px" aria-busy="true">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className={`activity-summary-metric min-h-[76px] bg-[var(--color-surface)] px-4 py-3 ${
                      index === 0 ? 'activity-summary-metric-primary' : ''
                    }`}
                  >
                    <Skeleton className="mx-auto h-5 w-16" />
                    <Skeleton className="mx-auto mt-2 h-3 w-20" />
                    <Skeleton className="mx-auto mt-2 h-2.5 w-14" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="activity-summary-grid grid gap-px">
                {metrics.map((metric, index) => {
                  const isPrimary = index === 0
                  return (
                    <div
                      key={metric.label}
                      className={`activity-summary-metric min-w-0 bg-[var(--color-surface-container-lowest)] px-4 py-3 text-center opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.48)] [animation:activity-reveal_420ms_cubic-bezier(0.16,1,0.3,1)_forwards] ${
                        isPrimary ? 'activity-summary-metric-primary' : ''
                      }`}
                      style={{ animationDelay: `${index * 45}ms` }}
                    >
                      <div className="flex min-h-[68px] flex-col items-center justify-center gap-1.5">
                        <div className={`activity-summary-value max-w-full min-w-0 truncate font-semibold leading-none tracking-tight text-[var(--color-text-primary)] tabular-nums ${
                          isPrimary ? 'text-[23px]' : 'text-[22px]'
                        }`}>
                          {metric.value}
                        </div>
                        <div className="min-w-0 truncate text-[13px] font-medium leading-tight text-[var(--color-text-secondary)]">
                          {metric.label}
                        </div>
                        {metric.detail && (
                          <div className="max-w-full truncate text-[11px] leading-tight text-[var(--color-text-tertiary)]">
                            {metric.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-10">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            {t('settings.activity.tokenActivity')}
          </h2>
          <ToggleGroup
            type="single"
            value={heatmapMode}
            onValueChange={(value) => {
              if (value) setHeatmapMode(value as HeatmapMode)
            }}
            aria-label={t('settings.activity.tokenActivity')}
            className="grid w-full grid-cols-3 gap-1 sm:w-fit"
            disabled={isLoading || Boolean(error)}
          >
            {modeOptions.map((option) => (
              <ToggleGroupItem
                key={option.mode}
                value={option.mode}
                title={option.help}
                aria-label={option.label}
                className="min-w-0 px-2 text-sm"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {isLoading ? (
          <Card aria-busy="true">
            <CardContent className="min-h-[190px] overflow-hidden">
              <Skeleton className="h-4 w-1/4" />
              <div className="mt-4 flex gap-[3px]" aria-hidden="true">
                {Array.from({ length: 52 }).map((_, col) => (
                  <Skeleton key={col} className="h-[88px] w-2.5 shrink-0 rounded-[3px]" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-1 justify-self-start"
              onClick={() => void loadStats()}
            >
              {t('common.retry')}
            </Button>
          </Alert>
        ) : !hasUsage ? (
          <Card>
            <CardContent className="flex min-h-[190px] items-center justify-center">
              <div className="max-w-sm text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-tertiary)]">
                  <Activity aria-hidden="true" />
                </div>
                <div className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
                  {t('settings.activity.emptyTitle')}
                </div>
                <p className="mt-1 text-sm leading-5 text-[var(--color-text-tertiary)]">
                  {t('settings.activity.emptyBody')}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ActivityHeatmap
            days={days}
            monthLabels={monthLabels}
            ariaLabel={`${t('settings.activity.heatmapLabel')} · ${
              modeOptions.find((option) => option.mode === heatmapMode)?.label ?? ''
            }`}
            weekdayLabels={[
              t(WEEKDAY_LABEL_KEYS[0]),
              t(WEEKDAY_LABEL_KEYS[1]),
              t(WEEKDAY_LABEL_KEYS[2]),
            ]}
            lessLabel={t('settings.activity.less')}
            moreLabel={t('settings.activity.more')}
            getCellTitle={(day) => getHeatmapCellTitle(day, locale, t)}
            getCellDetail={(day) => getHeatmapCellDetail(day, t)}
          />
        )}
      </div>

      {!isLoading && !error && hasUsage && (
        <div className={`mt-12 grid gap-6 ${
          topPluginItems.length > 0 ? 'lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]' : 'lg:max-w-[520px]'
        }`}>
          <Card className="min-w-0 border-0 bg-transparent">
            <CardHeader className="p-0">
              <CardTitle className="text-lg">
                {t('settings.activity.activityInsights')}
              </CardTitle>
            </CardHeader>
            <CardContent className="mt-5 p-0">
              <dl className="grid gap-3">
                {insightMetrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 sm:gap-5"
                  >
                    <dt className="min-w-0 truncate text-sm font-medium text-[var(--color-text-tertiary)]">
                      {metric.label}
                    </dt>
                    <dd className="min-w-0 text-right text-sm font-semibold text-[var(--color-text-primary)]">
                      <span className="tabular-nums">{metric.value}</span>
                      {metric.detail && (
                        <span className="ml-2 text-xs font-medium text-[var(--color-text-tertiary)]">
                          {metric.detail}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {topPluginItems.length > 0 && (
            <Card className="min-w-0 border-0 bg-transparent">
              <CardHeader className="p-0">
                <CardTitle className="text-lg">
                  {t('settings.activity.mostUsedPluginsAndSkills')}
                </CardTitle>
              </CardHeader>
              <CardContent className="mt-5 p-0">
                <ol className="grid gap-3">
                  {topPluginItems.map((item) => (
                    <li
                      key={item.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-tertiary)]">
                        {item.kind === 'skill'
                          ? <Puzzle aria-hidden="true" className="size-4" />
                          : <Plug aria-hidden="true" className="size-4" />}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium text-[var(--color-text-primary)]">
                        {item.label}
                      </span>
                      <Badge variant="outline" className="tabular-nums">
                        {formatRunCount(item.count, t)}
                      </Badge>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
