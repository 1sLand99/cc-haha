import * as React from 'react'
import { X } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { IconButton } from '@/components/ui/custom/icon-button'
import { cn } from '@/lib/utils'

type LocalSlashPanelProps = React.ComponentProps<typeof Card> & {
  title: string
  subtitle: string
  closeLabel: string
  onClose: () => void
  viewportClassName?: string
}

function LocalSlashPanel({
  title,
  subtitle,
  closeLabel,
  onClose,
  viewportClassName,
  className,
  children,
  ...props
}: LocalSlashPanelProps) {
  return (
    <Card
      data-slot="local-slash-panel"
      className={cn(
        'absolute bottom-full left-0 right-0 z-50 mb-3 overflow-hidden rounded-2xl bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]',
        className,
      )}
      {...props}
    >
      <CardHeader className="flex-row items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="mt-1">{subtitle}</CardDescription>
        </div>
        <IconButton
          label={closeLabel}
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={onClose}
        >
          <X aria-hidden className="size-[18px]" />
        </IconButton>
      </CardHeader>
      <ScrollArea className={cn('max-h-[min(620px,72vh)]', viewportClassName)}>
        <CardContent className="px-5 py-4">{children}</CardContent>
      </ScrollArea>
    </Card>
  )
}

type LocalSlashInspectorPanelProps<T extends string> = {
  title: string
  tabs: Array<{ id: T; label: string }>
  value: T
  closeLabel: string
  onValueChange: (value: T) => void
  onClose: () => void
  children: React.ReactNode
}

function LocalSlashInspectorPanel<T extends string>({
  title,
  tabs,
  value,
  closeLabel,
  onValueChange,
  onClose,
  children,
}: LocalSlashInspectorPanelProps<T>) {
  return (
    <Card
      data-slot="local-slash-inspector-panel"
      className="absolute bottom-full left-0 right-0 z-50 mb-4 overflow-hidden rounded-[10px] border-[var(--color-inspector-border)] bg-[var(--color-inspector-surface)] text-[var(--color-inspector-text)] shadow-[var(--shadow-inspector)]"
    >
      <Tabs
        value={value}
        onValueChange={(nextValue) => onValueChange(nextValue as T)}
        className="block"
      >
        <div className="grid min-h-[64px] grid-cols-[1fr_auto_1fr] items-center border-b border-[var(--color-inspector-border)] bg-[var(--color-inspector-surface)] px-6">
          <div className="font-mono text-[16px] font-semibold uppercase text-[var(--color-inspector-accent)]">
            {title}
          </div>
          <TabsList className="gap-8" aria-label={title}>
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="relative h-10 rounded-none px-0 font-sans text-[var(--color-inspector-muted-strong)] hover:bg-transparent hover:text-[var(--color-inspector-accent)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--color-inspector-accent)] after:absolute after:bottom-1 after:left-0 after:right-0 after:h-[2px] after:bg-transparent data-[state=active]:after:bg-[var(--color-inspector-accent)]"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex justify-end">
            <IconButton
              label={closeLabel}
              variant="ghost"
              size="icon-lg"
              className="text-[var(--color-inspector-accent)] hover:bg-transparent hover:text-[var(--color-inspector-accent-hover)]"
              onClick={onClose}
            >
              <X aria-hidden className="size-6" />
            </IconButton>
          </div>
        </div>
        <ScrollArea className="max-h-[min(540px,58vh)]">
          <div className="bg-[var(--color-inspector-surface)] px-6 py-6">{children}</div>
        </ScrollArea>
      </Tabs>
    </Card>
  )
}

export { LocalSlashPanel, LocalSlashInspectorPanel }
