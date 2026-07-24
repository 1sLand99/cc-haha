import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { NewTaskModal } from './NewTaskModal'
import { useAdapterStore } from '../../stores/adapterStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTaskStore } from '../../stores/taskStore'
import type { CronTask } from '../../types/task'

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useAdapterStore.setState({
    fetchConfig: vi.fn(async () => {}),
    config: {},
  } as Partial<ReturnType<typeof useAdapterStore.getState>>)
})

afterEach(() => {
  cleanup()
  useAdapterStore.setState(useAdapterStore.getInitialState(), true)
  useProviderStore.setState(useProviderStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTaskStore.setState(useTaskStore.getInitialState(), true)
})

describe('NewTaskModal', () => {
  it('composes the scheduled task form from shadcn controls with labelled required fields', async () => {
    render(<NewTaskModal open onClose={vi.fn()} />)

    expect(await screen.findByRole('dialog', { name: 'New scheduled task' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveFocus()
    expect(screen.getByLabelText(/^Name/)).toBeRequired()
    expect(screen.getByLabelText(/^Description/)).toBeRequired()
    expect(screen.getByLabelText(/^Prompt/)).toBeRequired()
    expect(screen.getByRole('combobox', { name: 'Frequency' })).toBeInTheDocument()
    expect(screen.getByLabelText('Time')).toHaveAttribute('type', 'time')
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="textarea"]')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="select-trigger"]')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="card"]').length).toBeGreaterThanOrEqual(3)
  })

  it('keeps invalid custom cron and notification channel errors visible', async () => {
    render(<NewTaskModal open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Custom cron expression' }))
    const cronInput = screen.getByLabelText('Custom cron expression')
    fireEvent.change(cronInput, { target: { value: 'not cron' } })

    expect(cronInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('Invalid cron expression').length).toBeGreaterThanOrEqual(1)

    fireEvent.click(screen.getByRole('checkbox', { name: /Push notification on completion/ }))
    expect(screen.getByRole('checkbox', { name: 'Desktop' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Desktop' }))
    expect(screen.getByText('Select at least one notification channel.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled()
  })

  it('shows a submission error without closing the dialog', async () => {
    const onClose = vi.fn()
    const createTask = vi.fn(async () => {
      throw new Error('scheduler unavailable')
    })
    useTaskStore.setState({ createTask } as Partial<ReturnType<typeof useTaskStore.getState>>)

    render(<NewTaskModal open onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Daily review' } })
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Review changes' } })
    fireEvent.change(screen.getByLabelText(/^Prompt/), { target: { value: 'Review recent commits.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('scheduler unavailable')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'New scheduled task' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('preserves edit payload fields while leaving task lifecycle state to the server', async () => {
    const updateTask = vi.fn(async (_id: string, _updates: Partial<CronTask>) => {})
    useTaskStore.setState({ updateTask } as Partial<ReturnType<typeof useTaskStore.getState>>)
    const task: CronTask = {
      id: 'task-1',
      name: 'Existing task',
      description: 'Existing description',
      cron: '30 8 * * 1-5',
      prompt: 'Existing prompt',
      enabled: false,
      recurring: true,
      createdAt: 123,
      model: 'provider-fast',
      providerId: 'provider-a',
      folderPath: '/tmp/project',
      notification: { enabled: true, channels: ['desktop'] },
    }

    render(<NewTaskModal open editTask={task} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1))
    expect(updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      name: 'Existing task',
      description: 'Existing description',
      cron: '30 8 * * 1-5',
      prompt: 'Existing prompt',
      model: 'provider-fast',
      providerId: 'provider-a',
      permissionMode: 'bypassPermissions',
      folderPath: '/tmp/project',
      notification: { enabled: true, channels: ['desktop'] },
    }))
    const updates = updateTask.mock.calls[0]?.[1] as Record<string, unknown>
    expect(updates).not.toHaveProperty('enabled')
    expect(updates).not.toHaveProperty('recurring')
  })

  it('creates scheduled tasks with a provider-scoped model selection', async () => {
    const createTask = vi.fn(async () => {})
    useTaskStore.setState({ createTask } as Partial<ReturnType<typeof useTaskStore.getState>>)
    useSettingsStore.setState({
      locale: 'en',
      currentModel: {
        id: 'provider-main',
        name: 'provider-main',
        description: '',
        context: '',
      },
      availableModels: [
        { id: 'claude-sonnet-4-6', name: 'Sonnet', description: '', context: '' },
      ],
      activeProviderName: 'Provider A',
    })
    useProviderStore.setState({
      providers: [{
        id: 'provider-a',
        presetId: 'custom',
        name: 'Provider A',
        apiKey: '***',
        baseUrl: 'https://api.example.com',
        apiFormat: 'anthropic',
        models: {
          main: 'provider-main',
          haiku: 'provider-fast',
          sonnet: 'provider-main',
          opus: '',
        },
      }],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })

    render(<NewTaskModal open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: 'provider cron' },
    })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'exercise provider selection' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Look at the commits/i), {
      target: { value: 'Say hello from the scheduled task.' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /provider-main/i }))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /provider-fast/i }))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
      await Promise.resolve()
    })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      model: 'provider-fast',
      providerId: 'provider-a',
      permissionMode: 'bypassPermissions',
      enabled: true,
      recurring: true,
    }))
  })
})
