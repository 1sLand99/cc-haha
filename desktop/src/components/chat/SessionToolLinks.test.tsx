import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ToolCallBlock } from './ToolCallBlock'
import { SessionToolLinks, sessionToolTargets, SESSION_TOOL_NAMES } from './SessionToolLinks'
const openTab = vi.fn()
vi.mock('@/stores/tabStore', () => ({ useTabStore: { getState: () => ({ openTab }) } }))
it('opens session sources returned inside a tool text block', () => {
  render(<SessionToolLinks input={{}} result={[{ type: 'text', text: '{"sessionId":"created"}' }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open session created' }))
  expect(openTab).toHaveBeenCalledWith('created', 'created')
})
it('handles protocol targets without scraping arbitrary content', () => {
  expect(sessionToolTargets({ targetSessionId: 'target' }, { members: [{ sessionId: 'target' }, { sessionId: 'child' }], content: 'sessionId=not-a-reference' })).toEqual(['target', 'child'])
})

it.each([...SESSION_TOOL_NAMES])('renders navigation in the existing %s tool card', toolName => {
  render(<ToolCallBlock toolName={toolName} input={{ sessionId: 'source' }} result={{ content: [{ type: 'text', text: '{"sessionId":"child"}' }], isError: false }} />)
  expect(screen.getByRole('button', { name: 'Open session source' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Open session child' })).toBeDefined()
})
