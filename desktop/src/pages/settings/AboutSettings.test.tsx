import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { AboutSettings } from './AboutSettings'

beforeEach(() => {
  useSettingsStore.setState({ locale: 'zh' })
})

afterEach(() => {
  cleanup()
})

it('keeps the group QR collapsed until the entry below feedback is opened', async () => {
  render(<AboutSettings />)
  // The version arrives from an async host call; let it settle so the assertion
  // is not racing a state update.
  await screen.findByText((_, node) => node?.tagName === 'SPAN' && node.textContent === '版本 0.1.0')

  const entry = screen.getByRole('button', { name: /加入 cc-haha 交流群/ })
  expect(entry.compareDocumentPosition(screen.getByRole('button', { name: /反馈问题/ })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  expect(entry).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('img', { name: 'cc-haha 企业微信用户群二维码' })).not.toBeInTheDocument()

  fireEvent.click(entry)

  const qr = screen.getByRole('img', { name: 'cc-haha 企业微信用户群二维码' })
  expect(qr).toHaveAttribute('src', expect.stringContaining('icons/wechat-group-qr.png'))
  expect(entry).toHaveAttribute('aria-expanded', 'true')

  fireEvent.click(entry)
  expect(screen.queryByRole('img', { name: 'cc-haha 企业微信用户群二维码' })).not.toBeInTheDocument()
})
