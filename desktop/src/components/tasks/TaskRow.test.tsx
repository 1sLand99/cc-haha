import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { TaskRow } from './TaskRow'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTaskStore } from '../../stores/taskStore'
import type { CronTask } from '../../types/task'

vi.mock('./TaskRunsPanel', () => ({
  TaskRunsPanel: ({ onClose }: { onClose: () => void }) => (
    <section aria-label="Mock task runs">
      <button type="button" onClick={onClose}>Close logs</button>
    </section>
  ),
}))

const enabledTask: CronTask = {
  id: 'task-1',
  name: 'Daily review',
  description: 'Review recent changes',
  cron: '0 9 * * 1-5',
  prompt: 'Review commits',
  enabled: true,
  recurring: true,
  createdAt: Date.parse('2026-05-01T00:00:00.000Z'),
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTaskStore.setState(useTaskStore.getInitialState(), true)
})

describe('TaskRow', () => {
  it('renders shadcn task status and accessible row actions', () => {
    useSettingsStore.setState({ locale: 'en' })
    const { container, rerender } = render(
      <TaskRow task={enabledTask} showLogs={false} onToggleLogs={vi.fn()} />,
    )

    expect(screen.getByRole('listitem')).toBeInTheDocument()
    expect(screen.getByText('Active')).toHaveAttribute('data-slot', 'badge')
    expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Logs' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Task actions' })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument()

    rerender(
      <TaskRow task={{ ...enabledTask, enabled: false }} showLogs={false} onToggleLogs={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Run now · Disabled' })).toBeDisabled()
    expect(screen.getByText('Disabled')).toHaveAttribute('data-slot', 'badge')
  })

  it('confirms a manual run, opens logs, and restores focus after success', async () => {
    useSettingsStore.setState({ locale: 'en' })
    let resolveRun: () => void = () => {}
    const runRequest = new Promise<void>((resolve) => {
      resolveRun = resolve
    })
    const runTask = vi.fn(() => runRequest)
    const onToggleLogs = vi.fn()
    useTaskStore.setState({ runTask } as Partial<ReturnType<typeof useTaskStore.getState>>)

    render(<TaskRow task={enabledTask} showLogs={false} onToggleLogs={onToggleLogs} />)
    const runButton = screen.getByRole('button', { name: 'Run now' })
    fireEvent.click(runButton)

    expect(screen.getByRole('alertdialog', { name: 'Execute this task immediately?' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))

    expect(runTask).toHaveBeenCalledWith('task-1')
    expect(onToggleLogs).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      resolveRun()
      await runRequest
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(runButton).toHaveFocus())
  })

  it('surfaces toggle failures in the confirmation and retries without optimistic state', async () => {
    useSettingsStore.setState({ locale: 'en' })
    const updateTask = vi.fn()
      .mockRejectedValueOnce(new Error('could not disable task'))
      .mockResolvedValueOnce(undefined)
    useTaskStore.setState({ updateTask } as Partial<ReturnType<typeof useTaskStore.getState>>)

    render(<TaskRow task={enabledTask} showLogs={false} onToggleLogs={vi.fn()} />)
    const menuButton = screen.getByRole('button', { name: 'Task actions' })
    await act(async () => {
      menuButton.focus()
      fireEvent.keyDown(menuButton, { key: 'ArrowDown' })
      await Promise.resolve()
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }))

    expect(screen.getByRole('alertdialog', { name: 'Disable this scheduled task?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    expect(await screen.findByText('could not disable task')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(2))
    expect(updateTask).toHaveBeenLastCalledWith('task-1', { enabled: false })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(menuButton).toHaveFocus())
  })

  it('cancels a destructive action with Escape and restores menu focus', async () => {
    useSettingsStore.setState({ locale: 'en' })
    const deleteTask = vi.fn(async () => {})
    useTaskStore.setState({ deleteTask } as Partial<ReturnType<typeof useTaskStore.getState>>)

    render(<TaskRow task={enabledTask} showLogs={false} onToggleLogs={vi.fn()} />)
    const menuButton = screen.getByRole('button', { name: 'Task actions' })
    await act(async () => {
      menuButton.focus()
      fireEvent.keyDown(menuButton, { key: 'ArrowDown' })
      await Promise.resolve()
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Permanently delete this task and all its logs?',
    })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(menuButton).toHaveFocus())
    expect(deleteTask).not.toHaveBeenCalled()
  })
})
