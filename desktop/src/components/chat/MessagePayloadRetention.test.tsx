import '@testing-library/jest-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttachmentGallery } from '@/components/chat/AttachmentGallery'
import { MessageActionBar } from '@/components/chat/MessageActionBar'
import { ToolCallBlock } from '@/components/chat/ToolCallBlock'
import { copyTextToClipboard } from '@/lib/clipboard'
import { boundChatHistory } from '@/lib/chatHistoryBudget'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/lib/clipboard', () => ({ copyTextToClipboard: vi.fn(async () => true) }))

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('complete retained message payloads', () => {
  it('renders a real PNG and later attachments after applying the history budget', () => {
    const data = 'data:image/png;base64,' + readFileSync(resolve('src/assets/agent-mascots/agent-mascot-build.png')).toString('base64')
    expect(data.length).toBeGreaterThan(32 * 1024)
    const message = boundChatHistory([{
      id: 'image', type: 'user_text', content: 'inspect', timestamp: 1,
      attachments: [
        { type: 'image', name: 'Screenshot.png', data },
        { type: 'file', name: 'notes.md', path: '/tmp/notes.md' },
      ],
    }]).messages[0]!
    if (message.type !== 'user_text') throw new Error('Expected user message')
    render(<AttachmentGallery attachments={message.attachments!} />)
    expect(screen.getByRole('img', { name: 'Screenshot.png' })).toHaveAttribute('src', data)
    expect(screen.getByText('notes.md')).toBeInTheDocument()
  })

  it('renders both sides of a large successful Edit after applying the history budget', async () => {
    const message = boundChatHistory([{
      id: 'edit', type: 'tool_use', toolName: 'Edit', toolUseId: 'edit', timestamp: 1,
      input: { file_path: '/tmp/example.ts', old_string: 'old line\n'.repeat(5000), new_string: 'fixed' },
    }]).messages[0]!
    if (message.type !== 'tool_use') throw new Error('Expected tool message')
    await act(async () => {
      render(<ToolCallBlock toolName="Edit" input={message.input} result={{ content: 'Successfully edited file', isError: false }} defaultExpanded />)
    })
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-5001')).toBeInTheDocument()
  })

  it('copies the entire retained reply including its beginning and end', async () => {
    const content = 'HEAD_SENTINEL' + 'm'.repeat(70_000) + 'TAIL_SENTINEL'
    const message = boundChatHistory([{ id: 'reply', type: 'assistant_text', content, timestamp: 1 }]).messages[0]!
    if (message.type !== 'assistant_text') throw new Error('Expected assistant message')
    render(<MessageActionBar copyText={message.content} copyLabel="Copy reply" alwaysVisible />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy reply' }))
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith(content))
  })
})
