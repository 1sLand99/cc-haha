import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible'

const sectionOpenState = new Map<string, boolean>()
const TraceSectionScopeContext = createContext('default')

export function resetTraceSectionState(): void {
  sectionOpenState.clear()
}

export function TraceSectionStateProvider({
  scopeId,
  children,
}: {
  scopeId: string
  children: ReactNode
}) {
  return (
    <TraceSectionScopeContext.Provider value={scopeId}>
      {children}
    </TraceSectionScopeContext.Provider>
  )
}

export function Section({
  scopeId,
  sectionKey,
  title,
  badge,
  actions,
  defaultOpen = false,
  children,
}: {
  scopeId?: string
  sectionKey: string
  title: string
  badge?: string | number
  actions?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const contextScopeId = useContext(TraceSectionScopeContext)
  const resolvedScopeId = scopeId ?? contextScopeId
  const stateKey = useMemo(() => `${resolvedScopeId}:${sectionKey}`, [resolvedScopeId, sectionKey])
  const [open, setOpen] = useState(() => sectionOpenState.get(stateKey) ?? defaultOpen)
  const contentId = useId()

  useEffect(() => {
    setOpen(sectionOpenState.get(stateKey) ?? defaultOpen)
  }, [stateKey, defaultOpen])

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        sectionOpenState.set(stateKey, nextOpen)
        setOpen(nextOpen)
      }}
      asChild
    >
      <section className="border-t border-[var(--color-border)] first:border-t-0">
      <div className="flex items-center gap-2 px-4 py-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            aria-controls={contentId}
            className="h-8 min-w-0 flex-1 justify-start gap-1.5 px-0 text-left"
          >
            <ChevronRight
              size={13}
              strokeWidth={2}
              className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform ${open ? 'rotate-90' : ''}`}
            />
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
              {title}
            </span>
            {badge !== undefined ? (
              <Badge variant="secondary" className="min-h-4 shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0 font-mono text-[10px] text-[var(--color-text-tertiary)]">
                {badge}
              </Badge>
            ) : null}
          </Button>
        </CollapsibleTrigger>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
        <CollapsibleContent id={contentId}>
          <div className="px-4 pb-4">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}
