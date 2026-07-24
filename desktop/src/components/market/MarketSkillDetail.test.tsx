import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({
    content,
    blockExternalResources,
  }: {
    content: string
    blockExternalResources?: boolean
  }) => (
    <div
      data-testid="markdown-renderer"
      data-content={content}
      data-block-external={String(Boolean(blockExternalResources))}
    />
  ),
}))

import { useMarketStore } from '../../stores/marketStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { NormalizedSkillDetail } from '../../types/market'
import { MarketSkillDetail } from './MarketSkillDetail'

function makeDetail(overrides: Partial<NormalizedSkillDetail> = {}): NormalizedSkillDetail {
  return {
    id: 'clawhub:demo',
    source: 'clawhub',
    slug: 'demo',
    name: 'Demo Skill',
    summary: 'A demo skill',
    author: { handle: 'alice', displayName: 'Alice' },
    stats: { downloads: 100, stars: 5 },
    tags: ['workflow'],
    version: '1.0.0',
    securityStatus: 'benign',
    installState: 'installable',
    description: '# Demo',
    files: [{ path: 'SKILL.md', size: 10, language: 'markdown', tooBig: false }],
    totalSize: 10,
    requiresApiKey: true,
    ...overrides,
  }
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useMarketStore.setState({
    selectedId: 'clawhub:demo',
    detail: null,
    isDetailLoading: false,
    detailError: null,
    installingIds: new Set(),
    installError: null,
    detailCache: new Map(),
    fileCache: new Map(),
  })
})

describe('MarketSkillDetail', () => {
  it('uses shadcn loading and error surfaces', () => {
    useMarketStore.setState({ isDetailLoading: true })
    const { rerender } = render(
      <MarketSkillDetail onRequestInstall={vi.fn()} onRequestUninstall={vi.fn()} />,
    )

    expect(screen.getByTestId('market-detail-loading')).toHaveTextContent('Back to market')
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Back to market' })).toHaveAttribute('data-slot', 'button')
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()

    act(() => {
      useMarketStore.setState({ isDetailLoading: false, detailError: 'upstream failed' })
    })
    rerender(<MarketSkillDetail onRequestInstall={vi.fn()} onRequestUninstall={vi.fn()} />)

    expect(screen.getByTestId('market-detail-error')).toHaveAttribute('data-slot', 'alert')
    expect(screen.getByText('upstream failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('data-slot', 'button')
  })

  it('renders shadcn actions, accessible API-key metadata and protected market markdown', () => {
    const onInstall = vi.fn()
    useMarketStore.setState({ detail: makeDetail() })
    render(<MarketSkillDetail onRequestInstall={onInstall} onRequestUninstall={vi.fn()} />)

    const installButton = screen.getByTestId('market-install-button')
    expect(installButton).toHaveAttribute('data-slot', 'button')
    expect(installButton).toHaveAttribute('data-market-skill-action-id', 'clawhub:demo')
    fireEvent.click(installButton)
    expect(onInstall).toHaveBeenCalledWith('clawhub:demo')
    expect(screen.getByRole('img', { name: 'Requires API key' })).toBeInTheDocument()
    expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-block-external', 'true')
  })

  it('renders uninstall as a shadcn loading button for installed skills', () => {
    const onUninstall = vi.fn()
    useMarketStore.setState({
      detail: makeDetail({
        installState: 'installed',
        installedInfo: { dirName: 'demo' },
      }),
    })
    render(<MarketSkillDetail onRequestInstall={vi.fn()} onRequestUninstall={onUninstall} />)

    const uninstallButton = screen.getByTestId('market-uninstall-button')
    expect(uninstallButton).toHaveAttribute('data-slot', 'button')
    fireEvent.click(uninstallButton)
    expect(onUninstall).toHaveBeenCalledWith('clawhub:demo')
  })
})
