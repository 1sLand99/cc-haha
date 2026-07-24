import { useEffect, useId, useState, type ReactNode, type RefObject } from 'react'
import { Bell, Clock3, Info, TriangleAlert } from 'lucide-react'
import { useTaskStore } from '../../stores/taskStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useAdapterStore } from '../../stores/adapterStore'
import { PromptEditor } from './PromptEditor'
import { DayOfWeekPicker } from './DayOfWeekPicker'
import { useTranslation } from '../../i18n'
import { describeCron, isValidCron, parseCron, type FrequencyKey } from '../../lib/cronDescribe'
import type { CronTask } from '../../types/task'
import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { ScrollArea } from '../ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { LoadingButton } from '../ui/custom/loading-button'

type NotificationChannel = 'desktop' | 'telegram' | 'feishu'

type Props = {
  open: boolean
  onClose: () => void
  editTask?: CronTask
  restoreFocusRef?: RefObject<HTMLButtonElement | null>
}

type TaskSelectProps = {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
}

const MINUTE_INTERVALS = [5, 10, 15, 20, 30]
const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12]
const MINUTE_OFFSETS = [0, 15, 30, 45]

function buildCron(
  freq: FrequencyKey,
  time: string,
  opts: {
    minuteInterval: number
    hourInterval: number
    minuteOffset: number
    selectedDays: number[]
    monthDay: number
    customCron: string
  },
): string {
  const [hours, minutes] = time.split(':').map(Number)
  switch (freq) {
    case 'everyNMinutes':
      return `*/${opts.minuteInterval} * * * *`
    case 'everyNHours':
      return `${opts.minuteOffset} */${opts.hourInterval} * * *`
    case 'daily':
      return `${minutes} ${hours} * * *`
    case 'weekdays':
      return `${minutes} ${hours} * * 1-5`
    case 'specificDays':
      return `${minutes} ${hours} * * ${[...opts.selectedDays].sort((a, b) => a - b).join(',')}`
    case 'monthly':
      return `${minutes} ${hours} ${opts.monthDay} * *`
    case 'customCron':
      return opts.customCron.trim()
  }
}

function TaskSelect({
  id,
  label,
  value,
  onValueChange,
  children,
  className,
}: TaskSelectProps) {
  const labelId = `${id}-label`

  return (
    <div className={className}>
      <Label id={labelId}>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-labelledby={labelId} className="mt-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  )
}

export function NewTaskModal({ open, onClose, editTask, restoreFocusRef }: Props) {
  const t = useTranslation()
  const { createTask, updateTask } = useTaskStore()
  const sessions = useSessionStore((state) => state.sessions)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const defaultWorkDir = activeSession?.workDir || ''
  const adapterConfig = useAdapterStore((state) => state.config)
  const fetchAdapterConfig = useAdapterStore((state) => state.fetchConfig)
  const isEdit = !!editTask
  const parsed = editTask ? parseCron(editTask.cron) : null
  const nameId = useId()
  const descriptionId = useId()
  const frequencyId = useId()
  const intervalId = useId()
  const offsetId = useId()
  const monthDayId = useId()
  const customCronId = useId()
  const customCronHintId = useId()
  const customCronErrorId = useId()
  const timeId = useId()
  const notificationId = useId()

  useEffect(() => {
    if (open) void fetchAdapterConfig()
  }, [fetchAdapterConfig, open])

  const isFeishuConfigured = !!(
    adapterConfig.feishu?.appId &&
    adapterConfig.feishu?.appSecret &&
    (
      (adapterConfig.feishu?.pairedUsers?.length ?? 0) > 0 ||
      (adapterConfig.feishu?.allowedUsers?.length ?? 0) > 0
    )
  )
  const isTelegramConfigured = !!(
    adapterConfig.telegram?.botToken &&
    (
      (adapterConfig.telegram?.pairedUsers?.length ?? 0) > 0 ||
      (adapterConfig.telegram?.allowedUsers?.length ?? 0) > 0
    )
  )

  const frequencyOptions: Array<{ value: FrequencyKey; label: string }> = [
    { value: 'everyNMinutes', label: t('newTask.everyNMinutes') },
    { value: 'everyNHours', label: t('newTask.everyNHours') },
    { value: 'daily', label: t('newTask.daily') },
    { value: 'weekdays', label: t('newTask.weekdays') },
    { value: 'specificDays', label: t('newTask.specificDays') },
    { value: 'monthly', label: t('newTask.monthly') },
    { value: 'customCron', label: t('newTask.customCron') },
  ]

  const [name, setName] = useState(editTask?.name || '')
  const [description, setDescription] = useState(editTask?.description || '')
  const [prompt, setPrompt] = useState(editTask?.prompt || '')
  const [frequency, setFrequency] = useState<FrequencyKey>(parsed?.frequency || 'daily')
  const [time, setTime] = useState(parsed?.time || '09:00')
  const [model, setModel] = useState(editTask?.model || '')
  const [providerId, setProviderId] = useState<string | null | undefined>(editTask?.providerId)
  const [folderPath, setFolderPath] = useState(editTask?.folderPath || defaultWorkDir)
  const [useWorktree, setUseWorktree] = useState(editTask?.useWorktree || false)
  const [notifyEnabled, setNotifyEnabled] = useState(editTask?.notification?.enabled || false)
  const [notifyChannels, setNotifyChannels] = useState<NotificationChannel[]>(
    editTask?.notification?.channels || [],
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [minuteInterval, setMinuteInterval] = useState(parsed?.minuteInterval || 15)
  const [hourInterval, setHourInterval] = useState(parsed?.hourInterval || 1)
  const [minuteOffset, setMinuteOffset] = useState(parsed?.minuteOffset || 0)
  const [selectedDays, setSelectedDays] = useState<number[]>(parsed?.selectedDays || [1])
  const [monthDay, setMonthDay] = useState(parsed?.monthDay || 1)
  const [customCron, setCustomCron] = useState(parsed?.customCron || '0 9 * * *')

  const showTime = ['daily', 'weekdays', 'specificDays', 'monthly'].includes(frequency)
  const cronValue = buildCron(frequency, time, {
    minuteInterval,
    hourInterval,
    minuteOffset,
    selectedDays,
    monthDay,
    customCron,
  })
  const customCronInvalid = frequency === 'customCron' && !!customCron.trim() && !isValidCron(customCron)
  const canSubmit = !!(
    name.trim() &&
    description.trim() &&
    prompt.trim() &&
    (frequency !== 'customCron' || isValidCron(customCron)) &&
    (frequency !== 'specificDays' || selectedDays.length > 0) &&
    (!notifyEnabled || notifyChannels.length > 0)
  )

  const updateChannel = (channel: NotificationChannel, checked: boolean) => {
    setNotifyChannels((current) => checked
      ? current.includes(channel) ? current : [...current, channel]
      : current.filter((item) => item !== channel))
  }

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        cron: cronValue,
        prompt: prompt.trim(),
        model: model || undefined,
        providerId,
        permissionMode: 'bypassPermissions',
        folderPath: folderPath.trim() || undefined,
        useWorktree: useWorktree || undefined,
        notification: notifyEnabled && notifyChannels.length > 0
          ? { enabled: true as const, channels: notifyChannels }
          : undefined,
      }
      if (isEdit) {
        await updateTask(editTask.id, payload)
      } else {
        await createTask({ ...payload, enabled: true, recurring: true })
      }
      onClose()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) onClose()
      }}
    >
      <DialogContent
        className="grid max-h-[88dvh] w-[min(94vw,680px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef) return
          event.preventDefault()
          queueMicrotask(() => {
            if (restoreFocusRef.current?.isConnected) {
              restoreFocusRef.current.focus()
            }
          })
        }}
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (isSubmitting) event.preventDefault()
        }}
      >
        <DialogHeader className="border-b border-[var(--color-border-separator)] px-5 py-4">
          <DialogTitle>{isEdit ? t('tasks.editTitle') : t('newTask.title')}</DialogTitle>
          <DialogDescription>{t('newTask.localWarning')}</DialogDescription>
        </DialogHeader>

        <form
          id="scheduled-task-form"
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <ScrollArea className="min-h-0">
            <div className="space-y-5 p-5">
              <Alert role="note" className="grid-cols-[auto_1fr] items-center gap-x-2.5">
                <Info className="size-4 text-[var(--color-text-secondary)]" aria-hidden="true" />
                <AlertDescription>{t('newTask.localWarning')}</AlertDescription>
              </Alert>

              {submitError ? (
                <Alert variant="destructive">
                  <AlertDescription className="text-[var(--color-error)]">
                    {submitError}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={nameId}>
                    {t('newTask.name')}
                    <span aria-hidden="true" className="text-[var(--color-error)]"> *</span>
                  </Label>
                  <Input
                    id={nameId}
                    required
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('newTask.namePlaceholder')}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={descriptionId}>
                    {t('newTask.description')}
                    <span aria-hidden="true" className="text-[var(--color-error)]"> *</span>
                  </Label>
                  <Input
                    id={descriptionId}
                    required
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t('newTask.descPlaceholder')}
                  />
                </div>
              </div>

              <PromptEditor
                value={prompt}
                onChange={setPrompt}
                placeholder={t('newTask.promptPlaceholder')}
                modelId={model}
                onModelChange={setModel}
                providerId={providerId}
                onProviderIdChange={setProviderId}
                folderPath={folderPath}
                onFolderPathChange={setFolderPath}
                useWorktree={useWorktree}
                onUseWorktreeChange={setUseWorktree}
              />

              <div className="space-y-4">
                <TaskSelect
                  id={frequencyId}
                  label={t('newTask.frequency')}
                  value={frequency}
                  onValueChange={(value) => setFrequency(value as FrequencyKey)}
                >
                  {frequencyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </TaskSelect>

                {frequency === 'everyNMinutes' ? (
                  <TaskSelect
                    id={intervalId}
                    label={t('newTask.interval')}
                    value={String(minuteInterval)}
                    onValueChange={(value) => setMinuteInterval(Number(value))}
                  >
                    {MINUTE_INTERVALS.map((interval) => (
                      <SelectItem key={interval} value={String(interval)}>
                        {t('newTask.intervalMinutes', { n: interval })}
                      </SelectItem>
                    ))}
                  </TaskSelect>
                ) : null}

                {frequency === 'everyNHours' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TaskSelect
                      id={intervalId}
                      label={t('newTask.interval')}
                      value={String(hourInterval)}
                      onValueChange={(value) => setHourInterval(Number(value))}
                    >
                      {HOUR_INTERVALS.map((interval) => (
                        <SelectItem key={interval} value={String(interval)}>
                          {t('newTask.intervalHours', { n: interval })}
                        </SelectItem>
                      ))}
                    </TaskSelect>
                    <TaskSelect
                      id={offsetId}
                      label={t('newTask.minuteOffset')}
                      value={String(minuteOffset)}
                      onValueChange={(value) => setMinuteOffset(Number(value))}
                    >
                      {MINUTE_OFFSETS.map((offset) => (
                        <SelectItem key={offset} value={String(offset)}>
                          {t('newTask.atMinute', { m: offset.toString().padStart(2, '0') })}
                        </SelectItem>
                      ))}
                    </TaskSelect>
                  </div>
                ) : null}

                {frequency === 'specificDays' ? (
                  <div className="space-y-1.5">
                    <Label>{t('newTask.specificDays')}</Label>
                    <DayOfWeekPicker selected={selectedDays} onChange={setSelectedDays} />
                  </div>
                ) : null}

                {frequency === 'monthly' ? (
                  <TaskSelect
                    id={monthDayId}
                    label={t('newTask.monthDay')}
                    value={String(monthDay)}
                    onValueChange={(value) => setMonthDay(Number(value))}
                  >
                    {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {t('newTask.onMonthDay', { d: day })}
                      </SelectItem>
                    ))}
                  </TaskSelect>
                ) : null}

                {frequency === 'customCron' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={customCronId}>{t('newTask.customCron')}</Label>
                    <Input
                      id={customCronId}
                      value={customCron}
                      onChange={(event) => setCustomCron(event.target.value)}
                      placeholder={t('newTask.cronFormatHint')}
                      className="font-[var(--font-mono)]"
                      aria-invalid={customCronInvalid || undefined}
                      aria-describedby={[
                        customCronHintId,
                        customCronInvalid ? customCronErrorId : '',
                      ].filter(Boolean).join(' ')}
                    />
                    <p id={customCronHintId} className="text-xs text-[var(--color-text-tertiary)]">
                      {t('newTask.cronFormatHint')}
                    </p>
                    {customCronInvalid ? (
                      <p id={customCronErrorId} className="text-xs text-[var(--color-error)]">
                        {t('newTask.invalidCron')}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {showTime ? (
                  <div className="w-full max-w-40 space-y-1.5">
                    <Label htmlFor={timeId}>{t('newTask.time')}</Label>
                    <Input
                      id={timeId}
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={notificationId}
                      checked={notifyEnabled}
                      onCheckedChange={(checked) => {
                        const enabled = checked === true
                        setNotifyEnabled(enabled)
                        if (enabled && notifyChannels.length === 0) {
                          setNotifyChannels(['desktop'])
                        }
                      }}
                    />
                    <Label htmlFor={notificationId} className="min-w-0 cursor-pointer">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Bell className="size-4" aria-hidden="true" />
                        {t('newTask.notifyOnComplete')}
                      </span>
                      <span className="mt-1 block text-xs font-normal leading-5 text-[var(--color-text-tertiary)]">
                        {t('newTask.notifyHint')}
                      </span>
                    </Label>
                  </div>

                  {notifyEnabled ? (
                    <div className="space-y-3 pl-7">
                      <div
                        role="group"
                        aria-label={t('newTask.notifyChannels')}
                        className="flex flex-wrap gap-x-5 gap-y-3"
                      >
                        <ChannelCheckbox
                          id={`${notificationId}-desktop`}
                          label={t('newTask.notifyDesktop')}
                          checked={notifyChannels.includes('desktop')}
                          onCheckedChange={(checked) => updateChannel('desktop', checked)}
                        />
                        <ChannelCheckbox
                          id={`${notificationId}-feishu`}
                          label={t('settings.adapters.feishu')}
                          checked={notifyChannels.includes('feishu')}
                          disabled={!isFeishuConfigured}
                          suffix={!isFeishuConfigured ? t('newTask.notConfigured') : undefined}
                          onCheckedChange={(checked) => updateChannel('feishu', checked)}
                        />
                        <ChannelCheckbox
                          id={`${notificationId}-telegram`}
                          label={t('settings.adapters.telegram')}
                          checked={notifyChannels.includes('telegram')}
                          disabled={!isTelegramConfigured}
                          suffix={!isTelegramConfigured ? t('newTask.notConfigured') : undefined}
                          onCheckedChange={(checked) => updateChannel('telegram', checked)}
                        />
                      </div>

                      {notifyChannels.length === 0 ? (
                        <Alert
                          role="status"
                          className="grid-cols-[auto_1fr] items-center gap-x-2 border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8"
                        >
                          <TriangleAlert className="size-4 text-[var(--color-warning)]" aria-hidden="true" />
                          <AlertDescription className="text-[var(--color-warning)]">
                            {t('newTask.noChannelSelected')}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card role="status" aria-live="polite">
                <CardContent className="flex items-center gap-2 p-3 text-xs text-[var(--color-text-secondary)]">
                  <Clock3 className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {customCronInvalid
                      ? t('newTask.invalidCron')
                      : describeCron(cronValue, t)}
                  </span>
                </CardContent>
              </Card>

              <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                {t('newTask.delayNote')}
              </p>
            </div>
          </ScrollArea>

          <DialogFooter className="border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-5 py-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <LoadingButton type="submit" loading={isSubmitting} disabled={!canSubmit}>
              {isEdit ? t('tasks.saveChanges') : t('newTask.create')}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type ChannelCheckboxProps = {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  suffix?: string
  onCheckedChange: (checked: boolean) => void
}

function ChannelCheckbox({
  id,
  label,
  checked,
  disabled = false,
  suffix,
  onCheckedChange,
}: ChannelCheckboxProps) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
      <Label
        htmlFor={id}
        className={disabled ? 'cursor-not-allowed text-[var(--color-text-tertiary)]' : 'cursor-pointer'}
      >
        {label}
      </Label>
      {suffix ? (
        <span className="text-[10px] text-[var(--color-warning)]">{suffix}</span>
      ) : null}
    </div>
  )
}
