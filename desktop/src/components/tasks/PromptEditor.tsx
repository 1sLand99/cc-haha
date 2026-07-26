import { ModelSelector } from '../controls/ModelSelector'
import { DirectoryPicker } from '@/components/composite/DirectoryPicker'
import { useTranslation } from '../../i18n'
import { Badge } from '@/components/ui/Badge'

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
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] focus-within:border-[var(--color-border-focus)] transition-colors overflow-visible">
      {/* Prompt textarea */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        style={{ minHeight: 120 }}
      />

      {/* Bottom toolbar */}
      <div className="border-t border-[var(--color-border)]/40 px-3 py-2 flex flex-col gap-2 bg-[var(--color-surface-container-low)] rounded-b-[var(--radius-lg)]">
        {/* Row 1: Permission + Model selectors */}
        <div className="flex items-center justify-between">
          <Badge
            tone="danger"
            size="md"
            icon={<span className="material-symbols-outlined text-[14px]">gavel</span>}
          >
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

        {/* Row 2: Folder picker */}
        <div className="flex items-center justify-between">
          <DirectoryPicker value={folderPath} onChange={onFolderPathChange} />
        </div>

        {/* `wrap` matters here: the sentence ends in an absolute folder path,
            which a default badge would push onto one unbreakable line. The
            fill also moves off `bg-[var(--color-error)]/8` — Safari 15 WebView
            drops that color function, so the strip had no background there. */}
        <Badge tone="danger" wrap pill={false} className="w-full" icon={<span className="material-symbols-outlined text-[12px]">warning</span>}>
          {t('promptEditor.bypassWarning')}{folderPath ? ` ${t('promptEditor.within')} ${folderPath}` : ` ${t('promptEditor.selectFolder')}`}.
        </Badge>
      </div>
    </div>
  )
}
