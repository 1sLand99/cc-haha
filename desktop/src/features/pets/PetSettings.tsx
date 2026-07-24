import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { ArrowLeft, FolderOpen, Grid3X3, ImageIcon, Plus, RefreshCw, Sparkles } from 'lucide-react'
import {
  desktopUiPreferencesApi,
  type DesktopPetPreferences,
} from '../../api/desktopUiPreferences'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Slider } from '../../components/ui/slider'
import { Switch } from '../../components/ui/switch'
import { Textarea } from '../../components/ui/textarea'
import { LoadingButton } from '../../components/ui/custom/loading-button'
import { useTranslation, type TranslationKey } from '../../i18n'
import { getDesktopHost } from '../../lib/desktopHost'
import { BUILTIN_PETS } from './builtinPets'
import { PetRenderer } from './PetRenderer'
import type { CustomPet, PetDescriptor } from './types'

const PET_SIZE_MIN = 96
const PET_SIZE_MAX = 192
const PET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
type PetCreationMethod = 'image' | 'atlas'

const PET_CREATE_ERROR_KEYS: Record<string, TranslationKey> = {
  'invalid-id': 'settings.pets.createError.invalidId',
  'duplicate-id': 'settings.pets.createError.duplicateId',
  'unsupported-image-format': 'settings.pets.createError.unsupportedFormat',
  'image-too-large': 'settings.pets.createError.imageTooLarge',
  'total-image-bytes-exceeded': 'settings.pets.createError.imageTooLarge',
  'decode-budget-exceeded': 'settings.pets.createError.imageTooLarge',
  'invalid-image': 'settings.pets.createError.invalidImage',
  'missing-image': 'settings.pets.createError.invalidImage',
  'symlink-image': 'settings.pets.createError.invalidImage',
  'invalid-renderer': 'settings.pets.createError.invalidImage',
  'invalid-sprite-version': 'settings.pets.createError.invalidImage',
  'invalid-manifest-version': 'settings.pets.createError.invalidImage',
  'root-invalid': 'settings.pets.createError.storage',
  'directory-changed': 'settings.pets.createError.storage',
  'io-error': 'settings.pets.createError.storage',
}

function petCreateErrorKey(method: PetCreationMethod, code: string): TranslationKey {
  if (code === 'invalid-image-dimensions') {
    return method === 'image'
      ? 'settings.pets.createError.imageDimensions'
      : 'settings.pets.createError.atlasDimensions'
  }
  return PET_CREATE_ERROR_KEYS[code] ?? 'settings.pets.createError'
}

export function PetSettings() {
  const t = useTranslation()
  const desktopAvailable = getDesktopHost().isDesktop
  const [preferences, setPreferences] = useState<DesktopPetPreferences | null>(null)
  const preferencesRef = useRef<DesktopPetPreferences | null>(null)
  const preferenceRevisionRef = useRef(0)
  const windowSyncRevisionRef = useRef(0)
  const createTriggerRef = useRef<HTMLButtonElement | null>(null)
  const createImageMethodRef = useRef<HTMLButtonElement | null>(null)
  const createIdInputRef = useRef<HTMLInputElement | null>(null)
  const [customPets, setCustomPets] = useState<CustomPet[]>([])
  const [invalidPetCount, setInvalidPetCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createMethod, setCreateMethod] = useState<PetCreationMethod | null>(null)
  const [createForm, setCreateForm] = useState({ slug: '', displayName: '', description: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    setSaveError(null)

    try {
      const host = getDesktopHost()
      const [preferencesResult, petsResult] = await Promise.all([
        desktopUiPreferencesApi.getPreferences(),
        host.isDesktop ? host.pets.list() : Promise.resolve({ pets: [], errors: [] }),
      ])
      const nextPreferences = preferencesResult.preferences.pet
      preferencesRef.current = nextPreferences
      setPreferences(nextPreferences)
      setCustomPets(petsResult.pets.map((pet) => ({ source: 'custom' as const, ...pet })))
      setInvalidPetCount(petsResult.errors.length)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!createOpen) return
    const frame = requestAnimationFrame(() => {
      if (createMethod === null) createImageMethodRef.current?.focus()
      else createIdInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [createMethod, createOpen])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    const refreshPreferences = () => {
      const revision = preferenceRevisionRef.current
      void desktopUiPreferencesApi.getPreferences()
        .then((result) => {
          if (cancelled || revision !== preferenceRevisionRef.current) return
          preferencesRef.current = result.preferences.pet
          setPreferences(result.preferences.pet)
        })
        .catch(() => {})
    }

    window.addEventListener('focus', refreshPreferences)
    if (getDesktopHost().isDesktop) {
      void getDesktopHost().pets.onVisibilityChanged(refreshPreferences)
        .then((stop) => {
          if (cancelled) stop()
          else unlisten = stop
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshPreferences)
      unlisten?.()
    }
  }, [])

  const updatePreferences = useCallback(async (
    patch: Partial<DesktopPetPreferences>,
    syncWindow = false,
  ) => {
    const current = preferencesRef.current
    if (!current) return

    const preferenceRevision = ++preferenceRevisionRef.current
    const next = { ...current, ...patch }
    const windowSyncRevision = syncWindow ? ++windowSyncRevisionRef.current : null
    preferencesRef.current = next
    setPreferences(next)
    setSaveError(null)

    let savedPet: DesktopPetPreferences
    try {
      const result = await desktopUiPreferencesApi.updatePetPreferences(patch)
      savedPet = 'preferences' in result ? result.preferences.pet : result.pet
    } catch {
      const latest = preferencesRef.current
      if (latest) {
        const rolledBack = { ...latest }
        for (const key of Object.keys(patch) as Array<keyof DesktopPetPreferences>) {
          if (Object.is(latest[key], next[key])) {
            Object.assign(rolledBack, { [key]: current[key] })
          }
        }
        preferencesRef.current = rolledBack
        setPreferences(rolledBack)
      }
      setSaveError(t('settings.pets.saveError'))
      return
    }

    if (syncWindow && windowSyncRevision === windowSyncRevisionRef.current) {
      try {
        const host = getDesktopHost()
        if (savedPet.enabled) await host.pets.show()
        else await host.pets.hide()
      } catch {
        if (preferenceRevision !== preferenceRevisionRef.current) return
        const latest = preferencesRef.current
        if (latest) {
          const rolledBack = { ...latest }
          const rollbackPatch: Partial<DesktopPetPreferences> = {}
          for (const key of Object.keys(patch) as Array<keyof DesktopPetPreferences>) {
            if (!Object.is(latest[key], next[key])) continue
            Object.assign(rolledBack, { [key]: current[key] })
            Object.assign(rollbackPatch, { [key]: current[key] })
          }
          preferencesRef.current = rolledBack
          setPreferences(rolledBack)
          if (Object.keys(rollbackPatch).length > 0) {
            await desktopUiPreferencesApi.updatePetPreferences(rollbackPatch).catch(() => undefined)
          }
          const host = getDesktopHost()
          if (rolledBack.enabled) await host.pets.show().catch(() => undefined)
          else await host.pets.hide().catch(() => undefined)
        }
        setSaveError(t('settings.pets.saveError'))
      }
    }
  }, [t])

  const handleOpenFolder = async () => {
    setSaveError(null)
    try {
      await getDesktopHost().pets.openFolder()
    } catch {
      setSaveError(t('settings.pets.openFolderError'))
    }
  }

  const createFormValid = PET_ID_PATTERN.test(createForm.slug)
    && createForm.slug.length <= 73
    && createForm.displayName.trim().length > 0
    && createForm.description.trim().length > 0

  const resetCreateDialog = () => {
    setCreateOpen(false)
    setCreateMethod(null)
    setCreateError(null)
    setCreateForm({ slug: '', displayName: '', description: '' })
  }

  const handleCreate = async () => {
    if (!createMethod || !createFormValid || createBusy || !preferences) return
    setCreateBusy(true)
    setCreateError(null)
    setSaveError(null)

    const host = getDesktopHost()
    let created: { id: string } | { errorCode: string } | null
    try {
      const input = {
        slug: createForm.slug,
        displayName: createForm.displayName.trim(),
        description: createForm.description.trim(),
        dialogTitle: createMethod === 'image'
          ? t('settings.pets.dialog.imageTitle')
          : t('settings.pets.dialog.atlasTitle'),
        dialogFilterName: createMethod === 'image'
          ? t('settings.pets.dialog.imageFilter')
          : t('settings.pets.dialog.atlasFilter'),
      }
      created = createMethod === 'image'
        ? await host.pets.createFromImage(input)
        : await host.pets.createFromAtlas(input)
    } catch {
      setCreateError(t('settings.pets.createError'))
      setCreateBusy(false)
      return
    }

    if (!created) {
      setCreateBusy(false)
      return
    }

    if ('errorCode' in created) {
      setCreateError(t(petCreateErrorKey(createMethod, created.errorCode)))
      setCreateBusy(false)
      return
    }

    resetCreateDialog()

    try {
      const petsResult = await host.pets.list()
      setCustomPets(petsResult.pets.map((pet) => ({ source: 'custom' as const, ...pet })))
      setInvalidPetCount(petsResult.errors.length)
    } catch {
      setSaveError(t('settings.pets.loadError'))
    }

    try {
      const result = await desktopUiPreferencesApi.updatePetPreferences({ selectedPetId: created.id })
      const nextPreferences = 'preferences' in result ? result.preferences.pet : result.pet
      preferencesRef.current = nextPreferences
      setPreferences(nextPreferences)
      if (nextPreferences.enabled) await host.pets.show()
    } catch {
      setSaveError(t('settings.pets.saveError'))
    } finally {
      setCreateBusy(false)
    }
  }

  const pets: readonly PetDescriptor[] = [...BUILTIN_PETS, ...customPets]

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{t('settings.pets.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('settings.pets.subtitle')}</p>
      </header>

      {loading ? (
        <Card role="status" aria-live="polite">
          <CardContent className="p-5 text-sm text-[var(--color-text-secondary)]">
            {t('settings.pets.loading')}
          </CardContent>
        </Card>
      ) : loadError || !preferences ? (
        <Alert variant="destructive" className="flex items-center justify-between gap-4">
          <AlertDescription className="text-[var(--color-error)]">
            {t('settings.pets.loadError')}
          </AlertDescription>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('settings.pets.retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <Card>
            <CardContent className="p-5">
              <ToggleRow
                label={t('settings.pets.enableTitle')}
                description={t('settings.pets.enableDescription')}
                checked={preferences.enabled}
                disabled={!desktopAvailable}
                onChange={(checked) => void updatePreferences({ enabled: checked }, true)}
              />
            </CardContent>
          </Card>

          <PetCatalog
            title={t('settings.pets.builtInTitle')}
            pets={pets.filter((pet) => pet.source === 'builtin')}
            selectedPetId={preferences.selectedPetId}
            selectedLabel={t('settings.pets.selected')}
            selectLabel={t('settings.pets.select')}
            onSelect={(id) => void updatePreferences({ selectedPetId: id }, preferences.enabled && desktopAvailable)}
          />

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.pets.customTitle')}</h2>
              <div className="flex items-center gap-2">
                <Button
                  ref={createTriggerRef}
                  variant="secondary"
                  size="sm"
                  disabled={!desktopAvailable}
                  onClick={() => {
                    setCreateError(null)
                    setCreateMethod(null)
                    setCreateForm({ slug: '', displayName: '', description: '' })
                    setCreateOpen(true)
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                  {t('settings.pets.create')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void load()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {t('settings.pets.refresh')}
                </Button>
              </div>
            </div>
            {customPets.length > 0 ? (
              <PetCatalog
                pets={customPets}
                selectedPetId={preferences.selectedPetId}
                selectedLabel={t('settings.pets.selected')}
                selectLabel={t('settings.pets.select')}
                onSelect={(id) => void updatePreferences({ selectedPetId: id }, preferences.enabled && desktopAvailable)}
              />
            ) : (
              <Card className="border-dashed bg-transparent">
                <CardContent className="p-5 text-sm text-[var(--color-text-secondary)]">
                  {t('settings.pets.customEmpty')}
                </CardContent>
              </Card>
            )}
            {invalidPetCount > 0 && (
              <Alert role="status" className="border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5">
                <AlertDescription className="text-[var(--color-warning)]">
                  {t('settings.pets.invalidCustom', { count: invalidPetCount })}
                </AlertDescription>
              </Alert>
            )}
          </section>

          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.pets.appearanceTitle')}</h2>
              <div>
                <Label htmlFor="pet-size" className="flex items-center justify-between gap-3">
                  <span>{t('settings.pets.size')}</span>
                  <output htmlFor="pet-size">{preferences.size}px</output>
                </Label>
                <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{t('settings.pets.sizeDescription')}</span>
                <Slider
                  id="pet-size"
                  aria-label={t('settings.pets.size')}
                  className="mt-3"
                  min={PET_SIZE_MIN}
                  max={PET_SIZE_MAX}
                  step={8}
                  value={[preferences.size]}
                  onValueChange={([size]) => {
                    if (typeof size === 'number') void updatePreferences({ size })
                  }}
                />
              </div>
              <div className="border-t border-[var(--color-border)]/70 pt-4">
                <ToggleRow
                  label={t('settings.pets.motion')}
                  description={t('settings.pets.motionDescription')}
                  checked={preferences.motionEnabled}
                  onChange={(checked) => void updatePreferences({ motionEnabled: checked })}
                />
              </div>
              <div className="border-t border-[var(--color-border)]/70 pt-4">
                <ToggleRow
                  label={t('settings.pets.showTaskPanel')}
                  description={t('settings.pets.showTaskPanelDescription')}
                  checked={preferences.showTaskPanel}
                  onChange={(checked) => void updatePreferences({ showTaskPanel: checked })}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="flex items-center justify-between gap-5 p-5">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-[var(--color-text-primary)]">{t('settings.pets.folderTitle')}</h2>
              <p className="mt-1 break-all font-mono text-xs text-[var(--color-text-secondary)]">
                {t('settings.pets.folderDescription')}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!desktopAvailable}
              onClick={() => void handleOpenFolder()}
            >
              <FolderOpen size={15} aria-hidden="true" />
              {t('settings.pets.openFolder')}
            </Button>
          </Card>
        </>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription className="text-[var(--color-error)]">{saveError}</AlertDescription>
        </Alert>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && !createBusy) resetCreateDialog()
        }}
      >
        <DialogContent
          aria-busy={createBusy}
          onEscapeKeyDown={(event) => {
            if (createBusy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (createBusy) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            createTriggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('settings.pets.createTitle')}</DialogTitle>
            <DialogDescription>
              {createMethod === null
                ? t('settings.pets.createMethodIntro')
                : createMethod === 'image'
                  ? t('settings.pets.createImageHint')
                  : t('settings.pets.createAtlasHint')}
            </DialogDescription>
          </DialogHeader>
          {createMethod === null ? (
            <div className="space-y-3">
              <CreationMethodCard
                buttonRef={createImageMethodRef}
                icon={<ImageIcon size={20} aria-hidden="true" />}
                title={t('settings.pets.createImageTitle')}
                description={t('settings.pets.createImageDescription')}
                detail={t('settings.pets.createImageDetail')}
                badge={t('settings.pets.createRecommended')}
                onClick={() => setCreateMethod('image')}
              />
              <CreationMethodCard
                icon={<Grid3X3 size={20} aria-hidden="true" />}
                title={t('settings.pets.createAtlasTitle')}
                description={t('settings.pets.createAtlasDescription')}
                detail={t('settings.pets.createAtlasDetail')}
                onClick={() => setCreateMethod('atlas')}
              />
              <CreationMethodCard
                icon={<Sparkles size={20} aria-hidden="true" />}
                title={t('settings.pets.createAiTitle')}
                description={t('settings.pets.createAiDescription')}
                detail={t('settings.pets.createAiUnavailable')}
                disabled
              />
            </div>
          ) : (
            <div className="space-y-4">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2"
                disabled={createBusy}
                onClick={() => {
                  setCreateMethod(null)
                  setCreateError(null)
                }}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                {t('settings.pets.createBack')}
              </Button>
              <div className="space-y-1.5">
                <Label htmlFor="pet-create-id">{t('settings.pets.createId')}</Label>
                <Input
                  ref={createIdInputRef}
                  id="pet-create-id"
                  aria-label={t('settings.pets.createId')}
                  value={createForm.slug}
                  maxLength={73}
                  placeholder="moon-cat"
                  aria-invalid={createForm.slug.length > 0 && !PET_ID_PATTERN.test(createForm.slug)}
                  onChange={(event) => setCreateForm((current) => ({ ...current, slug: event.target.value }))}
                />
                <p className="text-xs text-[var(--color-text-secondary)]">{t('settings.pets.createIdHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-create-name">{t('settings.pets.createName')}</Label>
                <Input
                  id="pet-create-name"
                  aria-label={t('settings.pets.createName')}
                  value={createForm.displayName}
                  maxLength={80}
                  onChange={(event) => setCreateForm((current) => ({ ...current, displayName: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-create-description">{t('settings.pets.createDescription')}</Label>
                <Textarea
                  id="pet-create-description"
                  aria-label={t('settings.pets.createDescription')}
                  value={createForm.description}
                  maxLength={500}
                  onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
                />
              </div>
              {createError && (
                <Alert variant="destructive">
                  <AlertDescription className="text-[var(--color-error)]">{createError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" disabled={createBusy} onClick={resetCreateDialog}>
              {t('settings.pets.createCancel')}
            </Button>
            {createMethod && (
              <LoadingButton
                loading={createBusy}
                disabled={!createFormValid}
                onClick={() => void handleCreate()}
              >
                {createMethod === 'image'
                  ? t('settings.pets.createImageSubmit')
                  : t('settings.pets.createAtlasSubmit')}
              </LoadingButton>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreationMethodCard({
  buttonRef,
  icon,
  title,
  description,
  detail,
  badge,
  disabled = false,
  onClick,
}: {
  buttonRef?: Ref<HTMLButtonElement>
  icon: ReactNode
  title: string
  description: string
  detail: string
  badge?: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <Button
      ref={buttonRef}
      variant="outline"
      className="group h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-xl p-4 text-left transition-[border-color,background-color,transform] enabled:hover:-translate-y-0.5 enabled:hover:border-[var(--color-brand)]/60 enabled:active:translate-y-0"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
          {badge && (
            <Badge variant="outline" className="border-[var(--color-brand)]/20 bg-[var(--color-brand)]/10 text-[11px] text-[var(--color-brand)]">
              {badge}
            </Badge>
          )}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">{description}</span>
        <span className="mt-1 block text-[11px] leading-4 text-[var(--color-text-tertiary)]">{detail}</span>
      </span>
    </Button>
  )
}

function PetCatalog({
  title,
  pets,
  selectedPetId,
  selectedLabel,
  selectLabel,
  onSelect,
}: {
  title?: string
  pets: readonly PetDescriptor[]
  selectedPetId: string
  selectedLabel: string
  selectLabel: string
  onSelect: (id: string) => void
}) {
  const t = useTranslation()
  return (
    <section className="space-y-3">
      {title && <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {pets.map((pet) => {
          const selected = pet.id === selectedPetId
          return (
            <article key={pet.id}>
              <Card className={`flex items-center gap-4 p-4 transition-colors ${
                selected
                  ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)]'
              }`}
            >
              <PetPreview pet={pet} />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{pet.displayName}</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                  {pet.source === 'builtin' ? t(pet.descriptionKey) : pet.description}
                </p>
              </div>
              <Button
                variant={selected ? 'ghost' : 'secondary'}
                size="sm"
                disabled={selected}
                aria-pressed={selected}
                onClick={() => onSelect(pet.id)}
              >
                {selected ? selectedLabel : selectLabel}
              </Button>
              </Card>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function PetPreview({ pet }: { pet: PetDescriptor }) {
  return (
    <div
      className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl"
      style={{ backgroundColor: pet.source === 'builtin' ? `${pet.accent}18` : undefined }}
    >
      <PetRenderer pet={pet} state="idle" size={54} motionEnabled={false} />
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()

  return (
    <div className="flex items-start justify-between gap-6">
      <span>
        <Label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-primary)]">{label}</Label>
        <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{description}</span>
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  )
}
