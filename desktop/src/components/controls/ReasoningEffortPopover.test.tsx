import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReasoningEffortPopover } from './ReasoningEffortPopover'

const options = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const labels = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

afterEach(cleanup)

function renderPopover(overrides: Partial<React.ComponentProps<typeof ReasoningEffortPopover>> = {}) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <>
      <ReasoningEffortPopover
        open
        trigger={<button>5.6 Sol 极高</button>}
        options={[...options]}
        value="xhigh"
        labels={labels}
        onChange={onChange}
        onClose={onClose}
        {...overrides}
      />
      <button>外部区域</button>
    </>,
  )
  return { ...view, onChange, onClose }
}

describe('ReasoningEffortPopover', () => {
  it('keeps the effort visual compact without non-functional icon controls', () => {
    renderPopover()

    const popover = screen.getByTestId('reasoning-effort-popover')
    expect(popover).toHaveAttribute('data-slot', 'popover-content')
    expect(popover).toHaveClass('w-60', 'px-3.5', 'pb-3.5', 'pt-3')
    expect(popover.querySelectorAll('svg')).toHaveLength(0)
    expect(screen.getByTestId('reasoning-effort-header')).toHaveClass('mb-2.5', 'justify-between')
    expect(screen.getByTestId('reasoning-effort-label')).toHaveClass('text-sm')
    expect(screen.getByTestId('reasoning-effort-context-label')).toHaveClass('text-[10px]')
    expect(screen.getByTestId('reasoning-effort-context-label')).toHaveTextContent('推理强度')
    expect(screen.getByTestId('reasoning-effort-slider')).toHaveClass('h-9')
    expect(popover.querySelector('[data-slot="slider-track"]')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '推理强度' })).toHaveAttribute('data-slot', 'slider-thumb')
  })

  it('renders every model-supported stop and exposes the selected localized value', () => {
    renderPopover()

    const slider = screen.getByRole('slider', { name: '推理强度' })
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '4')
    expect(slider).toHaveAttribute('aria-valuenow', '3')
    expect(slider).toHaveAttribute('aria-valuetext', '极高')
    expect(screen.getAllByTestId('reasoning-effort-stop')).toHaveLength(5)
    expect(screen.getByText('极高')).toBeInTheDocument()
    expect(screen.getByTestId('reasoning-effort-popover').querySelector('[data-slot="slider-range"]')).toHaveClass('bg-[var(--color-brand)]')
    expect(slider).toHaveClass('focus-visible:shadow-[var(--shadow-focus-ring)]')
  })

  it('selects a discrete stop through the shadcn slider keyboard behavior', () => {
    const { onChange } = renderPopover()
    const slider = screen.getByRole('slider', { name: '推理强度' })

    fireEvent.keyDown(slider, { key: 'ArrowLeft' })

    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('supports keyboard navigation and clamps at supported endpoints', () => {
    const { onChange, rerender } = renderPopover({ value: 'low' })
    const slider = screen.getByRole('slider', { name: '推理强度' })

    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    fireEvent.keyDown(slider, { key: 'End' })

    expect(onChange.mock.calls).toEqual([['medium'], ['max']])

    rerender(
      <ReasoningEffortPopover
        open
        trigger={<button>5.6 Sol 最大</button>}
        options={[...options]}
        value="max"
        labels={labels}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )
    fireEvent.keyDown(screen.getByRole('slider', { name: '推理强度' }), { key: 'ArrowRight' })
    expect(onChange.mock.calls).toEqual([['medium'], ['max']])
  })

  it('closes on Escape through the shadcn popover dismiss behavior', () => {
    const { onClose } = renderPopover()
    const slider = screen.getByRole('slider', { name: '推理强度' })

    fireEvent.keyDown(slider, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
