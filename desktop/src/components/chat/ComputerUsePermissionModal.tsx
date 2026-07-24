import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Accessibility,
  AppWindow,
  CheckCircle2,
  EyeOff,
  MonitorUp,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { computerUseApi } from '../../api/computerUse'
import { useChatStore } from '../../stores/chatStore'
import { useOverlayStore } from '../../stores/overlayStore'
import type {
  ComputerUsePermissionRequest,
  ComputerUsePermissionResponse,
} from '../../types/chat'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { IconButton } from '@/components/ui/custom/icon-button'
import { LoadingButton } from '@/components/ui/custom/loading-button'

type Props = {
  sessionId: string
  request: ComputerUsePermissionRequest | null
}

const DEFAULT_GRANT_FLAGS = {
  clipboardRead: false,
  clipboardWrite: false,
  systemKeyCombos: false,
} as const

function denyAllResponse(): ComputerUsePermissionResponse {
  return {
    granted: [],
    denied: [],
    flags: { ...DEFAULT_GRANT_FLAGS },
    userConsented: false,
  }
}

function buildAllowResponse(
  request: ComputerUsePermissionRequest,
): ComputerUsePermissionResponse {
  const now = Date.now()
  const granted = request.apps.flatMap((app) => {
    if (!app.resolved || app.alreadyGranted) return []
    return [{
      bundleId: app.resolved.bundleId,
      displayName: app.resolved.displayName,
      grantedAt: now,
      tier: app.proposedTier,
    }]
  })

  const denied = request.apps.flatMap((app) => {
    if (app.resolved) return []
    return [{
      bundleId: app.requestedName,
      reason: 'not_installed' as const,
    }]
  })

  const flags = {
    ...DEFAULT_GRANT_FLAGS,
    ...Object.fromEntries(
      Object.entries(request.requestedFlags).filter(([, value]) => value === true),
    ),
  }

  return {
    granted,
    denied,
    flags,
    userConsented: true,
  }
}

export function ComputerUsePermissionModal({
  sessionId,
  request: activeRequest,
}: Props) {
  const t = useTranslation()
  const lastRequestRef = useRef<ComputerUsePermissionRequest | null>(activeRequest)
  if (activeRequest) lastRequestRef.current = activeRequest
  const request = activeRequest ?? lastRequestRef.current
  const respondToComputerUsePermission = useChatStore(
    (s) => s.respondToComputerUsePermission,
  )
  const respondingRequestRef = useRef<string | null>(null)
  const openingPaneRef = useRef<{
    requestId: string
    pane: 'Privacy_Accessibility' | 'Privacy_ScreenCapture'
  } | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const denyButtonRef = useRef<HTMLButtonElement>(null)
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null)
  const [openingPane, setOpeningPane] = useState<{
    requestId: string
    pane: 'Privacy_Accessibility' | 'Privacy_ScreenCapture'
  } | null>(null)
  const [openSettingsErrorRequestId, setOpenSettingsErrorRequestId] = useState<
    string | null
  >(null)

  const requestedFlags = useMemo(
    () =>
      request
        ? Object.entries(request.requestedFlags)
            .filter(([, enabled]) => enabled)
            .map(([flag]) => flag)
        : [],
    [request],
  )

  const hasRequest = activeRequest !== null
  useEffect(() => {
    if (!hasRequest) return
    const { push, pop } = useOverlayStore.getState()
    push()
    return () => pop()
  }, [hasRequest])

  useEffect(() => {
    if (!activeRequest?.requestId) return
    denyButtonRef.current?.focus()
    setOpenSettingsErrorRequestId(null)
  }, [activeRequest?.requestId])

  useEffect(() => {
    if (hasRequest || respondingRequestRef.current === null) return
    respondingRequestRef.current = null
    setRespondingRequestId(null)
  }, [hasRequest])

  if (!request) return <Dialog open={false} />

  const respondOnce = (response: ComputerUsePermissionResponse) => {
    if (respondingRequestRef.current === request.requestId) return
    respondingRequestRef.current = request.requestId
    setRespondingRequestId(request.requestId)
    respondToComputerUsePermission(sessionId, request.requestId, response)
  }

  const handleDeny = () => respondOnce(denyAllResponse())

  const handleAllow = () => {
    respondOnce(buildAllowResponse(request))
  }

  const openSettings = async (
    pane: 'Privacy_Accessibility' | 'Privacy_ScreenCapture',
  ) => {
    const opening = { requestId: request.requestId, pane }
    if (openingPaneRef.current?.requestId === opening.requestId) return

    openingPaneRef.current = opening
    setOpenSettingsErrorRequestId(null)
    setOpeningPane(opening)
    try {
      await computerUseApi.openSettings(pane)
    } catch {
      setOpenSettingsErrorRequestId(opening.requestId)
    } finally {
      if (
        openingPaneRef.current?.requestId === opening.requestId &&
        openingPaneRef.current.pane === opening.pane
      ) {
        openingPaneRef.current = null
      }
      setOpeningPane((current) =>
        current?.requestId === opening.requestId && current.pane === opening.pane
          ? null
          : current,
      )
    }
  }

  const tccState = request.tccState
  const isResponding = respondingRequestId === request.requestId
  const title = tccState
    ? t('computerUseApproval.titleTcc')
    : t('computerUseApproval.titleApps')

  return (
    <Dialog
      open={hasRequest}
      onOpenChange={(open) => {
        if (!open && activeRequest) handleDeny()
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] w-[calc(100vw-48px)] max-w-[640px] flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          previousFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
          denyButtonRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const previousFocus = previousFocusRef.current
          previousFocusRef.current = null
          if (previousFocus?.isConnected) previousFocus.focus()
        }}
      >
        <DialogHeader className="border-b border-[var(--color-border)] px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2 pr-8">
            {tccState ? (
              <ShieldAlert className="size-5 text-[var(--color-warning)]" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-5 text-[var(--color-brand)]" aria-hidden="true" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {tccState ? t('computerUseApproval.tccHint') : (request.reason || title)}
          </DialogDescription>
          <DialogClose asChild>
            <IconButton
              label={`${t('computerUseApproval.deny')} — ${title}`}
              variant="ghost"
              size="icon-sm"
              className="absolute right-4 top-4"
            >
              <X aria-hidden="true" />
            </IconButton>
          </DialogClose>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-6 py-4">
            {tccState ? (
              <>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                  {t('computerUseApproval.tccHint')}
                </p>

                <div className="space-y-3">
                  <PermissionRow
                    icon={<Accessibility className="size-4" aria-hidden="true" />}
                    label={t('computerUseApproval.accessibility')}
                    granted={tccState.accessibility}
                    actionLabel={t('computerUseApproval.openAccessibility')}
                    actionDisabled={openingPane?.requestId === request.requestId}
                    actionLoading={
                      openingPane?.requestId === request.requestId &&
                      openingPane.pane === 'Privacy_Accessibility'
                    }
                    onAction={() => openSettings('Privacy_Accessibility')}
                  />
                  <PermissionRow
                    icon={<MonitorUp className="size-4" aria-hidden="true" />}
                    label={t('computerUseApproval.screenRecording')}
                    granted={tccState.screenRecording}
                    actionLabel={t('computerUseApproval.openScreenRecording')}
                    actionDisabled={openingPane?.requestId === request.requestId}
                    actionLoading={
                      openingPane?.requestId === request.requestId &&
                      openingPane.pane === 'Privacy_ScreenCapture'
                    }
                    onAction={() => openSettings('Privacy_ScreenCapture')}
                  />
                </div>

                <Alert role="note">
                  <AlertTitle>{t('computerUseApproval.tryAgain')}</AlertTitle>
                  <AlertDescription>
                    {t('computerUseApproval.tryAgainHint')}
                  </AlertDescription>
                </Alert>

                {openSettingsErrorRequestId === request.requestId ? (
                  <Alert variant="destructive">
                    <TriangleAlert aria-hidden="true" />
                    <AlertDescription className="pl-6 text-[var(--color-error)]">
                      {t('settings.computerUse.openSettingsFailed')}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : (
              <>
                {request.reason ? (
                  <Alert role="note">
                    <AlertTitle>{t('computerUseApproval.reason')}</AlertTitle>
                    <AlertDescription className="text-sm text-[var(--color-text-primary)]">
                      {request.reason}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  {request.apps.map((app) => {
                    const resolved = app.resolved
                    return (
                      <Card key={resolved?.bundleId ?? app.requestedName}>
                        <CardContent className="space-y-3 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-2">
                              <AppWindow
                                className="mt-0.5 size-4 shrink-0 text-[var(--color-text-secondary)]"
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">
                                  {resolved?.displayName ?? app.requestedName}
                                </div>
                                <div className="mt-1 break-all text-xs text-[var(--color-text-tertiary)]">
                                  {resolved?.bundleId ?? t('computerUseApproval.notInstalled')}
                                </div>
                              </div>
                            </div>
                            <Badge variant="secondary" className="uppercase">
                              {app.proposedTier}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {!resolved ? (
                              <Badge variant="destructive">
                                <TriangleAlert aria-hidden="true" />
                                {t('computerUseApproval.notInstalled')}
                              </Badge>
                            ) : null}

                            {app.alreadyGranted ? (
                              <Badge
                                variant="outline"
                                className="border-[var(--color-success)]/40 text-[var(--color-success)]"
                              >
                                <CheckCircle2 aria-hidden="true" />
                                {t('computerUseApproval.alreadyGranted')}
                              </Badge>
                            ) : null}

                            {app.isSentinel ? (
                              <Badge
                                variant="outline"
                                className="border-[var(--color-warning)]/40 text-[var(--color-warning)]"
                              >
                                <ShieldAlert aria-hidden="true" />
                                {t('computerUseApproval.sensitiveApp')}
                              </Badge>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>

                {requestedFlags.length > 0 ? (
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                        {t('computerUseApproval.alsoRequested')}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {requestedFlags.map((flag) => (
                          <Badge key={flag} variant="secondary">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                {request.willHide && request.willHide.length > 0 ? (
                  <Alert role="note">
                    <EyeOff className="size-4" aria-hidden="true" />
                    <AlertDescription className="pl-6 text-sm text-[var(--color-text-secondary)]">
                      {request.autoUnhideEnabled
                        ? t('computerUseApproval.hideWhileWorkingRestore', {
                            count: request.willHide.length,
                          })
                        : t('computerUseApproval.hideWhileWorking', {
                            count: request.willHide.length,
                          })}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-[var(--color-border)] px-6 py-4">
          <Button
            ref={denyButtonRef}
            variant="ghost"
            disabled={isResponding}
            aria-busy={isResponding || undefined}
            onClick={handleDeny}
          >
            {t('computerUseApproval.deny')}
          </Button>
          {tccState ? (
            <Button
              variant="secondary"
              disabled={isResponding}
              aria-busy={isResponding || undefined}
              onClick={handleDeny}
            >
              {t('computerUseApproval.tryAgain')}
            </Button>
          ) : (
            <Button
              disabled={isResponding}
              aria-busy={isResponding || undefined}
              onClick={handleAllow}
            >
              {t('computerUseApproval.allow')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PermissionRow({
  icon,
  label,
  granted,
  actionLabel,
  actionDisabled,
  actionLoading,
  onAction,
}: {
  icon: React.ReactNode
  label: string
  granted: boolean
  actionLabel: string
  actionDisabled: boolean
  actionLoading: boolean
  onAction: () => void
}) {
  const t = useTranslation()

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[var(--color-text-secondary)]">{icon}</span>
          <div>
            <div className="text-sm font-semibold">{label}</div>
            <Badge
              variant="outline"
              className={
                granted
                  ? 'mt-1 border-[var(--color-success)]/40 text-[var(--color-success)]'
                  : 'mt-1'
              }
            >
              {granted ? <CheckCircle2 aria-hidden="true" /> : null}
              {granted
                ? t('computerUseApproval.granted')
                : t('computerUseApproval.notGranted')}
            </Badge>
          </div>
        </div>

        {!granted ? (
          <LoadingButton
            variant="secondary"
            size="sm"
            loading={actionLoading}
            disabled={actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </LoadingButton>
        ) : null}
      </CardContent>
    </Card>
  )
}
