import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useOpenTargetStore } from '../../stores/openTargetStore'
import { useAnchoredPosition } from '@/hooks/useAnchoredPosition'
import { useDismissable } from '@/hooks/useDismissable'
import { TargetIcon } from '@/components/composite/TargetIcon'
import { getDesktopHost } from '@/lib/desktopHost'
import { useSettingsStore } from '@/stores/settingsStore'
import { OpenProjectMenuPanel } from './OpenProjectMenuPanel'

type Props = {
  path: string | null | undefined
}

export function OpenProjectMenu({ path }: Props) {
  const t = useTranslation()
  const targets = useOpenTargetStore((state) => state.targets)
  const primaryTargetId = useOpenTargetStore((state) => state.primaryTargetId)
  const ensureTargets = useOpenTargetStore((state) => state.ensureTargets)
  const openTarget = useOpenTargetStore((state) => state.openTarget)
  const appZoom = useSettingsStore((state) => state.uiZoom)
  const [open, setOpen] = useState(false)
  const [nativeMenuFailed, setNativeMenuFailed] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const browserPreviewRef = useRef<HTMLElement | null>(null)
  const desktopHost = getDesktopHost()
  const useNativeMenu = desktopHost.kind === 'electron' && !nativeMenuFailed

  useEffect(() => {
    if (!path) {
      setOpen(false)
      return
    }
    void ensureTargets()
  }, [ensureTargets, path])

  useEffect(() => () => {
    if (desktopHost.kind === 'electron') void desktopHost.openProjectMenu.dismiss()
  }, [desktopHost])

  const handleDismiss = useCallback(() => setOpen(false), [])

  useDismissable({
    open: open && !useNativeMenu,
    refs: [menuRef],
    triggerRef: buttonRef,
    onDismiss: handleDismiss,
  })

  const primaryTarget = useMemo(
    () => targets.find((target) => target.id === primaryTargetId) ?? targets[0] ?? null,
    [primaryTargetId, targets],
  )
  const hasMenu = targets.length > 1

  useLayoutEffect(() => {
    browserPreviewRef.current = open
      ? document.querySelector<HTMLElement>('[data-browser-preview-host]')
      : null
  }, [open])

  const { style: menuPosition } = useAnchoredPosition({
    open: open && hasMenu && !useNativeMenu,
    anchorRef: buttonRef,
    floatingRef: menuRef,
    avoidRef: browserPreviewRef,
    placement: 'bottom-end',
  })

  const handleOpenTarget = async (targetId: string) => {
    if (!path) return
    try {
      await openTarget(targetId, path)
    } catch {
      // Store state already records the failure; keep the control responsive.
    } finally {
      setOpen(false)
    }
  }

  const handleMenuToggle = () => {
    if (!hasMenu) {
      void handleOpenTarget(primaryTarget!.id)
      return
    }

    if (!useNativeMenu) {
      setOpen((value) => !value)
      return
    }

    if (open) {
      setOpen(false)
      void desktopHost.openProjectMenu.dismiss()
      return
    }

    const anchor = buttonRef.current?.getBoundingClientRect()
    if (!anchor) return
    setOpen(true)
    void desktopHost.openProjectMenu.show({
      anchor: {
        x: anchor.left,
        y: anchor.top,
        width: anchor.width,
        height: anchor.height,
      },
      targets,
      zoom: appZoom,
    }).then((targetId) => {
      setOpen(false)
      if (targetId) void handleOpenTarget(targetId)
    }).catch(() => {
      // Keep the in-page collision-avoiding menu as a runtime fallback.
      setNativeMenuFailed(true)
      setOpen(true)
    })
  }

  if (!path || !primaryTarget) return null

  const buttonLabel = hasMenu
    ? t('openProject.openProject')
    : t('openProject.openIn', { target: primaryTarget.label })

  return (
    <div className="relative flex items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label={buttonLabel}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        title={buttonLabel}
        onClick={handleMenuToggle}
        className={`inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-tertiary)] transition-[background-color,color,border-color,box-shadow] duration-150 ease-out hover:border-[var(--color-outline)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] ${
          hasMenu
            ? 'min-w-[2.75rem] px-2 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
            : 'w-8 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <TargetIcon target={primaryTarget} />
        {hasMenu && <ChevronDown size={14} strokeWidth={1.9} />}
      </button>

      {open && hasMenu && !useNativeMenu ? createPortal(
        <OpenProjectMenuPanel
          ref={menuRef}
          targets={targets}
          onSelect={(targetId) => void handleOpenTarget(targetId)}
          className="fixed z-[var(--z-dropdown)]"
          style={menuPosition}
        />,
        document.body,
      ) : null}
    </div>
  )
}
