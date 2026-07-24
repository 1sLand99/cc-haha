import { RotateCcw, Stethoscope } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DoctorReport, DoctorReportItem } from '../../api/doctor'
import { useTranslation } from '../../i18n'
import {
  runDoctorCheck,
  runLocalDoctorRepair,
  type LocalDoctorRepairResult,
} from '../../lib/doctorRepair'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader } from '../ui/card'
import { ConfirmationAlertDialog } from '../ui/custom/confirmation-alert-dialog'
import { LoadingButton } from '../ui/custom/loading-button'
import { getSessionBrowsablePath } from '../../lib/sessionWorkspace'

type DoctorPanelProps = {
  compact?: boolean
}

export function DoctorPanel({ compact = false }: DoctorPanelProps) {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  )
  const cwd = getSessionBrowsablePath(activeSession)
  const requestSequence = useRef(0)
  const mountedRef = useRef(true)
  const operationRef = useRef<{ id: number; type: 'report' | 'reset' } | null>(null)
  const operationSequenceRef = useRef(0)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const [activeOperation, setActiveOperation] = useState<'report' | 'reset' | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [reportResult, setReportResult] = useState<{ cwd?: string; report: DoctorReport } | null>(null)
  const [resetResult, setResetResult] = useState<LocalDoctorRepairResult | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const report = reportResult && reportResult.cwd === cwd ? reportResult.report : null

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestSequence.current += 1
      operationSequenceRef.current += 1
      operationRef.current = null
    }
  }, [])

  useEffect(() => {
    requestSequence.current += 1
    operationSequenceRef.current += 1
    operationRef.current = null
    setActiveOperation(null)
    setReportResult(null)
    setOperationError(null)
  }, [cwd])

  const beginReportRequest = () => {
    const requestId = ++requestSequence.current
    const requestCwd = cwd
    return {
      requestId,
      requestCwd,
      response: runDoctorCheck({ cwd: requestCwd }),
    }
  }

  const isCurrentRequest = (requestId: number, requestCwd?: string) => {
    return mountedRef.current && requestSequence.current === requestId && cwdRef.current === requestCwd
  }

  const beginOperation = (operation: 'report' | 'reset'): number | null => {
    if (operationRef.current) return null
    const operationId = ++operationSequenceRef.current
    operationRef.current = { id: operationId, type: operation }
    setActiveOperation(operation)
    setOperationError(null)
    return operationId
  }

  const finishOperation = (operationId: number, operation: 'report' | 'reset') => {
    if (operationRef.current?.id !== operationId || operationRef.current.type !== operation) return
    operationRef.current = null
    if (mountedRef.current) setActiveOperation(null)
  }

  const handleRunDoctor = async () => {
    const operationId = beginOperation('report')
    if (operationId === null) return
    const request = beginReportRequest()
    try {
      const nextReport = await request.response
      if (!isCurrentRequest(request.requestId, request.requestCwd)) return
      setReportResult({ cwd: request.requestCwd, report: nextReport })
      addToast({ type: 'success', message: t('settings.diagnostics.doctorCheckCompleted') })
    } catch (error) {
      if (!isCurrentRequest(request.requestId, request.requestCwd)) return
      const message = error instanceof Error ? error.message : t('settings.diagnostics.doctorFailed')
      setOperationError(message)
      addToast({
        type: 'error',
        message,
      })
    } finally {
      finishOperation(operationId, 'report')
    }
  }

  const handleResetSafeState = async () => {
    const operationId = beginOperation('reset')
    if (operationId === null) return
    let requestId: number | null = null
    const requestCwd = cwd
    try {
      const result = runLocalDoctorRepair()
      setResetResult(result)
      setResetConfirmOpen(false)
      addToast({
        type: result.failedKeys.length === 0 ? 'success' : 'warning',
        message: result.failedKeys.length === 0
          ? t('settings.diagnostics.doctorResetCompleted')
          : t('settings.diagnostics.doctorPartial', { count: String(result.failedKeys.length) }),
      })
      const request = beginReportRequest()
      requestId = request.requestId
      const nextReport = await request.response
      if (!isCurrentRequest(request.requestId, request.requestCwd)) return
      setReportResult({ cwd: request.requestCwd, report: nextReport })
    } catch (error) {
      if (requestId !== null && !isCurrentRequest(requestId, requestCwd)) return
      if (!mountedRef.current) return
      const message = error instanceof Error ? error.message : t('settings.diagnostics.doctorFailed')
      setOperationError(message)
      addToast({
        type: 'error',
        message,
      })
    } finally {
      finishOperation(operationId, 'reset')
    }
  }

  const unhealthyItems = report?.items.filter(
    (item) => item.status !== 'ok' && item.status !== 'not_configured',
  ) ?? []
  const healthyCount = report?.items.filter((item) => item.status === 'ok').length ?? 0
  const titleId = compact ? 'doctor-panel-title-compact' : 'doctor-panel-title'

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className={`flex ${compact ? 'flex-col gap-3 p-3' : 'flex-row items-start justify-between gap-4'}`}>
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.diagnostics.doctorTitle')}
          </h3>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {t('settings.diagnostics.doctorDescription')}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {t('settings.diagnostics.doctorProtectedData')}
          </p>
        </div>
        <div className={`flex flex-wrap gap-2 ${compact ? 'justify-start' : 'justify-end'} shrink-0`}>
          <LoadingButton
            size="sm"
            onClick={handleRunDoctor}
            loading={activeOperation === 'report'}
            disabled={activeOperation !== null}
          >
            {activeOperation !== 'report' ? <Stethoscope aria-hidden="true" /> : null}
            {t('settings.diagnostics.runDoctor')}
          </LoadingButton>
          <ConfirmationAlertDialog
            open={resetConfirmOpen}
            onOpenChange={setResetConfirmOpen}
            trigger={(
              <Button variant="secondary" size="sm" disabled={activeOperation !== null}>
                <RotateCcw aria-hidden="true" />
                {t('settings.diagnostics.resetSafeUiState')}
              </Button>
            )}
            title={t('settings.diagnostics.resetSafeUiState')}
            description={t('settings.diagnostics.confirmResetSafeUiState')}
            cancelLabel={t('common.cancel')}
            actionLabel={t('settings.diagnostics.resetSafeUiState')}
            onConfirm={handleResetSafeState}
            loading={activeOperation === 'reset'}
            destructive
          />
        </div>
      </CardHeader>

      <CardContent className={compact ? 'p-3 pt-0' : 'space-y-3 pt-0'}>
        <div className="text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
          {t('settings.diagnostics.doctorSafeKeys')}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span>{t('settings.diagnostics.doctorScope')}:</span>
          <Badge variant="outline">
            {cwd
              ? t('settings.diagnostics.doctorScopeProject')
              : t('settings.diagnostics.doctorScopeUser')}
          </Badge>
        </div>

        {operationError ? (
          <Alert variant="destructive">
            <AlertDescription className="text-[var(--color-error)]">{operationError}</AlertDescription>
          </Alert>
        ) : null}

        {report ? (
          <div className="space-y-2">
            <Alert role="status">
              <AlertDescription className="text-[var(--color-text-secondary)]">
                {t('settings.diagnostics.doctorSummary', {
                  healthy: String(healthyCount),
                  neutral: String(report.summary.neutralCount),
                  missing: String(report.summary.missingCount),
                  invalid: String(report.summary.invalidCount),
                })}
              </AlertDescription>
            </Alert>
            {unhealthyItems.length === 0 ? (
              <div className="text-xs text-[var(--color-text-tertiary)]">
                {t('settings.diagnostics.doctorNoFindings')}
              </div>
            ) : (
              <ul className="space-y-1.5" aria-label={t('settings.diagnostics.doctorFindings')}>
                {unhealthyItems.map((item) => <DoctorFinding key={item.id} item={item} />)}
              </ul>
            )}
          </div>
        ) : null}

        {resetResult ? (
          <Alert role="status">
            <AlertDescription className="text-[var(--color-text-secondary)]">
              <div>{t('settings.diagnostics.doctorRemovedKeys')}: {formatKeys(resetResult.removedKeys, t('settings.diagnostics.doctorNoKeys'))}</div>
              <div className="mt-1">{t('settings.diagnostics.doctorFailedKeys')}: {formatKeys(resetResult.failedKeys, t('settings.diagnostics.doctorNoKeys'))}</div>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function DoctorFinding({ item }: { item: DoctorReportItem }) {
  const t = useTranslation()
  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[var(--color-text-secondary)] break-all">{item.path}</span>
        <Badge
          variant="outline"
          className="border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
        >
          {getStatusLabel(t, item.status)}
        </Badge>
      </div>
      {item.error ? <div className="mt-1 text-[var(--color-text-tertiary)] break-words">{item.error}</div> : null}
    </li>
  )
}

function getStatusLabel(t: ReturnType<typeof useTranslation>, status: DoctorReportItem['status']): string {
  switch (status) {
    case 'not_configured': return t('settings.diagnostics.doctorStatusNotConfigured')
    case 'missing': return t('settings.diagnostics.doctorStatusMissing')
    case 'invalid_json': return t('settings.diagnostics.doctorStatusInvalidJson')
    case 'invalid_jsonl': return t('settings.diagnostics.doctorStatusInvalidJsonl')
    case 'invalid_schema': return t('settings.diagnostics.doctorStatusInvalidSchema')
    case 'unreadable': return t('settings.diagnostics.doctorStatusUnreadable')
    default: return t('settings.diagnostics.doctorStatusHealthy')
  }
}

function formatKeys(keys: string[], emptyLabel: string): string {
  return keys.length > 0 ? keys.join(', ') : emptyLabel
}
