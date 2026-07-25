import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { useSettingsStore } from '../../stores/settingsStore'
import { useMarketStore } from '../../stores/marketStore'
import type { NormalizedSkill } from '../../types/market'
import { MarketHome } from './MarketHome'

function makeSkill(overrides: Partial<NormalizedSkill> = {}): NormalizedSkill {
  return {
    id: 'clawhub:demo',
    source: 'clawhub',
    slug: 'demo',
    name: 'Demo Skill',
    summary: 'A focused demo skill',
    author: { handle: 'alice', displayName: 'Alice' },
    stats: { downloads: 1_240, stars: 18 },
    tags: ['workflow'],
    version: '1.0.0',
    securityStatus: 'benign',
    installState: 'installable',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ locale: 'en' })
  useMarketStore.setState({
    items: [makeSkill()],
    nextCursor: null,
    sources: {
      clawhub: { status: 'ok' },
      skillhub: { status: 'cached', fetchedAt: 1_700_000_000_000 },
    },
    query: '',
    filters: { source: 'all', security: 'all', installed: 'all' },
    isLoading: false,
    isLoadingMore: false,
    error: null,
    installingIds: new Set(),
    fetchList: vi.fn().mockResolvedValue(undefined),
  })
})

describe('MarketHome', () => {
  it('renders the compact catalog header, command bar, sources and semantic cards', () => {
    render(<MarketHome onRequestInstall={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Skills Market' })).toBeInTheDocument()
    expect(screen.getByTestId('market-search-input')).toBeInTheDocument()
    expect(screen.getByTestId('market-search-input')).toHaveAttribute('data-slot', 'input')
    expect(screen.getByTestId('market-filter-bar')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Source' })).toHaveAttribute('data-slot', 'select-trigger')
    expect(screen.getByRole('article').querySelector('[data-slot="card"]')).toBeInTheDocument()
    expect(screen.getByTestId('market-source-status-clawhub')).toHaveTextContent('Online')
    expect(screen.getByTestId('market-source-status-clawhub')).toHaveAttribute('data-slot', 'badge')
    expect(screen.getByTestId('market-source-status-skillhub')).toHaveTextContent('Cached')
    expect(screen.getByTestId('market-grid')).toContainElement(screen.getByRole('article'))
    expect(screen.getByRole('button', { name: 'Demo Skill' })).toBeInTheDocument()
    expect(screen.getByText('1 skills')).toBeInTheDocument()
  })

  it('uses a catalog-shaped skeleton while the first page is loading', () => {
    useMarketStore.setState({ items: [], isLoading: true })

    render(<MarketHome onRequestInstall={vi.fn()} />)

    expect(screen.getByTestId('market-loading')).toHaveAttribute('aria-label', 'Loading skills…')
    expect(screen.getByTestId('market-loading')).toHaveAttribute('role', 'status')
    expect(screen.getAllByTestId('market-loading')[0]!.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.queryByTestId('market-grid')).not.toBeInTheDocument()
  })

  it('keeps search focus after clearing and uses accessible shadcn selects', async () => {
    useMarketStore.setState({ query: 'demo' })
    render(<MarketHome onRequestInstall={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(screen.getByTestId('market-search-input')).toHaveFocus())
    expect(useMarketStore.getState().query).toBe('')

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Source' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'SkillHub' }))
    expect(useMarketStore.getState().filters.source).toBe('skillhub')
  })

  it('exposes source failure details through a keyboard-accessible tooltip', async () => {
    useMarketStore.setState({
      sources: {
        clawhub: { status: 'failed', error: 'Fixture source is offline' },
      },
    })
    render(<MarketHome onRequestInstall={vi.fn()} />)

    const status = screen.getByTestId('market-source-status-clawhub')
    fireEvent.focus(status)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Fixture source is offline')
  })
})
