import type { ReactElement } from 'react'
import { render as testingLibraryRender, type RenderOptions } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Test render wrapper that mirrors @testing-library/react's render while
 * supplying the root-level TooltipProvider removed from individual IconButton
 * instances. Keeps component tests from needing to wrap every render call.
 */
export function render(ui: ReactElement, options?: RenderOptions) {
  return testingLibraryRender(ui, {
    ...options,
    wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider>,
  })
}
