import type * as React from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LoadingButton } from '@/components/ui/custom/loading-button'
import { cn } from '@/lib/utils'

type UpdateReadyPromptProps = React.ComponentProps<typeof Card> & {
  body: string
  dismissLabel: string
  error?: string | null
  installLabel: string
  installing?: boolean
  onDismiss: () => void
  onInstall: () => void
  releaseNotes?: React.ReactNode
  title: string
}

function UpdateReadyPrompt({
  body,
  className,
  dismissLabel,
  error,
  installLabel,
  installing = false,
  onDismiss,
  onInstall,
  releaseNotes,
  title,
  ...props
}: UpdateReadyPromptProps) {
  return (
    <Card
      data-slot="update-ready-prompt"
      role="region"
      aria-labelledby="update-ready-prompt-title"
      aria-describedby="update-ready-prompt-body"
      className={cn('shadow-[var(--shadow-dropdown)]', className)}
      {...props}
    >
      <CardHeader className="gap-1 px-3 pb-0 pt-3">
        <h2
          id="update-ready-prompt-title"
          className="text-sm font-medium text-[var(--color-text-primary)]"
        >
          {title}
        </h2>
        <p
          id="update-ready-prompt-body"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-xs leading-5 text-[var(--color-text-secondary)]"
        >
          {body}
        </p>
      </CardHeader>

      {(releaseNotes || error) && (
        <CardContent className="space-y-2 px-3 pb-0 pt-2">
          {releaseNotes && (
            <ScrollArea
              aria-label={title}
              className="h-28 rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-surface)]/70"
            >
              <div className="px-3 py-2">
                {releaseNotes}
              </div>
            </ScrollArea>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-[var(--color-error)]">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      )}

      <CardFooter className="gap-2 px-3 pb-3 pt-3">
        <LoadingButton
          size="sm"
          loading={installing}
          onClick={onInstall}
        >
          {installLabel}
        </LoadingButton>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
        >
          {dismissLabel}
        </Button>
      </CardFooter>
    </Card>
  )
}

export { UpdateReadyPrompt }
