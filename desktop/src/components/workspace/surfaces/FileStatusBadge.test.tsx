import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceFileStatus } from '@/api/sessions'
import { useSettingsStore } from '@/stores/settingsStore'
import { FileStatusBadge } from './FileStatusBadge'

describe('FileStatusBadge', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it.each<[WorkspaceFileStatus, string, string]>([
    ['modified', 'M', 'Modified'],
    ['added', 'A', 'Added'],
    ['deleted', 'D', 'Deleted'],
    ['renamed', 'R', 'Renamed'],
    ['untracked', 'U', 'Untracked'],
    ['copied', 'C', 'Copied'],
    ['type_changed', 'T', 'Type changed'],
    ['unknown', '?', 'Unknown status'],
  ])('shows %s as "%s" and names it for screen readers', (status, label, name) => {
    render(<FileStatusBadge status={status} />)

    // The single letter is the git shorthand; the accessible name is the one a
    // screen reader can act on.
    expect(screen.getByLabelText(name)).toHaveTextContent(label)
  })

  it('colours each status from the semantic tokens', () => {
    const { container: modified } = render(<FileStatusBadge status="modified" />)
    const { container: added } = render(<FileStatusBadge status="added" />)
    const { container: deleted } = render(<FileStatusBadge status="deleted" />)

    expect(modified.firstElementChild?.className).toContain('text-[var(--color-warning)]')
    expect(added.firstElementChild?.className).toContain('text-[var(--color-success)]')
    expect(deleted.firstElementChild?.className).toContain('text-[var(--color-error)]')
  })

  it('translates the accessible name with the active locale', () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<FileStatusBadge status="modified" />)

    expect(screen.queryByLabelText('Modified')).not.toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()
  })
})
