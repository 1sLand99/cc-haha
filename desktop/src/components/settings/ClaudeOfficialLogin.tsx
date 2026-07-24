// desktop/src/components/settings/ClaudeOfficialLogin.tsx
//
// 显示当前 Claude Official OAuth 登录状态,提供 Login / Logout 按钮。
// 点击 Login 调 desktop host shell.open 打开浏览器走 OAuth flow;浏览器回 callback
// 到 haha server 后,store 的 polling 自动刷新 UI 展示"已登录"。

import { useEffect } from 'react'
import { LogIn, LogOut } from 'lucide-react'
import { useHahaOAuthStore } from '../../stores/hahaOAuthStore'
import { useTranslation } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { LoadingButton } from '../ui/custom/loading-button'
import { Skeleton } from '../ui/skeleton'

export function ClaudeOfficialLogin() {
  const t = useTranslation()
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useHahaOAuthStore()

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  const handleLogin = async () => {
    try {
      const { authorizeUrl } = await login()
      try {
        await getDesktopHost().shell.open(authorizeUrl)
        startPolling()
      } catch (err) {
        console.error('[ClaudeOfficialLogin] shellOpen failed:', err)
        useHahaOAuthStore.setState({
          error: t('settings.claudeOfficialLogin.openBrowserFailed'),
        })
      }
    } catch {
      // store.login() errors are already captured into store.error
    }
  }

  if (status === null) {
    if (error) {
      return (
        <Alert data-testid="claude-official-login" variant="destructive" className="py-2">
          <AlertDescription className="text-[var(--color-error)]">
            {t('settings.claudeOfficialLogin.errorPrefix')}{error}
          </AlertDescription>
        </Alert>
      )
    }
    return (
      <div data-testid="claude-official-login" role="status" aria-label={t('common.loading')}>
        <Skeleton className="h-5 w-32" />
      </div>
    )
  }

  if (status.loggedIn) {
    const subTypeLabel = status.subscriptionType
      ? status.subscriptionType.toUpperCase()
      : t('settings.claudeOfficialLogin.subTypeUnknown')
    return (
      <div data-testid="claude-official-login" className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="outline" className="border-[var(--color-success)]/35 text-[var(--color-success)]">
          ✓ {t('settings.claudeOfficialLogin.loggedInPrefix')} {subTypeLabel})
        </Badge>
        <LoadingButton
          variant="secondary"
          size="sm"
          onClick={logout}
          loading={isLoading}
        >
          <LogOut aria-hidden="true" />
          {isLoading
            ? t('settings.claudeOfficialLogin.logoutProcessing')
            : t('settings.claudeOfficialLogin.logoutButton')}
        </LoadingButton>
      </div>
    )
  }

  return (
    <div data-testid="claude-official-login" className="flex flex-col gap-2">
      <div className="text-sm text-[var(--color-text-secondary)]">
        {t('settings.claudeOfficialLogin.intro')}
      </div>
      <LoadingButton
        className="self-start"
        onClick={handleLogin}
        loading={isLoading}
      >
        <LogIn aria-hidden="true" />
        {isLoading
          ? t('settings.claudeOfficialLogin.loginStarting')
          : t('settings.claudeOfficialLogin.loginButton')}
      </LoadingButton>
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-[var(--color-error)]">
            {t('settings.claudeOfficialLogin.errorPrefix')}{error}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
