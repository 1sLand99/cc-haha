import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../i18n'
import { useMarketStore } from '../stores/marketStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSkillStore } from '../stores/skillStore'
import { useUIStore } from '../stores/uiStore'
import { InstallConfirmDialog } from '../components/market/InstallConfirmDialog'
import { MarketHome } from '../components/market/MarketHome'
import { MarketSkillDetail } from '../components/market/MarketSkillDetail'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { SkillDetail } from '../components/skills/SkillDetail'
import type { NormalizedSkill } from '../types/market'

function focusSkillControl(id: string, preferred: 'action' | 'open' = 'action') {
  requestAnimationFrame(() => {
    const action = Array.from(
      document.querySelectorAll<HTMLElement>('[data-market-skill-action-id]'),
    ).find((element) => element.dataset.marketSkillActionId === id)
    const openButton = Array.from(
      document.querySelectorAll<HTMLElement>('[data-market-skill-open-id]'),
    ).find((element) => element.dataset.marketSkillOpenId === id)
    const target =
      (preferred === 'open' ? openButton ?? action : action ?? openButton) ??
      document.querySelector<HTMLElement>('[data-testid="market-search-input"]')
    target?.focus()
  })
}

export function Market() {
  const t = useTranslation()
  const selectedId = useMarketStore((s) => s.selectedId)
  const installingIds = useMarketStore((s) => s.installingIds)
  // InstalledSkillsOverview 点击已装技能只写 skillStore.selectedSkill,
  // 这里把它接成真正的详情视图,否则点击没有任何界面反馈
  const selectedInstalledSkill = useSkillStore((s) => s.selectedSkill)
  const selectedInstalledContext = useSkillStore((s) => s.selectedSkillContext)
  const isInstalledDetailLoading = useSkillStore((s) => s.isDetailLoading)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const currentSkillContext = sessions.find((session) => session.id === activeSessionId)?.workDir ?? ''
  const showInstalledDetail = Boolean(selectedInstalledSkill) || isInstalledDetailLoading
  const [confirmInstall, setConfirmInstall] = useState<NormalizedSkill | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<NormalizedSkill | null>(null)
  const lastOpenedIdRef = useRef<string | null>(null)
  const previousSelectedIdRef = useRef<string | null>(selectedId)

  useEffect(() => {
    if (previousSelectedIdRef.current && !selectedId && lastOpenedIdRef.current) {
      focusSkillControl(lastOpenedIdRef.current, 'open')
    }
    previousSelectedIdRef.current = selectedId
  }, [selectedId])

  // 与 Settings → Skills 一致:活跃项目切换后,丢弃上一个项目上下文的详情
  useEffect(() => {
    if (
      (selectedInstalledSkill || isInstalledDetailLoading)
      && selectedInstalledContext !== null
      && selectedInstalledContext !== currentSkillContext
    ) {
      useSkillStore.getState().clearSelection()
    }
  }, [currentSkillContext, isInstalledDetailLoading, selectedInstalledContext, selectedInstalledSkill])

  const findSkill = (id: string): NormalizedSkill | null => {
    const state = useMarketStore.getState()
    if (state.detail?.id === id) return state.detail
    return state.items.find((item) => item.id === id) ?? state.detailCache.get(id) ?? null
  }

  const requestInstall = (id: string) => {
    const skill = findSkill(id)
    if (skill) setConfirmInstall(skill)
  }

  const requestUninstall = (id: string) => {
    const skill = findSkill(id)
    if (skill) setConfirmUninstall(skill)
  }

  const runInstall = async () => {
    const skill = confirmInstall
    if (!skill) return
    const ok = await useMarketStore.getState().install(skill.id)
    setConfirmInstall(null)
    focusSkillControl(skill.id)
    if (ok) {
      useUIStore.getState().addToast({
        type: 'success',
        message: t('market.installSuccess', { name: skill.name }),
      })
      // Keep the Settings → Skills browser in sync.
      void useSkillStore.getState().fetchSkills()
    } else {
      const error = useMarketStore.getState().installError
      if (error) {
        useUIStore.getState().addToast({
          type: 'error',
          message:
            error.kind === 'generic'
              ? t('market.installError.generic', { message: error.message })
              : t(`market.installError.${error.kind}`),
        })
      }
    }
  }

  const runUninstall = async () => {
    const skill = confirmUninstall
    if (!skill) return
    const ok = await useMarketStore.getState().uninstall(skill.id)
    setConfirmUninstall(null)
    focusSkillControl(skill.id)
    if (ok) {
      useUIStore.getState().addToast({
        type: 'success',
        message: t('market.uninstall.success', { name: skill.name }),
      })
      void useSkillStore.getState().fetchSkills()
    } else {
      const error = useMarketStore.getState().installError
      if (error) {
        useUIStore.getState().addToast({ type: 'error', message: error.message })
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface-container-lowest,var(--color-surface))]">
      {selectedId ? (
        <MarketSkillDetail onRequestInstall={requestInstall} onRequestUninstall={requestUninstall} />
      ) : (
        <>
          {showInstalledDetail && <SkillDetail />}
          {/* hidden 而非卸载:保住 MarketHome/InstalledSkillsOverview 的搜索与折叠状态 */}
          <div hidden={showInstalledDetail} className="flex min-h-0 flex-1 flex-col">
            <MarketHome
              onRequestInstall={requestInstall}
              onOpenSkill={(id) => {
                lastOpenedIdRef.current = id
                void useMarketStore.getState().openDetail(id)
              }}
            />
          </div>
        </>
      )}

      <InstallConfirmDialog
        skill={confirmInstall}
        open={confirmInstall !== null}
        installing={confirmInstall !== null && installingIds.has(confirmInstall.id)}
        onConfirm={() => void runInstall()}
        onClose={() => {
          const id = confirmInstall?.id
          setConfirmInstall(null)
          if (id) focusSkillControl(id)
        }}
      />

      <ConfirmDialog
        open={confirmUninstall !== null}
        onClose={() => {
          const id = confirmUninstall?.id
          setConfirmUninstall(null)
          if (id) focusSkillControl(id)
        }}
        onConfirm={() => void runUninstall()}
        title={t('market.uninstall.confirmTitle')}
        body={
          confirmUninstall
            ? t('market.uninstall.confirmMessage', {
                name: confirmUninstall.name,
                path: `…/skills/${confirmUninstall.installedInfo?.dirName ?? confirmUninstall.slug.toLowerCase()}/`,
              })
            : ''
        }
        confirmLabel={t('market.uninstall.action')}
        cancelLabel={t('market.installConfirm.cancel')}
        confirmVariant="danger"
        loading={confirmUninstall !== null && installingIds.has(confirmUninstall.id)}
      />
    </div>
  )
}
