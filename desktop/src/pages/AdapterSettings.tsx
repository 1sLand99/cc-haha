import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Link2,
} from 'lucide-react'
import { useAdapterStore } from '../stores/adapterStore'
import { useTranslation } from '../i18n'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Label } from '../components/ui/label'
import { Skeleton } from '../components/ui/skeleton'
import { Switch } from '../components/ui/switch'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs'
import { LoadingButton } from '../components/ui/custom/loading-button'
import { SettingField } from '../components/ui/custom/setting-field'
import QRCode from 'qrcode'
import type { AdapterFileConfig } from '../types/adapter'

type ImTab = 'telegram' | 'feishu' | 'wechat' | 'dingtalk' | 'whatsapp'
type ImPlatform = 'telegram' | 'feishu' | 'wechat' | 'dingtalk' | 'whatsapp'
type AdapterUnbindTarget = 'wechatAccount' | 'dingtalkBot' | 'whatsappAccount'

const FEISHU_CREATE_BOT_URL = 'https://open.feishu.cn/page/openclaw?form=multiAgent'
const IM_CONFIG_DOCS_URL = 'https://claudecode-haha.relakkesyang.org/im/'

export function AdapterSettings() {
  const t = useTranslation()
  const {
    config,
    isLoading,
    hasLoaded,
    error: loadError,
    restartWarning,
    fetchConfig,
    updateConfig,
    generatePairingCode,
    startWechatLogin,
    pollWechatLogin,
    startWhatsAppLogin,
    pollWhatsAppLogin,
    removePairedUser,
    beginDingtalkRegistration,
    pollDingtalkRegistration,
    unbindWechatAccount,
    unbindDingtalkBot,
    unbindWhatsAppAccount,
  } = useAdapterStore()

  // Active IM tab
  const [activeIm, setActiveIm] = useState<ImTab>('telegram')

  // Server —— serverUrl 不再暴露在 UI 里（见下方 Server URL 注释），
  // 桌面端用 sidecar env var 注入动态端口。
  const [defaultProjectDir, setDefaultProjectDir] = useState('')

  // Telegram
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgAllowedUsers, setTgAllowedUsers] = useState('')

  // Feishu
  const [fsAppId, setFsAppId] = useState('')
  const [fsAppSecret, setFsAppSecret] = useState('')
  const [fsEncryptKey, setFsEncryptKey] = useState('')
  const [fsVerificationToken, setFsVerificationToken] = useState('')
  const [fsAllowedUsers, setFsAllowedUsers] = useState('')
  const [fsStreamingCard, setFsStreamingCard] = useState(false)

  // WeChat
  const [wcAllowedUsers, setWcAllowedUsers] = useState('')
  const [wechatQrUrl, setWechatQrUrl] = useState<string | null>(null)
  const [wechatSessionKey, setWechatSessionKey] = useState<string | null>(null)
  const [wechatStatus, setWechatStatus] = useState('')
  const [isWechatBinding, setIsWechatBinding] = useState(false)
  const [isUnbindingWechatAccount, setIsUnbindingWechatAccount] = useState(false)

  // WhatsApp
  const [waAllowedUsers, setWaAllowedUsers] = useState('')
  const [whatsappQrUrl, setWhatsappQrUrl] = useState<string | null>(null)
  const [whatsappSessionKey, setWhatsappSessionKey] = useState<string | null>(null)
  const [whatsappStatus, setWhatsappStatus] = useState('')
  const [isWhatsAppBinding, setIsWhatsAppBinding] = useState(false)
  const [isUnbindingWhatsAppAccount, setIsUnbindingWhatsAppAccount] = useState(false)

  // DingTalk
  const [dtClientId, setDtClientId] = useState('')
  const [dtClientSecret, setDtClientSecret] = useState('')
  const [dtAllowedUsers, setDtAllowedUsers] = useState('')
  const [dtEndpoint, setDtEndpoint] = useState('')
  const [dtPermissionCardTemplateId, setDtPermissionCardTemplateId] = useState('')
  const [dtRegistration, setDtRegistration] = useState<{
    deviceCode: string
    verificationUriComplete: string
    qrDataUrl?: string
    intervalSeconds: number
    expiresAt: number
  } | null>(null)
  const [dtAuthStatus, setDtAuthStatus] = useState<'idle' | 'waiting' | 'bound' | 'error'>('idle')
  const [dtAuthError, setDtAuthError] = useState('')
  const [isStartingDtAuth, setIsStartingDtAuth] = useState(false)
  const [isUnbindingDtBot, setIsUnbindingDtBot] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [tgAllowedUsersError, setTgAllowedUsersError] = useState('')
  const [pairingError, setPairingError] = useState('')
  const [unbindError, setUnbindError] = useState('')
  const [adapterUnbindError, setAdapterUnbindError] = useState('')
  const formDirtyRef = useRef(false)
  const pairedUnbindTriggerRef = useRef<HTMLElement | null>(null)
  const adapterUnbindTriggerRef = useRef<HTMLElement | null>(null)

  // Pairing
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [pairingNow, setPairingNow] = useState(() => Date.now())
  const [isGenerating, setIsGenerating] = useState(false)
  const [pendingUnbind, setPendingUnbind] = useState<{ platform: ImPlatform; userId: string | number } | null>(null)
  const [pendingAdapterUnbind, setPendingAdapterUnbind] = useState<AdapterUnbindTarget | null>(null)
  const [isUnbinding, setIsUnbinding] = useState(false)

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const applyConfigToForm = useCallback((nextConfig: AdapterFileConfig) => {
    setDefaultProjectDir(nextConfig.defaultProjectDir ?? '')
    setTgBotToken(nextConfig.telegram?.botToken ?? '')
    setTgAllowedUsers(nextConfig.telegram?.allowedUsers?.join(', ') ?? '')
    setFsAppId(nextConfig.feishu?.appId ?? '')
    setFsAppSecret(nextConfig.feishu?.appSecret ?? '')
    setFsEncryptKey(nextConfig.feishu?.encryptKey ?? '')
    setFsVerificationToken(nextConfig.feishu?.verificationToken ?? '')
    setFsAllowedUsers(nextConfig.feishu?.allowedUsers?.join(', ') ?? '')
    setFsStreamingCard(nextConfig.feishu?.streamingCard ?? false)
    setWcAllowedUsers(nextConfig.wechat?.allowedUsers?.join(', ') ?? '')
    setWaAllowedUsers(nextConfig.whatsapp?.allowedUsers?.join(', ') ?? '')
    setDtClientId(nextConfig.dingtalk?.clientId ?? '')
    setDtClientSecret(nextConfig.dingtalk?.clientSecret ?? '')
    setDtAllowedUsers(nextConfig.dingtalk?.allowedUsers?.join(', ') ?? '')
    setDtEndpoint(nextConfig.dingtalk?.endpoint ?? '')
    setDtPermissionCardTemplateId(nextConfig.dingtalk?.permissionCardTemplateId ?? '')
  }, [])

  // Background pairing/binding refreshes must not erase unsaved form input.
  useEffect(() => {
    if (!formDirtyRef.current) applyConfigToForm(config)
  }, [applyConfigToForm, config])

  const markFormDirty = useCallback(() => {
    formDirtyRef.current = true
    setSaveStatus('idle')
    setSaveError('')
  }, [])

  useEffect(() => {
    if (!wechatSessionKey) return

    let cancelled = false
    let timer: number | null = null
    let consecutiveFailures = 0

    const poll = async () => {
      try {
        const result = await pollWechatLogin(wechatSessionKey)
        if (cancelled) return
        consecutiveFailures = 0
        if (result.connected) {
          setWechatStatus(t('settings.adapters.wechatBindSuccess'))
          setWechatQrUrl(null)
          setWechatSessionKey(null)
          setIsWechatBinding(false)
          return
        }
        if (result.message) {
          setWechatStatus(result.message)
        }
        if (result.status === 'expired' || result.status === 'not_started') {
          setWechatQrUrl(null)
          setWechatSessionKey(null)
          setIsWechatBinding(false)
          return
        }
      } catch (err) {
        if (cancelled) return
        consecutiveFailures += 1
        setWechatStatus(err instanceof Error ? err.message : 'WeChat bind failed')
        if (consecutiveFailures >= 3) {
          setWechatSessionKey(null)
          setIsWechatBinding(false)
          return
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), 1200)
      }
    }

    timer = window.setTimeout(() => void poll(), 1200)

    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [wechatSessionKey, pollWechatLogin, t])

  useEffect(() => {
    if (!whatsappSessionKey) return

    let cancelled = false
    let timer: number | null = null
    let consecutiveFailures = 0

    const poll = async () => {
      try {
        const result = await pollWhatsAppLogin(whatsappSessionKey)
        if (cancelled) return
        consecutiveFailures = 0
        if (result.connected) {
          setWhatsappStatus(t('settings.adapters.whatsappBindSuccess'))
          setWhatsappQrUrl(null)
          setWhatsappSessionKey(null)
          setIsWhatsAppBinding(false)
          return
        }
        if (result.qrDataUrl) {
          setWhatsappQrUrl(result.qrDataUrl)
        }
        if (result.message) {
          setWhatsappStatus(result.message)
        }
        if (result.status === 'expired' || result.status === 'error') {
          setWhatsappSessionKey(null)
          setIsWhatsAppBinding(false)
          return
        }
      } catch (err) {
        if (cancelled) return
        consecutiveFailures += 1
        setWhatsappStatus(err instanceof Error ? err.message : t('settings.adapters.whatsappBindFailed'))
        if (consecutiveFailures >= 3) {
          setWhatsappSessionKey(null)
          setIsWhatsAppBinding(false)
          return
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), 1200)
      }
    }

    timer = window.setTimeout(() => void poll(), 1200)

    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [whatsappSessionKey, pollWhatsAppLogin, t])

  useEffect(() => {
    if (!dtRegistration || dtAuthStatus !== 'waiting') return

    let cancelled = false
    let timer: number | null = null
    const poll = async () => {
      if (Date.now() > dtRegistration.expiresAt) {
        setDtAuthStatus('error')
        setDtAuthError(t('settings.adapters.dingtalkAuthExpired'))
        setDtRegistration(null)
        return
      }

      try {
        const result = await pollDingtalkRegistration(dtRegistration.deviceCode)
        if (cancelled) return
        if (result.status === 'SUCCESS') {
          setDtAuthStatus('bound')
          setDtRegistration(null)
          setDtAuthError('')
          await fetchConfig()
          return
        } else if (result.status === 'FAIL' || result.status === 'EXPIRED') {
          setDtAuthStatus('error')
          setDtAuthError(result.failReason || t('settings.adapters.dingtalkAuthFailed'))
          setDtRegistration(null)
          return
        }
      } catch (err) {
        if (!cancelled) {
          setDtAuthStatus('error')
          setDtAuthError(err instanceof Error ? err.message : t('settings.adapters.dingtalkAuthFailed'))
        }
        return
      }

      if (!cancelled) {
        timer = window.setTimeout(
          () => void poll(),
          Math.max(1, dtRegistration.intervalSeconds) * 1000,
        )
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [dtRegistration, dtAuthStatus, pollDingtalkRegistration, fetchConfig, t])

  useEffect(() => {
    const expiry = config.pairing?.expiresAt
    if (!expiry || expiry <= Date.now()) return
    setPairingNow(Date.now())
    const timer = window.setInterval(() => setPairingNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [config.pairing?.expiresAt])

  async function handleSave() {
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const patch: Record<string, unknown> = {
        defaultProjectDir,
      }

      const tgUserValues = tgAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const tgUsers = tgUserValues.map(Number)
      if (tgUserValues.some((value, index) => !/^\d+$/.test(value) || !Number.isSafeInteger(tgUsers[index]))) {
        const message = t('settings.adapters.telegramUsersInvalid')
        setTgAllowedUsersError(message)
        setSaveStatus('error')
        setSaveError(message)
        return
      }
      setTgAllowedUsersError('')

      patch.telegram = {
        botToken: tgBotToken,
        allowedUsers: tgUsers.length ? tgUsers : [],
      }

      const fsUsers = fsAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      patch.feishu = {
        appId: fsAppId,
        appSecret: fsAppSecret,
        encryptKey: fsEncryptKey,
        verificationToken: fsVerificationToken,
        allowedUsers: fsUsers.length ? fsUsers : [],
        streamingCard: fsStreamingCard,
      }

      const wcUsers = wcAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      patch.wechat = {
        allowedUsers: wcUsers.length ? wcUsers : [],
      }

      const waUsers = waAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      patch.whatsapp = {
        allowedUsers: waUsers.length ? waUsers : [],
      }

      const dtUsers = dtAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      patch.dingtalk = {
        clientId: dtClientId,
        clientSecret: dtClientSecret,
        allowedUsers: dtUsers.length ? dtUsers : [],
        endpoint: dtEndpoint,
        permissionCardTemplateId: dtPermissionCardTemplateId,
      }

      await updateConfig(patch)
      formDirtyRef.current = false
      applyConfigToForm(useAdapterStore.getState().config)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateCode = useCallback(async () => {
    setIsGenerating(true)
    setPairingError('')
    try {
      const code = await generatePairingCode()
      setPairingCode(code)
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : t('settings.adapters.generateCodeFailed'))
    } finally {
      setIsGenerating(false)
    }
  }, [generatePairingCode, t])

  const handleWechatBind = useCallback(async () => {
    setIsWechatBinding(true)
    setWechatStatus('')
    try {
      const result = await startWechatLogin()
      if (!result.qrcodeUrl) {
        throw new Error(result.message || 'WeChat QR URL missing')
      }
      const qrDataUrl = await QRCode.toDataURL(result.qrcodeUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 8,
      })
      setWechatQrUrl(qrDataUrl)
      setWechatSessionKey(result.sessionKey)
      setWechatStatus(result.message)
    } catch (err) {
      setWechatStatus(err instanceof Error ? err.message : 'WeChat bind failed')
      setIsWechatBinding(false)
    }
  }, [startWechatLogin])

  const handleWhatsAppBind = useCallback(async () => {
    setIsWhatsAppBinding(true)
    setWhatsappStatus('')
    try {
      const result = await startWhatsAppLogin()
      if (result.qrDataUrl) {
        setWhatsappQrUrl(result.qrDataUrl)
      }
      setWhatsappSessionKey(result.sessionKey)
      setWhatsappStatus(result.message)
    } catch (err) {
      setWhatsappStatus(err instanceof Error ? err.message : t('settings.adapters.whatsappBindFailed'))
      setIsWhatsAppBinding(false)
    }
  }, [startWhatsAppLogin, t])

  const handleStartDingtalkAuth = useCallback(async () => {
    setIsStartingDtAuth(true)
    setDtAuthStatus('idle')
    setDtAuthError('')
    try {
      const begin = await beginDingtalkRegistration()
      setDtRegistration({
        deviceCode: begin.deviceCode,
        verificationUriComplete: begin.verificationUriComplete,
        qrDataUrl: begin.qrDataUrl,
        intervalSeconds: begin.intervalSeconds,
        expiresAt: Date.now() + begin.expiresInSeconds * 1000,
      })
      setDtAuthStatus('waiting')
    } catch (err) {
      setDtAuthStatus('error')
      setDtAuthError(err instanceof Error ? err.message : t('settings.adapters.dingtalkAuthFailed'))
    } finally {
      setIsStartingDtAuth(false)
    }
  }, [beginDingtalkRegistration, t])

  const handleUnbindWechatAccount = useCallback(async () => {
    setIsUnbindingWechatAccount(true)
    setWechatStatus('')
    try {
      await unbindWechatAccount()
      await fetchConfig()
      setWechatQrUrl(null)
      setWechatSessionKey(null)
      setWechatStatus(t('settings.adapters.wechatUnbound'))
      setPendingAdapterUnbind(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settings.adapters.wechatUnbindFailed')
      setWechatStatus(message)
      setAdapterUnbindError(message)
    } finally {
      setIsUnbindingWechatAccount(false)
      setIsWechatBinding(false)
    }
  }, [unbindWechatAccount, fetchConfig, t])

  const handleUnbindDingtalkBot = useCallback(async () => {
    setIsUnbindingDtBot(true)
    setDtAuthError('')
    try {
      await unbindDingtalkBot()
      setDtAuthStatus('idle')
      setDtRegistration(null)
      await fetchConfig()
      setPendingAdapterUnbind(null)
    } catch (err) {
      setDtAuthStatus('error')
      const message = err instanceof Error ? err.message : t('settings.adapters.dingtalkUnbindFailed')
      setDtAuthError(message)
      setAdapterUnbindError(message)
    } finally {
      setIsUnbindingDtBot(false)
    }
  }, [unbindDingtalkBot, fetchConfig, t])

  const handleUnbindWhatsAppAccount = useCallback(async () => {
    setIsUnbindingWhatsAppAccount(true)
    setWhatsappStatus('')
    try {
      await unbindWhatsAppAccount()
      await fetchConfig()
      setWhatsappQrUrl(null)
      setWhatsappSessionKey(null)
      setWhatsappStatus(t('settings.adapters.whatsappUnbound'))
      setPendingAdapterUnbind(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settings.adapters.whatsappUnbindFailed')
      setWhatsappStatus(message)
      setAdapterUnbindError(message)
    } finally {
      setIsUnbindingWhatsAppAccount(false)
      setIsWhatsAppBinding(false)
    }
  }, [unbindWhatsAppAccount, fetchConfig, t])

  const handleUnbind = useCallback(async (
    platform: ImPlatform,
    userId: string | number,
    trigger: HTMLElement,
  ) => {
    setUnbindError('')
    pairedUnbindTriggerRef.current = trigger
    setPendingUnbind({ platform, userId })
  }, [])

  const confirmUnbind = useCallback(async () => {
    if (!pendingUnbind) return
    setIsUnbinding(true)
    try {
      await removePairedUser(pendingUnbind.platform, pendingUnbind.userId)
      await fetchConfig()
      setPendingUnbind(null)
      setUnbindError('')
    } catch (err) {
      setUnbindError(err instanceof Error ? err.message : t('settings.adapters.unbindFailed'))
    } finally {
      setIsUnbinding(false)
    }
  }, [pendingUnbind, removePairedUser, fetchConfig, t])

  // Collect all paired users across platforms
  const allPairedUsers = [
    ...(config.telegram?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'telegram' as const })),
    ...(config.feishu?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'feishu' as const })),
    ...(config.wechat?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'wechat' as const })),
    ...(config.dingtalk?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'dingtalk' as const })),
    ...(config.whatsapp?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'whatsapp' as const })),
  ]

  // Check pairing expiry
  const pairingExpiry = config.pairing?.expiresAt
  const isPairingActive = pairingExpiry ? pairingNow < pairingExpiry : false
  const minutesLeft = pairingExpiry ? Math.max(0, Math.ceil((pairingExpiry - pairingNow) / 60000)) : 0
  const hasSavedFeishuCredentials = Boolean(config.feishu?.appId && config.feishu?.appSecret)

  if (isLoading || (!hasLoaded && !loadError)) {
    return (
      <div className="max-w-2xl space-y-4" aria-label={t('common.loading')}>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (loadError || !hasLoaded) {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{t('settings.adapters.configLoadFailed')}</AlertTitle>
        <AlertDescription>{loadError || t('settings.adapters.configLoadFailed')}</AlertDescription>
        <Button className="mt-2 w-fit" variant="secondary" onClick={() => void fetchConfig()}>
          {t('common.retry')}
        </Button>
      </Alert>
    )
  }

  const isMutating = isSaving
    || isGenerating
    || isUnbinding
    || isWechatBinding
    || isWhatsAppBinding
    || isStartingDtAuth
    || isUnbindingWechatAccount
    || isUnbindingDtBot
    || isUnbindingWhatsAppAccount

  const adapterUnbindTitle = pendingAdapterUnbind === 'wechatAccount'
    ? t('settings.adapters.wechatUnbindAccount')
    : pendingAdapterUnbind === 'whatsappAccount'
      ? t('settings.adapters.whatsappUnbindAccount')
      : t('settings.adapters.dingtalkUnbindBot')
  const adapterUnbindDescription = pendingAdapterUnbind === 'wechatAccount'
    ? t('settings.adapters.wechatUnbindAccountConfirm')
    : pendingAdapterUnbind === 'whatsappAccount'
      ? t('settings.adapters.whatsappUnbindAccountConfirm')
      : t('settings.adapters.dingtalkUnbindBotConfirm')

  return (
    <div className="max-w-2xl space-y-8">
      {/* Description */}
      <div>
        <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
          {t('settings.adapters.description')}{' '}
          <Button asChild variant="link" className="mx-1 h-auto align-baseline text-sm">
            <a href={IM_CONFIG_DOCS_URL} target="_blank" rel="noopener noreferrer">
              {t('settings.adapters.configurationDocs')}
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
          {t('settings.adapters.descriptionAfterDocs')}
        </p>
      </div>

      {/* Pairing */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-hover)] py-3">
          <Link2 className="size-4 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <CardTitle className="text-sm">{t('settings.adapters.pairing')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">{t('settings.adapters.pairingDesc')}</p>

          {/* Generate code */}
          <div className="flex items-center gap-3">
            <LoadingButton onClick={handleGenerateCode} loading={isGenerating} disabled={isMutating && !isGenerating}>
              {pairingCode || isPairingActive ? t('settings.adapters.regenerateCode') : t('settings.adapters.generateCode')}
            </LoadingButton>
            {pairingCode && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-2xl font-bold tracking-[0.3em] text-[var(--color-brand)]">
                  {pairingCode}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.codeExpiresIn')} 60 {t('settings.adapters.minutes')}
                </span>
              </div>
            )}
            {!pairingCode && isPairingActive && (
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {t('settings.adapters.codeExpiresIn')} {minutesLeft} {t('settings.adapters.minutes')}
              </span>
            )}
          </div>
          {pairingCode && (
            <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.pairingCodeHint')}</p>
          )}
          {pairingError && (
            <Alert variant="destructive">
              <AlertTitle>{t('settings.adapters.generateCodeFailed')}</AlertTitle>
              <AlertDescription>{pairingError}</AlertDescription>
            </Alert>
          )}

          {/* Paired users list */}
          <div>
            <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">{t('settings.adapters.pairedUsers')}</h4>
            {allPairedUsers.length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)]">{t('settings.adapters.noPairedUsers')}</p>
            ) : (
              <div className="space-y-2">
                {allPairedUsers.map((user) => (
                  <div
                    key={`${user.platform}-${user.userId}`}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--color-surface-hover)]"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {t(`settings.adapters.platform.${user.platform}`)}
                      </Badge>
                      <span className="text-sm text-[var(--color-text-primary)]">{user.displayName}</span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {new Date(user.pairedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isMutating}
                      onClick={(event) => handleUnbind(user.platform, user.userId, event.currentTarget)}
                      className="text-[var(--color-error)]"
                    >
                      {t('settings.adapters.unbind')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Server URL —— 之前是个手填字段，但桌面端启动 adapter sidecar
          时已经把 server 的动态端口通过 ADAPTER_SERVER_URL env var 注进去了，
          loadConfig() 里 env 优先级高于这里的 file value，所以这个字段在桌面
          运行时完全不会被读到。用户也根本不知道该填什么端口（每次启动随机）。
          Standalone 模式（直接 bun run adapters/...）保留 file 字段兜底就够了。 */}

      {/* Default Project */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('settings.adapters.defaultProject')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Label className="sr-only">{t('settings.adapters.defaultProject')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <DirectoryPicker
              value={defaultProjectDir}
              onChange={(value) => {
                markFormDirty()
                setDefaultProjectDir(value)
              }}
            />
            {defaultProjectDir && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isMutating}
                onClick={() => {
                  markFormDirty()
                  setDefaultProjectDir('')
                }}
              >
                {t('settings.adapters.clearDefaultProject')}
              </Button>
            )}
          </div>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {t('settings.adapters.defaultProjectHint')}
        </p>
        </CardContent>
      </Card>

      {/* IM Adapter Tabs */}
      <Card className="overflow-hidden">
        <Tabs
          value={activeIm}
          onValueChange={(value) => setActiveIm(value as ImTab)}
          className="block"
          orientation="horizontal"
        >
          <TabsList
            aria-label="IM adapter"
            className="flex w-full justify-start overflow-x-auto rounded-none border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]"
          >
            {(['telegram', 'feishu', 'wechat', 'dingtalk', 'whatsapp'] as const).map((platform) => (
              <TabsTrigger
                key={platform}
                value={platform}
                className="relative rounded-none px-4 py-2.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-transparent data-[state=active]:after:bg-[var(--color-brand)]"
              >
                {t(`settings.adapters.${platform}`)}
              </TabsTrigger>
            ))}
          </TabsList>

        <TabsContent value="feishu" className="m-0 space-y-4 p-4">
            {!hasSavedFeishuCredentials && (
              <Card className="bg-[var(--color-surface)]">
                <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <Bot className="mt-0.5 size-5 text-[var(--color-brand)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.adapters.feishuCreateBotTitle')}</h4>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{t('settings.adapters.feishuCreateBotDesc')}</p>
                      <ol className="mt-2 space-y-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                        <li>1. {t('settings.adapters.feishuCreateBotStepCreate')}</li>
                        <li>2. {t('settings.adapters.feishuCreateBotStepFill')}</li>
                      </ol>
                    </div>
                  </div>
                  <Button asChild size="sm">
                    <a href={FEISHU_CREATE_BOT_URL} target="_blank" rel="noopener noreferrer">
                      {t('settings.adapters.feishuCreateBotAction')}
                      <ExternalLink aria-hidden="true" />
                    </a>
                  </Button>
                </div>
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-2 gap-4">
              <SettingField
                id="adapter-feishu-app-id"
                label={t('settings.adapters.appId')}
                value={fsAppId}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setFsAppId(e.target.value)
                }}
                placeholder={t('settings.adapters.appIdPlaceholder')}
              />
              <SettingField
                id="adapter-feishu-app-secret"
                label={t('settings.adapters.appSecret')}
                type="password"
                value={fsAppSecret}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setFsAppSecret(e.target.value)
                }}
                placeholder={t('settings.adapters.appSecretPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SettingField
                id="adapter-feishu-encrypt-key"
                label={t('settings.adapters.encryptKey')}
                type="password"
                value={fsEncryptKey}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setFsEncryptKey(e.target.value)
                }}
                placeholder={t('settings.adapters.encryptKeyPlaceholder')}
              />
              <SettingField
                id="adapter-feishu-verification-token"
                label={t('settings.adapters.verificationToken')}
                type="password"
                value={fsVerificationToken}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setFsVerificationToken(e.target.value)
                }}
                placeholder={t('settings.adapters.verificationTokenPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <SettingField
                id="adapter-feishu-allowed-users"
                label={t('settings.adapters.allowedUsers')}
                value={fsAllowedUsers}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setFsAllowedUsers(e.target.value)
                }}
                placeholder={t('settings.adapters.fsAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="adapter-feishu-streaming"
                checked={fsStreamingCard}
                disabled={isMutating}
                onCheckedChange={(checked) => {
                  markFormDirty()
                  setFsStreamingCard(checked)
                }}
              />
              <div>
                <Label htmlFor="adapter-feishu-streaming">{t('settings.adapters.streamingCard')}</Label>
                <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.streamingCardDesc')}</p>
              </div>
            </div>
        </TabsContent>

        <TabsContent value="wechat" className="m-0 space-y-4 p-4">
            <Card className="bg-[var(--color-surface)]">
              <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">
                    {config.wechat?.accountId ? t('settings.adapters.wechatConnected') : t('settings.adapters.wechatNotConnected')}
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {t('settings.adapters.wechatQrHint')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <LoadingButton
                    onClick={handleWechatBind}
                    loading={isWechatBinding && !wechatQrUrl}
                    disabled={isMutating && !isWechatBinding}
                    size="sm"
                  >
                    {config.wechat?.accountId ? t('settings.adapters.wechatRebind') : t('settings.adapters.wechatBind')}
                  </LoadingButton>
                  {config.wechat?.accountId && (
                    <LoadingButton
                      onClick={(event) => {
                        adapterUnbindTriggerRef.current = event.currentTarget
                        setAdapterUnbindError('')
                        setPendingAdapterUnbind('wechatAccount')
                      }}
                      loading={isUnbindingWechatAccount}
                      disabled={isMutating}
                      size="sm"
                      variant="destructive"
                    >
                      {t('settings.adapters.wechatUnbindAccount')}
                    </LoadingButton>
                  )}
                </div>
              </div>

              {wechatQrUrl && (
                <div className="flex items-start gap-4">
                  <img
                    src={wechatQrUrl}
                    alt={t('settings.adapters.wechatQrAlt')}
                    className="h-40 w-40 rounded-lg border border-[var(--color-border)] bg-white object-contain p-2"
                  />
                  <div className="pt-2 text-sm text-[var(--color-text-secondary)]">
                    {wechatStatus || t('settings.adapters.wechatWaiting')}
                  </div>
                </div>
              )}

              {!wechatQrUrl && wechatStatus && (
                <Alert>
                  <AlertDescription>{wechatStatus}</AlertDescription>
                </Alert>
              )}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-1">
              <SettingField
                id="adapter-wechat-allowed-users"
                label={t('settings.adapters.allowedUsers')}
                value={wcAllowedUsers}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setWcAllowedUsers(e.target.value)
                }}
                placeholder={t('settings.adapters.wcAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.wechatAllowedUsersHint')}</p>
            </div>
        </TabsContent>

        <TabsContent value="dingtalk" className="m-0 space-y-4 p-4">
            <Card className="bg-[var(--color-surface)]">
              <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.adapters.dingtalkQrTitle')}</h4>
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.dingtalkQrDesc')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <LoadingButton
                    onClick={handleStartDingtalkAuth}
                    loading={isStartingDtAuth}
                    disabled={isMutating && !isStartingDtAuth}
                    size="sm"
                  >
                    {t('settings.adapters.dingtalkStartAuth')}
                  </LoadingButton>
                  {(config.dingtalk?.clientId || dtClientId) && (
                    <LoadingButton
                      onClick={(event) => {
                        adapterUnbindTriggerRef.current = event.currentTarget
                        setAdapterUnbindError('')
                        setPendingAdapterUnbind('dingtalkBot')
                      }}
                      loading={isUnbindingDtBot}
                      disabled={isMutating}
                      size="sm"
                      variant="destructive"
                    >
                      {t('settings.adapters.dingtalkUnbindBot')}
                    </LoadingButton>
                  )}
                </div>
              </div>

              {dtRegistration && (
                <div className="flex flex-wrap items-center gap-4">
                  {dtRegistration.qrDataUrl ? (
                    <img
                      src={dtRegistration.qrDataUrl}
                      alt={t('settings.adapters.dingtalkQrAlt')}
                      className="h-40 w-40 rounded-lg border border-[var(--color-border)] bg-white object-contain p-2"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm text-[var(--color-text-primary)]">{t('settings.adapters.dingtalkWaiting')}</p>
                    <a
                      href={dtRegistration.verificationUriComplete}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-[var(--color-brand)] hover:underline"
                    >
                      {dtRegistration.verificationUriComplete}
                    </a>
                  </div>
                </div>
              )}

              {dtAuthStatus === 'bound' && (
                <Alert>
                  <CheckCircle2 aria-hidden="true" />
                  <AlertDescription>{t('settings.adapters.dingtalkBound')}</AlertDescription>
                </Alert>
              )}
              {dtAuthStatus === 'error' && (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertDescription>{dtAuthError}</AlertDescription>
                </Alert>
              )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <SettingField
                id="adapter-dingtalk-client-id"
                label={t('settings.adapters.dingtalkClientId')}
                value={dtClientId}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setDtClientId(e.target.value)
                }}
                placeholder={t('settings.adapters.dingtalkClientIdPlaceholder')}
              />
              <SettingField
                id="adapter-dingtalk-client-secret"
                label={t('settings.adapters.dingtalkClientSecret')}
                type="password"
                value={dtClientSecret}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setDtClientSecret(e.target.value)
                }}
                placeholder={t('settings.adapters.dingtalkClientSecretPlaceholder')}
              />
            </div>
            <SettingField
              id="adapter-dingtalk-endpoint"
              label={t('settings.adapters.dingtalkEndpoint')}
              value={dtEndpoint}
              disabled={isSaving}
              onChange={(e) => {
                markFormDirty()
                setDtEndpoint(e.target.value)
              }}
              placeholder={t('settings.adapters.dingtalkEndpointPlaceholder')}
            />
            <div className="flex flex-col gap-1">
              <SettingField
                id="adapter-dingtalk-template-id"
                label={t('settings.adapters.dingtalkPermissionCardTemplateId')}
                value={dtPermissionCardTemplateId}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setDtPermissionCardTemplateId(e.target.value)
                }}
                placeholder={t('settings.adapters.dingtalkPermissionCardTemplateIdPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.dingtalkPermissionCardTemplateIdHint')}</p>
            </div>
            <div className="flex flex-col gap-1">
              <SettingField
                id="adapter-dingtalk-allowed-users"
                label={t('settings.adapters.allowedUsers')}
                value={dtAllowedUsers}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setDtAllowedUsers(e.target.value)
                }}
                placeholder={t('settings.adapters.dtAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
        </TabsContent>

        <TabsContent value="telegram" className="m-0 space-y-4 p-4">
            <SettingField
              id="adapter-telegram-token"
              label={t('settings.adapters.botToken')}
              type="password"
              value={tgBotToken}
              disabled={isSaving}
              onChange={(e) => {
                markFormDirty()
                setTgBotToken(e.target.value)
              }}
              placeholder={t('settings.adapters.botTokenPlaceholder')}
            />
            <div className="flex flex-col gap-1">
              <SettingField
                id="adapter-telegram-allowed-users"
                label={t('settings.adapters.allowedUsers')}
                value={tgAllowedUsers}
                error={tgAllowedUsersError}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setTgAllowedUsersError('')
                  setTgAllowedUsers(e.target.value)
                }}
                placeholder={t('settings.adapters.tgAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
        </TabsContent>

        <TabsContent value="whatsapp" className="m-0 space-y-4 p-4">
            <Card className="bg-[var(--color-surface)]">
              <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">
                    {config.whatsapp?.accountJid ? t('settings.adapters.whatsappConnected') : t('settings.adapters.whatsappNotConnected')}
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {t('settings.adapters.whatsappQrHint')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <LoadingButton
                    onClick={handleWhatsAppBind}
                    loading={isWhatsAppBinding && !whatsappQrUrl}
                    disabled={isMutating && !isWhatsAppBinding}
                    size="sm"
                  >
                    {config.whatsapp?.accountJid ? t('settings.adapters.whatsappRebind') : t('settings.adapters.whatsappBind')}
                  </LoadingButton>
                  {config.whatsapp?.accountJid && (
                    <LoadingButton
                      onClick={(event) => {
                        adapterUnbindTriggerRef.current = event.currentTarget
                        setAdapterUnbindError('')
                        setPendingAdapterUnbind('whatsappAccount')
                      }}
                      loading={isUnbindingWhatsAppAccount}
                      disabled={isMutating}
                      size="sm"
                      variant="destructive"
                    >
                      {t('settings.adapters.whatsappUnbindAccount')}
                    </LoadingButton>
                  )}
                </div>
              </div>

              {config.whatsapp?.accountJid && (
                <p className="text-xs text-[var(--color-text-tertiary)]">{config.whatsapp.accountJid}</p>
              )}

              {whatsappQrUrl && (
                <div className="flex items-start gap-4">
                  <img
                    src={whatsappQrUrl}
                    alt={t('settings.adapters.whatsappQrAlt')}
                    className="h-40 w-40 rounded-lg border border-[var(--color-border)] bg-white object-contain p-2"
                  />
                  <div className="pt-2 text-sm text-[var(--color-text-secondary)]">
                    {whatsappStatus || t('settings.adapters.whatsappWaiting')}
                  </div>
                </div>
              )}

              {!whatsappQrUrl && whatsappStatus && (
                <Alert>
                  <AlertDescription>{whatsappStatus}</AlertDescription>
                </Alert>
              )}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-1">
              <SettingField
                id="adapter-whatsapp-allowed-users"
                label={t('settings.adapters.allowedUsers')}
                value={waAllowedUsers}
                disabled={isSaving}
                onChange={(e) => {
                  markFormDirty()
                  setWaAllowedUsers(e.target.value)
                }}
                placeholder={t('settings.adapters.waAllowedUsersPlaceholder')}
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.adapters.whatsappAllowedUsersHint')}</p>
            </div>
        </TabsContent>
        </Tabs>
      </Card>

      {/* Save */}
      <div className="space-y-3">
        <LoadingButton onClick={handleSave} loading={isSaving} disabled={isMutating && !isSaving}>
          {saveStatus === 'saved' ? t('settings.adapters.saved') : t('settings.adapters.save')}
        </LoadingButton>
        {saveStatus === 'saved' && (
          <Alert aria-live="polite">
            <CheckCircle2 aria-hidden="true" />
            <AlertTitle>{t('settings.adapters.saved')}</AlertTitle>
          </Alert>
        )}
        {saveStatus === 'error' && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{t('settings.adapters.saveFailed')}</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}
        {restartWarning && (
          <Alert>
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{t('settings.adapters.restartFailed')}</AlertTitle>
            <AlertDescription>{restartWarning}</AlertDescription>
          </Alert>
        )}
      </div>

      <AlertDialog
        open={pendingUnbind !== null}
        onOpenChange={(open) => {
          if (!open && !isUnbinding) {
            setPendingUnbind(null)
            setUnbindError('')
          }
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            const target = pairedUnbindTriggerRef.current
            pairedUnbindTriggerRef.current = null
            if (!target?.isConnected) return
            event.preventDefault()
            target.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.adapters.unbind')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.adapters.unbindConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          {unbindError && (
            <Alert variant="destructive">
              <AlertDescription>{unbindError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnbinding}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-error)] text-white hover:opacity-90"
              disabled={isUnbinding}
              aria-busy={isUnbinding || undefined}
              onClick={(event) => {
                event.preventDefault()
                void confirmUnbind()
              }}
            >
              {t('settings.adapters.unbind')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingAdapterUnbind !== null}
        onOpenChange={(open) => {
          if (!open && !isUnbindingWechatAccount && !isUnbindingDtBot && !isUnbindingWhatsAppAccount) {
            setPendingAdapterUnbind(null)
            setAdapterUnbindError('')
          }
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            const target = adapterUnbindTriggerRef.current
            adapterUnbindTriggerRef.current = null
            if (!target?.isConnected) return
            event.preventDefault()
            target.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{adapterUnbindTitle}</AlertDialogTitle>
            <AlertDialogDescription>{adapterUnbindDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          {adapterUnbindError && (
            <Alert variant="destructive">
              <AlertDescription>{adapterUnbindError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnbindingWechatAccount || isUnbindingDtBot || isUnbindingWhatsAppAccount}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-error)] text-white hover:opacity-90"
              disabled={isUnbindingWechatAccount || isUnbindingDtBot || isUnbindingWhatsAppAccount}
              onClick={(event) => {
                event.preventDefault()
                const action = pendingAdapterUnbind === 'wechatAccount'
                  ? handleUnbindWechatAccount
                  : pendingAdapterUnbind === 'whatsappAccount'
                    ? handleUnbindWhatsAppAccount
                    : handleUnbindDingtalkBot
                void action()
              }}
            >
              {adapterUnbindTitle}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
