import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

const uninstallMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/market', () => ({
  marketApi: {
    uninstall: uninstallMock,
  },
}))

vi.mock('../markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({
    content,
    variant,
    className,
  }: {
    content: string
    variant?: string
    className?: string
  }) => (
    <div
      data-testid="markdown-renderer"
      data-content={content}
      data-variant={variant}
      data-classname={className}
    />
  ),
}))

vi.mock('../chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <div data-testid="code-viewer">{code}</div>,
}))

import { SkillDetail } from './SkillDetail'
import { useSkillStore } from '../../stores/skillStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SkillDetail as SkillDetailType } from '../../types/skill'

const fetchSkills = vi.fn()
const fetchSkillDetail = vi.fn()
const clearSelection = vi.fn(() => {
  useSkillStore.setState({ selectedSkill: null, selectedSkillContext: null })
})

function makeInstalledSkill(source: 'user' | 'project' = 'user'): SkillDetailType {
  return {
    meta: {
      name: 'skill-test',
      displayName: 'Skill Test',
      description: 'Skill description',
      source,
      userInvocable: true,
      contentLength: 120,
      hasDirectory: true,
    },
    tree: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }],
    files: [
      {
        path: 'SKILL.md',
        content: '# Skill Body',
        language: 'markdown',
        isEntry: true,
      },
    ],
    skillRoot: '/tmp/skill-test',
    marketMeta: {
      id: 'clawhub:skill-test',
      source: 'clawhub',
      slug: 'skill-test',
      installedAt: new Date(0).toISOString(),
      fileCount: 1,
    },
  }
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useSkillStore.setState({
    skills: [],
    skillsContext: '/workspace/project',
    selectedSkill: null,
    selectedSkillContext: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    fetchSkills,
    fetchSkillDetail,
    clearSelection,
  })
  fetchSkills.mockReset()
  fetchSkills.mockResolvedValue(undefined)
  fetchSkillDetail.mockReset()
  clearSelection.mockClear()
  uninstallMock.mockReset()
})

describe('SkillDetail markdown presentation', () => {
  it('renders markdown files with the document variant and readable width', () => {
    useSkillStore.setState({
      selectedSkill: {
        meta: {
          name: 'skill-test',
          displayName: 'Skill Test',
          description: 'Skill description',
          source: 'user',
          userInvocable: true,
          contentLength: 120,
          hasDirectory: true,
        },
        tree: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }],
        files: [
          {
            path: 'SKILL.md',
            content: '# Skill Body',
            language: 'markdown',
            isEntry: true,
          },
        ],
        skillRoot: '/tmp/skill-test',
      },
    })

    render(<SkillDetail />)

    const markdown = screen.getByTestId('markdown-renderer')
    expect(markdown).toBeInTheDocument()
    expect(markdown).toHaveAttribute('data-variant', 'document')
    expect(markdown).toHaveAttribute('data-classname', 'mx-auto max-w-[72ch]')
    expect(markdown).toHaveAttribute('data-content', '# Skill Body')
  })
})

describe('SkillDetail market uninstall', () => {
  it('uses shadcn AlertDialog and restores focus after cancel', async () => {
    useSkillStore.setState({
      selectedSkill: makeInstalledSkill(),
      selectedSkillContext: '/workspace/project',
    })

    render(<SkillDetail />)

    const trigger = screen.getByTestId('local-skill-uninstall-button')
    expect(trigger).toHaveAttribute('data-slot', 'button')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('data-slot', 'alert-dialog-content')
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
    fireEvent.click(cancel)
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('uninstalls once, refreshes the captured project cwd, and clears detail', async () => {
    uninstallMock.mockResolvedValue({ ok: true })
    useSkillStore.setState({
      selectedSkill: makeInstalledSkill(),
      selectedSkillContext: '/workspace/project',
    })

    render(<SkillDetail />)
    fireEvent.click(screen.getByTestId('local-skill-uninstall-button'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Uninstall' }))

    await waitFor(() => {
      expect(uninstallMock).toHaveBeenCalledTimes(1)
      expect(uninstallMock).toHaveBeenCalledWith('clawhub:skill-test')
      expect(fetchSkills).toHaveBeenCalledWith('/workspace/project')
      expect(clearSelection).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps the confirmation open and exposes an inline error when uninstall fails', async () => {
    uninstallMock.mockRejectedValue(new Error('Deletion was refused'))
    useSkillStore.setState({
      selectedSkill: makeInstalledSkill(),
      selectedSkillContext: '/workspace/project',
    })

    render(<SkillDetail />)
    fireEvent.click(screen.getByTestId('local-skill-uninstall-button'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Uninstall' }))

    expect(await screen.findByTestId('local-skill-uninstall-error')).toHaveTextContent(
      'Deletion was refused',
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(clearSelection).not.toHaveBeenCalled()
  })

  it('does not offer market uninstall for project skills even if a marker is present', () => {
    useSkillStore.setState({
      selectedSkill: makeInstalledSkill('project'),
      selectedSkillContext: '/workspace/project',
    })

    render(<SkillDetail />)

    expect(screen.queryByTestId('local-skill-uninstall-button')).not.toBeInTheDocument()
  })
})
