import { useId } from 'react'
import { Gavel, TriangleAlert } from 'lucide-react'
import { ModelSelector } from '../controls/ModelSelector'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { useTranslation } from '../../i18n'
import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string

  modelId: string
  onModelChange: (modelId: string) => void
  providerId?: string | null
  onProviderIdChange: (providerId: string | null) => void

  folderPath: string
  onFolderPathChange: (path: string) => void

  useWorktree: boolean
  onUseWorktreeChange: (checked: boolean) => void
}

export function PromptEditor({
  value,
  onChange,
  placeholder,
  modelId,
  onModelChange,
  providerId,
  onProviderIdChange,
  folderPath,
  onFolderPathChange,
  useWorktree: _useWorktree,
  onUseWorktreeChange: _onUseWorktreeChange,
}: Props) {
  const t = useTranslation()
  const promptId = useId()

  return (
    <div className="space-y-1.5">
      <Label htmlFor={promptId}>
        {t('newTask.prompt')}
        <span aria-hidden="true" className="text-[var(--color-error)]"> *</span>
      </Label>
      <Card className="overflow-visible bg-[var(--color-surface)] focus-within:border-[var(--color-border-focus)] focus-within:shadow-[var(--shadow-focus-ring)]">
        <Textarea
          id={promptId}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={4}
          className="min-h-[120px] resize-y rounded-b-none border-0 shadow-none focus-visible:border-0 focus-visible:shadow-none"
        />

        <CardContent className="flex flex-col gap-2 rounded-b-[var(--radius-lg)] border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="destructive" className="gap-1.5">
              <Gavel className="size-3.5" aria-hidden="true" />
              {t('newTask.fullPermissions')}
            </Badge>
            <ModelSelector
              runtimeSelection={modelId ? { providerId: providerId ?? null, modelId } : undefined}
              onRuntimeSelectionChange={(selection) => {
                onProviderIdChange(selection.providerId)
                onModelChange(selection.modelId)
              }}
            />
          </div>

          <DirectoryPicker value={folderPath} onChange={onFolderPathChange} />

          <Alert
            variant="destructive"
            role="note"
            className="grid-cols-[auto_1fr] items-center gap-x-2 border-0 bg-[var(--color-error)]/8 px-2 py-1.5"
          >
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            <AlertDescription className="text-[11px] leading-4 text-[var(--color-error)]">
              {t('promptEditor.bypassWarning')}
              {folderPath
                ? ` ${t('promptEditor.within')} ${folderPath}`
                : ` ${t('promptEditor.selectFolder')}`}.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}
