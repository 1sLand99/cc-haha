// desktop/src/components/settings/ChatGPTOfficialLogin.tsx

import { useEffect, useState } from 'react'
import { Copy, LogIn, LogOut } from 'lucide-react'
import { useHahaOpenAIOAuthStore } from '../../stores/hahaOpenAIOAuthStore'
import { useTranslation } from '../../i18n'
import { copyTextToClipboard } from '../chat/clipboard'
import { getDesktopHost } from '../../lib/desktopHost'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { LoadingButton } from '../ui/custom/loading-button'
import { Skeleton } from '../ui/skeleton'

export function ChatGPTOfficialLogin() {
  const t = useTranslation()
  const [manualAuthorizeUrl, setManualAuthorizeUrl] = useState<string | null>(null)
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useHahaOpenAIOAuthStore()

  useEffect(() => {
    void fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  useEffect(() => {
    if (status?.loggedIn) {
      setManualAuthorizeUrl(null)
    }
  }, [status?.loggedIn])

  const handleLogin = async () => {
    setManualAuthorizeUrl(null)
    try {
      const { authorizeUrl } = await login()
      setManualAuthorizeUrl(authorizeUrl)
      try {
        await getDesktopHost().shell.open(authorizeUrl)
        setManualAuthorizeUrl(null)
        startPolling()
      } catch (err) {
        console.error('[ChatGPTOfficialLogin] shellOpen failed:', err)
        useHahaOpenAIOAuthStore.setState({
          error: t('settings.chatgptOfficialLogin.openBrowserFailed'),
        })
      }
    } catch {
      // store.login() errors are already captured into store.error
    }
  }

  const handleCopyAuthorizeUrl = async () => {
    if (!manualAuthorizeUrl) return
    const copied = await copyTextToClipboard(manualAuthorizeUrl)
    if (copied) {
      setManualAuthorizeUrl(null)
      useHahaOpenAIOAuthStore.setState({ error: null })
      startPolling()
      return
    }
    useHahaOpenAIOAuthStore.setState({
      error: t('settings.chatgptOfficialLogin.copyLinkFailed'),
    })
  }

  const manualAuthorizeButton = manualAuthorizeUrl ? (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleCopyAuthorizeUrl}
      className="self-start"
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      {t('settings.chatgptOfficialLogin.copyAuthorizeUrl')}
    </Button>
  ) : null

  if (status === null) {
    if (error) {
      return (
        <div data-testid="chatgpt-official-login" className="flex flex-col gap-2">
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-[var(--color-error)]">
              {t('settings.chatgptOfficialLogin.errorPrefix')}{error}
            </AlertDescription>
          </Alert>
          {manualAuthorizeButton}
        </div>
      )
    }
    return (
      <div data-testid="chatgpt-official-login" role="status" aria-label={t('common.loading')}>
        <Skeleton className="h-5 w-32" />
      </div>
    )
  }

  if (status.loggedIn) {
    const accountLabel = status.email || status.accountId || t('settings.chatgptOfficialLogin.accountUnknown')
    return (
      <div data-testid="chatgpt-official-login" className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="outline" className="border-[var(--color-success)]/35 text-[var(--color-success)]">
          {t('settings.chatgptOfficialLogin.loggedInPrefix')} {accountLabel}
        </Badge>
        <LoadingButton
          variant="secondary"
          size="sm"
          onClick={logout}
          loading={isLoading}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          {isLoading
            ? t('settings.chatgptOfficialLogin.logoutProcessing')
            : t('settings.chatgptOfficialLogin.logoutButton')}
        </LoadingButton>
      </div>
    )
  }

  return (
    <div data-testid="chatgpt-official-login" className="flex flex-col gap-2">
      <div className="text-sm text-[var(--color-text-secondary)]">
        {t('settings.chatgptOfficialLogin.intro')}
      </div>
      <LoadingButton
        className="self-start"
        onClick={handleLogin}
        loading={isLoading}
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {isLoading
          ? t('settings.chatgptOfficialLogin.loginStarting')
          : t('settings.chatgptOfficialLogin.loginButton')}
      </LoadingButton>
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-[var(--color-error)]">
            {t('settings.chatgptOfficialLogin.errorPrefix')}{error}
          </AlertDescription>
        </Alert>
      )}
      {manualAuthorizeButton}
    </div>
  )
}
