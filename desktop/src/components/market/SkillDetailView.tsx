import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, CircleSlash2, FileText, Folder } from 'lucide-react'
import { useTranslation } from '../../i18n'
import type {
  InstallState,
  NotInstallableReason,
  SecurityReport,
  SecurityStatus,
} from '../../types/market'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { InstallStateBadge } from './InstallStateBadge'
import { SecurityBadge } from './SecurityBadge'
import { FilePreview, type PreviewFile, type PreviewFileContent } from './FilePreview'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { SkillAvatar } from './SkillAvatar'

export type SkillDetailMetaItem = {
  label: string
  value: ReactNode
}

export type SkillDetailViewProps = {
  name: string
  version?: string
  iconUrl?: string
  sourceLabel: string
  summary?: string
  securityStatus?: SecurityStatus
  securityReports?: SecurityReport[]
  installState?: InstallState
  notInstallableReason?: NotInstallableReason
  /** Action buttons rendered in the decision area (install / uninstall / open). */
  actions?: ReactNode
  /** Optional banner below the header (e.g. install errors). */
  banner?: ReactNode
  meta: SkillDetailMetaItem[]
  description: string
  files: PreviewFile[]
  loadFile: (path: string) => Promise<PreviewFileContent>
  blockExternalResources?: boolean
  onBack: () => void
  backLabel: string
}

/**
 * Shared, data-source-agnostic skill detail layout. Both the online market
 * detail and the locally-installed skill detail render through this view so
 * the reading experience stays identical.
 */
export function SkillDetailView(props: SkillDetailViewProps) {
  const t = useTranslation()
  const [tab, setTab] = useState<'overview' | 'files'>('overview')
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--color-surface-container-lowest)]"
      data-testid="skill-detail-view"
    >
      <div className="mx-auto w-full max-w-[1320px] px-6 py-6 lg:px-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onBack}
          className="w-fit px-2"
        >
          <ArrowLeft strokeWidth={2} aria-hidden="true" />
          {props.backLabel}
        </Button>

        <header className="mt-5 border-b border-[var(--color-border)]/70 pb-6">
          <div className="flex min-w-0 items-start gap-4 sm:gap-5">
            <SkillAvatar skill={{ name: props.name, iconUrl: props.iconUrl }} size={64} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
                <span>{props.sourceLabel}</span>
                {props.version && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-mono font-normal normal-case tracking-normal">v{props.version}</span>
                  </>
                )}
              </div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-1.5 break-words text-2xl font-semibold leading-8 tracking-[-0.03em] text-[var(--color-text-primary)] outline-none sm:text-[28px]"
              >
                {props.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {props.securityStatus && <SecurityBadge status={props.securityStatus} />}
                {props.installState && <InstallStateBadge state={props.installState} />}
              </div>
              {props.summary && (
                <p className="mt-3 max-w-3xl break-words text-[13px] leading-6 text-[var(--color-text-secondary)] sm:text-sm">
                  {props.summary}
                </p>
              )}
            </div>
          </div>

          {props.installState === 'not-installable' && props.notInstallableReason && (
            <Alert
              variant="destructive"
              className="mt-5"
              data-testid="market-not-installable-reason"
            >
              <CircleSlash2 aria-hidden="true" />
              <AlertDescription>
                {t(`market.reason.${props.notInstallableReason}`)}
              </AlertDescription>
            </Alert>
          )}

          {props.securityReports && props.securityReports.length > 0 && (
            <Card
              className="mt-5 bg-[var(--color-surface-container-low)]"
              data-testid="market-security-reports"
            >
              <CardContent className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-3">
                <span className="mr-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
                  {t('market.detail.securityReport')}
                </span>
                {props.securityReports.map((report) => (
                  <Badge key={report.vendor} variant="secondary" className="gap-1.5 py-1.5">
                    <span className="font-medium text-[var(--color-text-primary)]">{report.vendor}</span>
                    {report.statusText}
                    {report.reportUrl && (
                      <a
                        href={report.reportUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--color-brand)] hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {t('market.detail.viewReport')}
                      </a>
                    )}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {props.banner}
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <main className="min-w-0">
            <Tabs
              value={tab}
              onValueChange={(value) => {
                if (value === 'overview' || value === 'files') setTab(value)
              }}
              className="flex-col gap-0"
            >
              <TabsList
                aria-label={props.name}
                className="w-full justify-start gap-1 rounded-none border-b border-[var(--color-border)]"
              >
                <TabsTrigger
                  value="overview"
                  data-testid="skill-detail-tab-overview"
                  onClick={() => setTab('overview')}
                  className="-mb-px min-h-10 rounded-none border-b-2 border-transparent px-3.5 data-[state=active]:border-[var(--color-brand)] data-[state=active]:bg-transparent"
                >
                  <FileText strokeWidth={1.9} aria-hidden="true" />
                  {t('market.detail.overview')}
                </TabsTrigger>
                <TabsTrigger
                  value="files"
                  data-testid="skill-detail-tab-files"
                  onClick={() => setTab('files')}
                  className="-mb-px min-h-10 rounded-none border-b-2 border-transparent px-3.5 data-[state=active]:border-[var(--color-brand)] data-[state=active]:bg-transparent"
                >
                  <Folder strokeWidth={1.9} aria-hidden="true" />
                  {t('market.detail.files')}
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
                    {props.files.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-5">
                <Card data-testid="skill-detail-overview">
                  <CardContent className="px-6 py-6 sm:px-8 sm:py-7">
                    {props.description.trim() ? (
                      <MarkdownRenderer
                        content={props.description}
                        variant="document"
                        blockExternalResources={props.blockExternalResources}
                        className="mx-auto max-w-[72ch]"
                      />
                    ) : (
                      <p className="py-6 text-center text-sm text-[var(--color-text-tertiary)]">
                        {t('market.detail.noDescription')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="files" className="mt-5">
                <FilePreview
                  files={props.files}
                  loadFile={props.loadFile}
                  blockExternalResources={props.blockExternalResources}
                />
              </TabsContent>
            </Tabs>
          </main>

          <aside
            data-testid="skill-detail-sidebar"
            className="order-first min-w-0 lg:order-none lg:sticky lg:top-5"
          >
            <Card className="overflow-hidden bg-[var(--color-surface-container-low)]">
              {props.actions && (
                <CardContent
                  className={`p-3 [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-center ${props.meta.length > 0 ? 'border-b border-[var(--color-border)]' : ''}`}
                >
                  {props.actions}
                </CardContent>
              )}
              {props.meta.length > 0 && (
                <dl>
                  {props.meta.map((item) => (
                    <div
                      key={item.label}
                      className="flex min-w-0 items-start justify-between gap-4 border-b border-[var(--color-border)]/65 px-4 py-3 last:border-b-0"
                    >
                      <dt className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">{item.label}</dt>
                      <dd className="max-w-[62%] break-words text-right text-[12px] font-medium leading-5 text-[var(--color-text-primary)]">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}
