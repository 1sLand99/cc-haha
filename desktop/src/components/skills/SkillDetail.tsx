import { useCallback, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useSkillStore } from '../../stores/skillStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { marketApi } from '../../api/market'
import { useMarketStore } from '../../stores/marketStore'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { LoadingButton } from '../ui/custom/loading-button'
import { Skeleton } from '../ui/skeleton'
import { SkillDetailView, type SkillDetailMetaItem } from '../market/SkillDetailView'
import type { PreviewFileContent } from '../market/FilePreview'

const META_PRIORITY = [
  'when_to_use',
  'argument-hint',
  'model',
  'effort',
  'allowed-tools',
  'paths',
  'agent',
  'context',
  'user-invocable',
] as const

function formatMetaKey(key: string) {
  return key.replace(/[-_]/g, ' ')
}

function formatMetaValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

export function SkillDetail() {
  const {
    selectedSkill,
    selectedSkillReturnTab,
    selectedSkillContext,
    isDetailLoading,
    clearSelection,
    fetchSkills,
  } = useSkillStore()
  const t = useTranslation()
  const uninstallTriggerRef = useRef<HTMLButtonElement>(null)
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [uninstallError, setUninstallError] = useState<string | null>(null)

  const handleBack = useCallback(() => {
    const returnTab = selectedSkillReturnTab
    clearSelection()
    if (returnTab === 'plugins') {
      useUIStore.getState().setPendingSettingsTab('plugins')
    }
  }, [selectedSkillReturnTab, clearSelection])

  const files = selectedSkill?.files ?? []

  const loadFile = useCallback(
    (path: string): Promise<PreviewFileContent> => {
      const file = files.find((candidate) => candidate.path === path)
      if (!file) return Promise.reject(new Error(`File not found: ${path}`))
      const content = file.language === 'markdown' ? (file.body ?? file.content) : file.content
      return Promise.resolve({
        path: file.path,
        content,
        language: file.language,
        size: file.content.length,
        truncated: false,
      })
    },
    [files],
  )

  const meta = useMemo<SkillDetailMetaItem[]>(() => {
    if (!selectedSkill) return []
    const skillMeta = selectedSkill.meta
    const items: SkillDetailMetaItem[] = [
      { label: t('settings.skills.summary.source'), value: t(`settings.skills.source.${skillMeta.source}`) },
      { label: t('settings.skills.summary.totalFiles'), value: String(selectedSkill.files.length) },
      {
        label: t('settings.skills.summary.tokens'),
        value: t('settings.skills.tokenEstimateShort', {
          count: String(Math.ceil(skillMeta.contentLength / 4)),
        }),
      },
    ]
    if (selectedSkill.marketMeta?.installedAt) {
      items.push({
        label: t('market.install.state.installed'),
        value: new Date(selectedSkill.marketMeta.installedAt).toLocaleDateString(),
      })
    }
    const entry = selectedSkill.files.find((file) => file.isEntry)
    const frontmatter = entry?.frontmatter
    if (frontmatter) {
      const entries = Object.entries(frontmatter)
        .filter(([key, value]) => {
          if (key === 'name' || key === 'description' || key === 'version') return false
          if (value == null) return false
          if (typeof value === 'string') return value.trim().length > 0
          if (Array.isArray(value)) return value.length > 0
          return true
        })
        .sort((a, b) => {
          const aIndex = META_PRIORITY.indexOf(a[0] as (typeof META_PRIORITY)[number])
          const bIndex = META_PRIORITY.indexOf(b[0] as (typeof META_PRIORITY)[number])
          const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex
          const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex
          return normalizedA - normalizedB || a[0].localeCompare(b[0])
        })
      for (const [key, value] of entries) {
        items.push({ label: formatMetaKey(key), value: formatMetaValue(value) })
      }
    }
    return items
  }, [selectedSkill, t])

  if (isDetailLoading) {
    return (
      <Card data-testid="skill-detail-skeleton" aria-busy="true">
        <CardContent className="grid gap-4 p-6">
          <Skeleton className="h-7 w-28" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-xl" />
            <div className="grid flex-1 gap-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full max-w-2xl" />
            </div>
          </div>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!selectedSkill) return null

  const skillMeta = selectedSkill.meta
  const marketMeta = skillMeta.source === 'user' ? selectedSkill.marketMeta : undefined
  const entryFile = selectedSkill.files.find((file) => file.isEntry)
  const description = entryFile ? (entryFile.body ?? entryFile.content) : ''

  const runUninstall = async () => {
    if (!marketMeta || uninstalling) return
    const refreshCwd = selectedSkillContext || undefined
    setUninstalling(true)
    setUninstallError(null)
    try {
      await marketApi.uninstall(marketMeta.id)

      const market = useMarketStore.getState()
      const detailCache = new Map(market.detailCache)
      detailCache.delete(marketMeta.id)
      useMarketStore.setState({
        detailCache,
        items: market.items.map((item) =>
          item.id === marketMeta.id
            ? {
                ...item,
                installState: 'installable',
                installedInfo: undefined,
                notInstallableReason: undefined,
              }
            : item,
        ),
      })

      await fetchSkills(refreshCwd)
      useUIStore.getState().addToast({
        type: 'success',
        message: t('market.uninstall.success', {
          name: skillMeta.displayName || skillMeta.name,
        }),
      })
      setConfirmUninstall(false)
      clearSelection()
    } catch (error) {
      setUninstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setUninstalling(false)
    }
  }

  const actions = marketMeta ? (
    <Button
      ref={uninstallTriggerRef}
      variant="outline"
      data-testid="local-skill-uninstall-button"
      className="text-[var(--color-error)] hover:border-[var(--color-error)]/50"
      onClick={() => {
        setUninstallError(null)
        setConfirmUninstall(true)
      }}
    >
      <Trash2 aria-hidden="true" />
      {t('market.uninstall.action')}
    </Button>
  ) : undefined

  return (
    <>
      <SkillDetailView
        name={skillMeta.displayName || skillMeta.name}
        version={skillMeta.version}
        sourceLabel={t(`settings.skills.source.${skillMeta.source}`)}
        summary={skillMeta.description}
        installState={marketMeta ? 'installed' : undefined}
        actions={actions}
        meta={meta}
        description={description}
        files={selectedSkill.files.map((file) => ({
          path: file.path,
          size: file.content.length,
          language: file.language,
        }))}
        loadFile={loadFile}
        onBack={handleBack}
        backLabel={t('settings.skills.back')}
      />

      <AlertDialog
        open={confirmUninstall}
        onOpenChange={(open) => {
          if (!uninstalling) setConfirmUninstall(open)
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(event) => {
            if (uninstalling) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            uninstallTriggerRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('market.uninstall.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('market.uninstall.confirmMessage', {
                name: skillMeta.displayName || skillMeta.name,
                path: selectedSkill.skillRoot,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {uninstallError && (
            <Alert variant="destructive" data-testid="local-skill-uninstall-error">
              <AlertTitle>{t('market.uninstall.confirmTitle')}</AlertTitle>
              <AlertDescription className="break-words">{uninstallError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={uninstalling}>
              {t('market.installConfirm.cancel')}
            </AlertDialogCancel>
            <LoadingButton
              variant="destructive"
              loading={uninstalling}
              onClick={() => void runUninstall()}
            >
              {uninstalling
                ? t('market.uninstall.uninstalling')
                : t('market.uninstall.action')}
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
