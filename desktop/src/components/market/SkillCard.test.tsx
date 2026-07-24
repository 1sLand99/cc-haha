import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { SkillCard } from './SkillCard'
import { useSettingsStore } from '../../stores/settingsStore'
import type { NormalizedSkill } from '../../types/market'

function makeSkill(overrides: Partial<NormalizedSkill> = {}): NormalizedSkill {
  return {
    id: 'clawhub:demo',
    source: 'clawhub',
    slug: 'demo',
    name: 'Demo Skill',
    summary: 'Does demo things',
    author: { handle: 'alice', displayName: 'Alice' },
    stats: { downloads: 12_345, stars: 42 },
    tags: ['git', 'workflow', 'automation', 'extra-tag'],
    version: '1.2.0',
    securityStatus: 'benign',
    installState: 'installable',
    ...overrides,
  }
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
})

describe('SkillCard', () => {
  it('renders name, summary, source, author, stats and badges', () => {
    render(<SkillCard skill={makeSkill()} onOpen={vi.fn()} />)

    expect(screen.getByText('Demo Skill')).toBeInTheDocument()
    expect(screen.getByText('Does demo things')).toBeInTheDocument()
    expect(screen.getByText('ClawHub')).toBeInTheDocument()
    expect(screen.getByText('by Alice')).toBeInTheDocument()
    expect(screen.getByText('12.3k')).toBeInTheDocument()
    expect(screen.getByTestId('security-badge-benign')).toBeInTheDocument()
    expect(screen.getByTestId('install-badge-installable')).toBeInTheDocument()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
    // 4 tags → 3 shown + "+1"
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('shows the installed badge and hides the quick-install button when installed', () => {
    render(<SkillCard skill={makeSkill({ installState: 'installed' })} onOpen={vi.fn()} onInstall={vi.fn()} />)

    expect(screen.getByTestId('install-badge-installed')).toBeInTheDocument()
    expect(screen.queryByText('Install')).not.toBeInTheDocument()
  })

  it('shows the not-installable badge', () => {
    render(<SkillCard skill={makeSkill({ installState: 'not-installable' })} onOpen={vi.fn()} />)

    expect(screen.getByTestId('install-badge-not-installable')).toBeInTheDocument()
  })

  it('opens the detail on click and installs via the quick action without opening', () => {
    const onOpen = vi.fn()
    const onInstall = vi.fn()
    render(<SkillCard skill={makeSkill()} onOpen={onOpen} onInstall={onInstall} />)

    fireEvent.click(screen.getByText('Install'))
    expect(onInstall).toHaveBeenCalledWith('clawhub:demo')
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Demo Skill' }))
    expect(onOpen).toHaveBeenCalledWith('clawhub:demo')
  })

  it('uses separate semantic actions for opening and installing', () => {
    render(<SkillCard skill={makeSkill()} onOpen={vi.fn()} onInstall={vi.fn()} />)

    const card = screen.getByRole('article')
    const openButton = screen.getByRole('button', { name: 'Demo Skill' })
    const installButton = screen.getByRole('button', { name: 'Install' })

    expect(card).toContainElement(openButton)
    expect(card).toContainElement(installButton)
    expect(openButton).not.toContainElement(installButton)
  })

  it('disables the quick-install button while installing', () => {
    render(<SkillCard skill={makeSkill()} onOpen={vi.fn()} onInstall={vi.fn()} installing />)

    expect(screen.getByText('Installing…').closest('button')).toBeDisabled()
  })

  it('flags risky skills visibly', () => {
    render(<SkillCard skill={makeSkill({ securityStatus: 'flagged' })} onOpen={vi.fn()} />)

    expect(screen.getByTestId('security-badge-flagged')).toBeInTheDocument()
    expect(screen.getByText('Flagged')).toBeInTheDocument()
  })

  it('hides the redundant installable badge when the quick-install button is shown', () => {
    render(<SkillCard skill={makeSkill()} onOpen={vi.fn()} onInstall={vi.fn()} />)

    expect(screen.getByText('Install')).toBeInTheDocument()
    expect(screen.queryByTestId('install-badge-installable')).not.toBeInTheDocument()
  })

  it('renders a deterministic letter avatar when iconUrl is missing', () => {
    render(<SkillCard skill={makeSkill()} onOpen={vi.fn()} />)

    const avatar = screen.getByTestId('skill-avatar-fallback')
    expect(avatar).toHaveTextContent('D')
    const background = avatar.style.background

    // Same name → same identity color on re-render.
    render(<SkillCard skill={makeSkill({ id: 'clawhub:demo-2' })} onOpen={vi.fn()} />)
    const second = screen.getAllByTestId('skill-avatar-fallback')[1]!
    expect(second.style.background).toBe(background)
  })

  it('renders the shadcn avatar image when iconUrl loads', async () => {
    const imageSpy = vi.spyOn(window, 'Image').mockImplementation(() => {
      const image = document.createElement('img')
      Object.defineProperty(image, 'complete', { configurable: true, value: true })
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 48 })
      return image as HTMLImageElement
    })
    const { container } = render(
      <SkillCard skill={makeSkill({ iconUrl: 'https://example.com/icon.png' })} onOpen={vi.fn()} />,
    )

    const img = await waitFor(() => {
      const element = container.querySelector('img')
      expect(element).not.toBeNull()
      return element
    })
    expect(img).toHaveAttribute('src', 'https://example.com/icon.png')
    expect(img).toHaveAttribute('data-slot', 'avatar-image')
    expect(screen.queryByTestId('skill-avatar-fallback')).not.toBeInTheDocument()
    imageSpy.mockRestore()
  })

  it('explains the security status via a keyboard-accessible tooltip', async () => {
    render(<SkillCard skill={makeSkill({ securityStatus: 'unknown' })} onOpen={vi.fn()} />)

    const badge = screen.getByTestId('security-badge-unknown')
    expect(badge).toHaveAttribute(
      'aria-label',
      'Not audited. No security audit data from the source — review the files before installing.',
    )
    fireEvent.focus(badge)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'No security audit data from the source — review the files before installing.',
    )
  })
})
