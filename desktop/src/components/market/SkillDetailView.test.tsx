import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({
    content,
    variant,
    blockExternalResources,
  }: {
    content: string
    variant?: string
    blockExternalResources?: boolean
  }) => (
    <div
      data-testid="markdown-renderer"
      data-content={content}
      data-variant={variant}
      data-block-external={String(Boolean(blockExternalResources))}
    />
  ),
}))

vi.mock('../chat/CodeViewer', () => ({
  CodeViewer: ({ code, showLineNumbers }: { code: string; showLineNumbers?: boolean }) => (
    <div data-testid="code-viewer" data-line-numbers={String(showLineNumbers)}>{code}</div>
  ),
}))

import { SkillDetailView } from './SkillDetailView'
import { useSettingsStore } from '../../stores/settingsStore'
import type { PreviewFileContent } from './FilePreview'

const FILES = [
  { path: 'SKILL.md', size: 100, language: 'markdown' },
  { path: 'scripts/run.py', size: 200, language: 'python' },
]

function loadFileFromMemory(path: string): Promise<PreviewFileContent> {
  if (path === 'SKILL.md') {
    return Promise.resolve({ path, content: '# Overview doc', language: 'markdown', size: 100, truncated: false })
  }
  return Promise.resolve({ path, content: 'print("hi")', language: 'python', size: 200, truncated: true })
}

function renderView(overrides: Partial<Parameters<typeof SkillDetailView>[0]> = {}) {
  return render(
    <SkillDetailView
      name="Demo Skill"
      version="1.0.0"
      sourceLabel="ClawHub"
      summary="A demo"
      securityStatus="benign"
      installState="installable"
      meta={[{ label: 'Author', value: 'Alice' }]}
      description="# Body"
      files={FILES}
      loadFile={loadFileFromMemory}
      onBack={vi.fn()}
      backLabel="Back"
      {...overrides}
    />,
  )
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
})

describe('SkillDetailView', () => {
  it('renders the decision header with badges and the overview markdown', () => {
    renderView()

    const heading = screen.getByRole('heading', { name: 'Demo Skill', level: 1 })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveFocus()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByTestId('security-badge-benign')).toBeInTheDocument()
    expect(screen.getByTestId('install-badge-installable')).toBeInTheDocument()
    const markdown = screen.getByTestId('markdown-renderer')
    expect(markdown).toHaveAttribute('data-content', '# Body')
    expect(markdown).toHaveAttribute('data-variant', 'document')
  })

  it('uses shadcn tabs with arrow-key navigation', async () => {
    renderView()

    const overviewTab = screen.getByTestId('skill-detail-tab-overview')
    const filesTab = screen.getByTestId('skill-detail-tab-files')
    expect(overviewTab).toHaveAttribute('data-slot', 'tabs-trigger')
    act(() => {
      overviewTab.focus()
      fireEvent.keyDown(overviewTab, { key: 'ArrowRight' })
    })

    await waitFor(() => expect(filesTab).toHaveFocus())
    expect(filesTab).toHaveAttribute('data-state', 'active')
    expect(screen.getByTestId('market-file-preview')).toBeInTheDocument()
  })

  it('shows the not-installable reason prominently', () => {
    renderView({ installState: 'not-installable', notInstallableReason: 'name-conflict' })

    expect(screen.getByTestId('market-not-installable-reason')).toHaveTextContent(
      'A local skill with the same name already exists',
    )
  })

  it('lists security reports with links', () => {
    renderView({
      securityReports: [
        { vendor: 'keen', status: 'benign', statusText: 'Safe', reportUrl: 'https://example.com/report' },
      ],
    })

    expect(screen.getByTestId('market-security-reports')).toHaveTextContent('keen')
    expect(screen.getByRole('link', { name: 'View report' })).toHaveAttribute('href', 'https://example.com/report')
  })

  it('switches to the files tab and previews code with line numbers and truncation notice', async () => {
    renderView()

    fireEvent.click(screen.getByTestId('skill-detail-tab-files'))
    expect(await screen.findByTestId('market-file-preview')).toBeInTheDocument()
    // SKILL.md is auto-selected → markdown preview
    expect(await screen.findAllByTestId('markdown-renderer')).toBeTruthy()

    fireEvent.click(screen.getByTestId('market-file-item-scripts/run.py'))
    const code = await screen.findByTestId('code-viewer')
    expect(code).toHaveTextContent('print("hi")')
    expect(code).toHaveAttribute('data-line-numbers', 'true')
    expect(screen.getByText(/Preview truncated/)).toBeInTheDocument()
  })

  it('uses a single-selection toggle group for files and blocks market external resources', async () => {
    renderView({ blockExternalResources: true })

    expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-block-external', 'true')
    fireEvent.click(screen.getByTestId('skill-detail-tab-files'))

    const firstFile = await screen.findByTestId('market-file-item-SKILL.md')
    const secondFile = screen.getByTestId('market-file-item-scripts/run.py')
    expect(firstFile).toHaveAttribute('data-slot', 'toggle-group-item')
    expect(firstFile.closest('[data-slot="toggle-group"]')).toHaveAttribute('data-orientation', 'vertical')

    act(() => {
      firstFile.focus()
      fireEvent.keyDown(firstFile, { key: 'ArrowDown' })
    })
    await waitFor(() => expect(secondFile).toHaveFocus())
    expect(screen.getAllByTestId('markdown-renderer').at(-1)).toHaveAttribute('data-block-external', 'true')
  })

  it('shows a file load error with retry', async () => {
    const failingLoad = vi.fn().mockRejectedValue(new Error('fetch failed'))
    renderView({ loadFile: failingLoad })

    fireEvent.click(screen.getByTestId('skill-detail-tab-files'))
    expect(await screen.findByTestId('market-file-error')).toHaveTextContent('Failed to load this file')
    expect(screen.getByText('fetch failed')).toBeInTheDocument()
  })

  it('renders custom actions in the decision area', () => {
    renderView({ actions: <button type="button">Install now</button> })

    const decisionSidebar = screen.getByTestId('skill-detail-sidebar')
    expect(within(decisionSidebar).getByText('Install now')).toBeInTheDocument()
    expect(within(decisionSidebar).getByText('Author')).toBeInTheDocument()
    expect(within(decisionSidebar).getByText('Alice')).toBeInTheDocument()
  })
})
