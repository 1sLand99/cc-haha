// Re-export everything from @testing-library/react, overriding render with the
// test wrapper that supplies the root TooltipProvider.
export * from '@testing-library/react'
export { render } from './render'
