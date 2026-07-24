import * as React from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

type StartupSurfaceProps = Omit<React.ComponentProps<'main'>, 'title'> & {
  actions?: React.ReactNode
  description?: React.ReactNode
  headingRef?: React.Ref<HTMLHeadingElement>
  icon?: React.ReactNode
  panelClassName?: string
  title: React.ReactNode
}

function StartupSurface({
  actions,
  children,
  className,
  description,
  headingRef,
  icon,
  panelClassName,
  title,
  ...props
}: StartupSurfaceProps) {
  const titleId = React.useId()

  return (
    <main
      data-custom-slot="startup-surface"
      className={cn(
        'app-shell-viewport flex items-center justify-center bg-[var(--color-surface)] px-6 py-8 text-[var(--color-text-primary)]',
        className,
      )}
      {...props}
    >
      <Card
        aria-labelledby={titleId}
        className={cn('w-full max-w-md shadow-[var(--shadow-md)]', panelClassName)}
      >
        <CardHeader className="gap-3 p-6 pb-4">
          <div className="flex items-start gap-3">
            {icon ? (
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
                {icon}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <h1
                ref={headingRef}
                id={titleId}
                tabIndex={-1}
                className="text-lg font-semibold leading-tight outline-none"
              >
                {title}
              </h1>
              {description ? (
                <CardDescription className="mt-2 leading-5">
                  {description}
                </CardDescription>
              ) : null}
            </div>
          </div>
        </CardHeader>
        {children ? <CardContent className="space-y-4 px-6 pb-6 pt-0">{children}</CardContent> : null}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 px-6 pb-6">
            {actions}
          </div>
        ) : null}
      </Card>
    </main>
  )
}

export { StartupSurface }
