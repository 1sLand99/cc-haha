import * as React from 'react'
import { LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  disableWhileLoading?: boolean
  loading?: boolean
}

const LoadingButton = React.forwardRef<HTMLButtonElement, LoadingButtonProps>(
  function LoadingButton({
    disableWhileLoading = true,
    loading = false,
    disabled,
    children,
    ...props
  }, ref) {
    return (
      <Button
        ref={ref}
        aria-busy={loading || undefined}
        disabled={disabled || (loading && disableWhileLoading)}
        {...props}
      >
        {loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {children}
      </Button>
    )
  },
)
LoadingButton.displayName = 'LoadingButton'

export { LoadingButton }
