import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../components/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}))

import { useMarketStore } from '../stores/marketStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSkillStore } from '../stores/skillStore'
import type { NormalizedSkill, NormalizedSkillDetail } from '../types/market'
import type { SkillDetail as LocalSkillDetail } from '../types/skill'
import { Market } from './Market'

function makeSkill(overrides: Partial<NormalizedSkill> = {}): NormalizedSkill {
  return {
    id: 'clawhub:demo',
    source: 'clawhub',
    slug: 'Demo',
    name: 'Demo Skill',
    summary: 'A demo skill',
    author: { handle: 'alice', displayName: 'Alice' },
    stats: { downloads: 100 },
    tags: [],
    version: '1.0.0',
    securityStatus: 'benign',
    installState: 'installable',
    ...overrides,
  }
}

function makeDetail(overrides: Partial<NormalizedSkillDetail> = {}): NormalizedSkillDetail {
  return {
    ...makeSkill(),
    description: '# Demo',
    files: [],
    totalSize: 0,
    ...overrides,
  }
}

function makeLocalSkillDetail(overrides: Partial<LocalSkillDetail> = {}): LocalSkillDetail {
  return {
    meta: {
      name: 'local-demo',
      displayName: 'Local Demo',
      description: 'An installed skill',
      source: 'project',
      userInvocable: true,
      contentLength: 12,
      hasDirectory: true,
    },
    tree: [],
    files: [],
    skillRoot: '/tmp/local-demo',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ locale: 'en' })
  useSkillStore.setState({
    selectedSkill: null,
    selectedSkillContext: null,
    isDetailLoading: false,
  })
  const detail = makeDetail()
  useMarketStore.setState({
    items: [makeSkill()],
    nextCursor: null,
    sources: { clawhub: { status: 'ok' } },
    query: '',
    filters: { source: 'all', security: 'all', installed: 'all' },
    isLoading: false,
    isLoadingMore: false,
    error: null,
    selectedId: null,
    detail: null,
    isDetailLoading: false,
    detailError: null,
    detailCache: new Map([[detail.id, detail]]),
    fileCache: new Map(),
    installingIds: new Set(),
    installError: null,
  })
})

describe('Market', () => {
  it('restores focus to the originating card after returning from detail', async () => {
    render(<Market />)

    fireEvent.click(screen.getByRole('button', { name: 'Demo Skill' }))
    expect(await screen.findByRole('heading', { name: 'Demo Skill', level: 1 })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Back to market' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Demo Skill' })).toHaveFocus())
  })

  it('uses shadcn confirmation dialogs and shows a profile-neutral skill path', async () => {
    render(<Market />)

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(screen.getByRole('alertdialog', { name: 'Install skill' })).toHaveAttribute(
      'data-slot',
      'alert-dialog-content',
    )
    expect(screen.getByText('…/skills/demo/')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install' })).toHaveFocus())

    const installed = makeSkill({
      installState: 'installed',
      installedInfo: { dirName: 'demo' },
    })
    const installedDetail = makeDetail({
      installState: 'installed',
      installedInfo: { dirName: 'demo' },
    })
    act(() => {
      useMarketStore.setState({
        items: [installed],
        detailCache: new Map([[installedDetail.id, installedDetail]]),
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Demo Skill' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall' }))
    expect(screen.getByRole('alertdialog', { name: 'Uninstall skill' })).toHaveTextContent(
      '…/skills/demo/',
    )
  })

  it('opens the installed skill detail selected from the overview and returns to the market home', async () => {
    render(<Market />)

    act(() => {
      useSkillStore.setState({
        selectedSkill: makeLocalSkillDetail(),
        selectedSkillReturnTab: 'skills',
        selectedSkillContext: '',
      })
    })

    expect(await screen.findByTestId('skill-detail-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Local Demo', level: 1 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    await waitFor(() => expect(screen.queryByTestId('skill-detail-view')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Demo Skill' })).toBeInTheDocument()
  })

  it('keeps the market detail view authoritative when a market skill is selected', async () => {
    render(<Market />)

    fireEvent.click(screen.getByRole('button', { name: 'Demo Skill' }))
    expect(await screen.findByRole('heading', { name: 'Demo Skill', level: 1 })).toBeInTheDocument()

    act(() => {
      useSkillStore.setState({
        selectedSkill: makeLocalSkillDetail(),
        selectedSkillReturnTab: 'skills',
        selectedSkillContext: '',
      })
    })

    expect(screen.queryByRole('heading', { name: 'Local Demo' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Demo Skill', level: 1 })).toBeInTheDocument()
  })
})
