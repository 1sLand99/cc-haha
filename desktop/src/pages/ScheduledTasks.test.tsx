import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ScheduledTasks } from './ScheduledTasks'
import { useAdapterStore } from '../stores/adapterStore'
import { useProviderStore } from '../stores/providerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTaskStore } from '../stores/taskStore'
import { useUIStore } from '../stores/uiStore'

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useProviderStore.setState({
    providers: [],
    activeId: null,
    hasLoadedProviders: true,
    isLoading: false,
  })
  useAdapterStore.setState({
    fetchConfig: vi.fn(async () => {}),
    config: {},
  } as Partial<ReturnType<typeof useAdapterStore.getState>>)
  useUIStore.setState({ activeModal: null })
})

afterEach(() => {
  cleanup()
  useAdapterStore.setState(useAdapterStore.getInitialState(), true)
  useProviderStore.setState(useProviderStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTaskStore.setState(useTaskStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
})

describe('ScheduledTasks', () => {
  it('shows shadcn loading skeletons until the first task request settles', async () => {
    let resolveFetch: () => void = () => {}
    const fetchRequest = new Promise<void>((resolve) => {
      resolveFetch = resolve
    })
    useTaskStore.setState({
      tasks: [],
      isLoading: true,
      error: null,
      fetchTasks: vi.fn(() => fetchRequest),
    } as Partial<ReturnType<typeof useTaskStore.getState>>)

    const { container } = render(<ScheduledTasks />)
    expect(screen.getByLabelText('Loading...')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)

    await act(async () => {
      resolveFetch()
      await fetchRequest
    })
    expect(await screen.findByText('No scheduled tasks yet.')).toBeInTheDocument()
  })

  it('renders a visible task fetch error and retries it', async () => {
    const fetchTasks = vi.fn(async () => {})
    useTaskStore.setState({
      tasks: [],
      isLoading: false,
      error: 'task service offline',
      fetchTasks,
    } as Partial<ReturnType<typeof useTaskStore.getState>>)

    render(<ScheduledTasks />)
    expect(await screen.findByText('task service offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(fetchTasks).toHaveBeenCalledTimes(2)
  })

  it('opens the shadcn creation dialog from the empty state and restores focus on Escape', async () => {
    useTaskStore.setState({
      tasks: [],
      isLoading: false,
      error: null,
      fetchTasks: vi.fn(async () => {}),
    } as Partial<ReturnType<typeof useTaskStore.getState>>)

    render(<ScheduledTasks />)
    await screen.findByText('No scheduled tasks yet.')
    const createButton = screen.getAllByRole('button', { name: 'New task' })[1]!
    fireEvent.click(createButton)
    const dialog = await screen.findByRole('dialog', { name: 'New scheduled task' })

    expect(screen.getByLabelText(/^Name/)).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(createButton).toHaveFocus())
  })
})
