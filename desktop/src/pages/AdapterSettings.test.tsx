import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { AdapterSettings } from './AdapterSettings'
import { useAdapterStore } from '../stores/adapterStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { AdapterFileConfig } from '../types/adapter'

const FEISHU_CREATE_BOT_URL = 'https://open.feishu.cn/page/openclaw?form=multiAgent'
const IM_CONFIG_DOCS_URL = 'https://claudecode-haha.relakkesyang.org/im/'

function renderAdapterSettings(
  config: AdapterFileConfig,
  overrides: Partial<ReturnType<typeof useAdapterStore.getState>> = {},
) {
  useSettingsStore.setState({ locale: 'en' })
  useAdapterStore.setState({
    config,
    isLoading: false,
    hasLoaded: true,
    fetchConfig: vi.fn(async () => {}),
    updateConfig: vi.fn(async () => {}),
    startWhatsAppLogin: vi.fn(async () => ({ message: 'ok', sessionKey: 'whatsapp-session' })),
    pollWhatsAppLogin: vi.fn(async () => ({ connected: false })),
    unbindWechatAccount: vi.fn(async () => {}),
    unbindWhatsAppAccount: vi.fn(async () => {}),
    unbindDingtalkBot: vi.fn(async () => {}),
    removePairedUser: vi.fn(async () => {}),
    beginDingtalkRegistration: vi.fn(async () => ({
      deviceCode: 'device-code',
      verificationUriComplete: 'https://example.com/auth',
      intervalSeconds: 1,
      expiresInSeconds: 60,
    })),
    pollDingtalkRegistration: vi.fn(async () => ({ status: 'PENDING' })),
    ...overrides,
  } as Partial<ReturnType<typeof useAdapterStore.getState>>)

  return render(<AdapterSettings />)
}

function selectAdapterTab(name: string) {
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.click(tab)
}

afterEach(() => {
  cleanup()
  useAdapterStore.setState(useAdapterStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

describe('AdapterSettings IM setup entry', () => {
  it('shows Telegram first by default and links to the unified documentation URL', () => {
    renderAdapterSettings({})

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Telegram', 'Feishu', 'WeChat', 'DingTalk', 'WhatsApp'])
    expect(screen.getByRole('tab', { name: 'Telegram' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Bot Token')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'documentation link' })).toHaveAttribute(
      'href',
      IM_CONFIG_DOCS_URL,
    )
  })

  it('uses shadcn primitives and supports keyboard tab navigation', async () => {
    const { container } = renderAdapterSettings({})

    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="tabs"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="tabs-list"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="input"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="button"]')).toBeInTheDocument()

    const telegram = screen.getByRole('tab', { name: 'Telegram' })
    await act(async () => {
      telegram.focus()
      fireEvent.keyDown(telegram, { key: 'ArrowRight' })
    })

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Feishu' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.getByText('Need a Feishu bot?')).toBeInTheDocument()
  })

  it('fails closed when the initial config load fails and retries explicitly', () => {
    const fetchConfig = vi.fn(async () => {})
    useSettingsStore.setState({ locale: 'en' })
    useAdapterStore.setState({
      isLoading: false,
      hasLoaded: false,
      error: 'temporary read failure',
      fetchConfig,
    })

    render(<AdapterSettings />)

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load adapter settings')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(fetchConfig).toHaveBeenCalledTimes(2)
  })

  it('shows a non-interactive shadcn loading state before config is available', () => {
    useSettingsStore.setState({ locale: 'en' })
    useAdapterStore.setState({
      isLoading: true,
      hasLoaded: false,
      error: null,
      fetchConfig: vi.fn(async () => {}),
    })

    const { container } = render(<AdapterSettings />)

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})

describe('AdapterSettings draft and save behavior', () => {
  it('rejects invalid Telegram user IDs without saving', async () => {
    const updateConfig = vi.fn(async () => {})
    renderAdapterSettings({}, { updateConfig })

    fireEvent.change(screen.getByLabelText('Allowed Users'), { target: { value: '123, nope, -2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect((await screen.findAllByText(/positive integers/)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('Allowed Users')).toHaveAttribute('aria-invalid', 'true')
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('can clear the default project and never sends binding-owned QR fields', async () => {
    const updateConfig = vi.fn(async (_patch: Partial<AdapterFileConfig>): Promise<void> => {})
    renderAdapterSettings(
      {
        defaultProjectDir: '/tmp/project',
        wechat: { accountId: 'wx-bound', botToken: '****oken', allowedUsers: ['wx-user'] },
        whatsapp: {
          accountJid: 'account@s.whatsapp.net',
          authDir: '/tmp/legacy-auth',
          allowedUsers: ['allowed@s.whatsapp.net'],
        },
      },
      { updateConfig },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use default directory' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1))
    const patch = updateConfig.mock.calls[0]![0] as AdapterFileConfig
    expect(patch.defaultProjectDir).toBe('')
    expect(patch.wechat).toEqual({ allowedUsers: ['wx-user'] })
    expect(patch.whatsapp).toEqual({ allowedUsers: ['allowed@s.whatsapp.net'] })
    expect(patch.wechat).not.toHaveProperty('botToken')
    expect(patch.whatsapp).not.toHaveProperty('authDir')
  })

  it('preserves a dirty secret across background refresh and masks it after save', async () => {
    const updateConfig = vi.fn(async () => {
      useAdapterStore.setState({
        config: { telegram: { botToken: '****cret', allowedUsers: [] } },
      })
    })
    renderAdapterSettings(
      { telegram: { botToken: '****oken', allowedUsers: [] } },
      { updateConfig },
    )

    const token = screen.getByLabelText('Bot Token')
    fireEvent.change(token, { target: { value: 'renderer-plain-secret' } })
    act(() => {
      useAdapterStore.setState({
        config: {
          telegram: { botToken: '****oken', allowedUsers: [] },
          pairing: { code: '******', createdAt: 1, expiresAt: Date.now() + 60_000 },
        },
      })
    })
    expect(token).toHaveValue('renderer-plain-secret')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(token).toHaveValue('****cret'))
  })

  it('shows pairing generation failures instead of only logging them', async () => {
    renderAdapterSettings({}, {
      generatePairingCode: vi.fn(async () => {
        throw new Error('isolated write failed')
      }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Generate Code' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('isolated write failed')
  })

  it('keeps every platform field editable and saves one normalized patch', async () => {
    const updateConfig = vi.fn(async () => {})
    renderAdapterSettings({}, { updateConfig })

    selectAdapterTab('Feishu')
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_qa' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'feishu-secret' } })
    fireEvent.change(screen.getByLabelText('Encrypt Key'), { target: { value: 'encrypt-key' } })
    fireEvent.change(screen.getByLabelText('Verification Token'), { target: { value: 'verify-token' } })
    fireEvent.change(within(screen.getByRole('tabpanel')).getByLabelText('Allowed Users'), {
      target: { value: 'ou_one, ou_two' },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'Streaming Card Mode' }))

    selectAdapterTab('WeChat')
    fireEvent.change(within(screen.getByRole('tabpanel')).getByLabelText('Allowed Users'), {
      target: { value: 'wx_one, wx_two' },
    })

    selectAdapterTab('DingTalk')
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'ding-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'ding-secret' } })
    fireEvent.change(screen.getByLabelText('Stream Endpoint'), { target: { value: 'wss://example.invalid' } })
    fireEvent.change(screen.getByLabelText('Permission Card Template ID'), {
      target: { value: 'template-id' },
    })
    fireEvent.change(within(screen.getByRole('tabpanel')).getByLabelText('Allowed Users'), {
      target: { value: 'ding_one, ding_two' },
    })

    selectAdapterTab('WhatsApp')
    fireEvent.change(within(screen.getByRole('tabpanel')).getByLabelText('Allowed Users'), {
      target: { value: 'one@s.whatsapp.net, two@s.whatsapp.net' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1))
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      feishu: expect.objectContaining({
        appId: 'cli_qa',
        appSecret: 'feishu-secret',
        encryptKey: 'encrypt-key',
        verificationToken: 'verify-token',
        allowedUsers: ['ou_one', 'ou_two'],
        streamingCard: true,
      }),
      wechat: { allowedUsers: ['wx_one', 'wx_two'] },
      dingtalk: expect.objectContaining({
        clientId: 'ding-client',
        clientSecret: 'ding-secret',
        endpoint: 'wss://example.invalid',
        permissionCardTemplateId: 'template-id',
        allowedUsers: ['ding_one', 'ding_two'],
      }),
      whatsapp: { allowedUsers: ['one@s.whatsapp.net', 'two@s.whatsapp.net'] },
    }))
  })
})

describe('AdapterSettings Feishu onboarding', () => {
  it('shows the documented one-click Feishu bot link before credentials are configured', () => {
    renderAdapterSettings({})
    selectAdapterTab('Feishu')

    expect(screen.getByText('Need a Feishu bot?')).toBeInTheDocument()
    expect(screen.getByText(/OpenClaw template/)).toBeInTheDocument()
    expect(screen.getByText('1. Create the bot from the template.')).toBeInTheDocument()
    expect(screen.getByText('2. Copy its App ID and App Secret, then fill them in here.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create feishu bot/i })).toHaveAttribute(
      'href',
      FEISHU_CREATE_BOT_URL,
    )
  })

  it('hides the one-click Feishu bot prompt once saved credentials exist', () => {
    renderAdapterSettings({
      feishu: {
        appId: 'cli_existing',
        appSecret: '****cret',
      },
    })
    selectAdapterTab('Feishu')

    expect(screen.queryByRole('link', { name: /create feishu bot/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Need a Feishu bot?')).not.toBeInTheDocument()
  })
})

describe('AdapterSettings account unbind confirmation', () => {
  it('confirms before unbinding a WeChat account', async () => {
    const unbindWechatAccount = vi.fn(async () => {})
    renderAdapterSettings(
      { wechat: { accountId: 'wx-account' } },
      { unbindWechatAccount },
    )

    selectAdapterTab('WeChat')
    const trigger = screen.getByRole('button', { name: 'Unbind WeChat account' })
    fireEvent.click(trigger)

    expect(unbindWechatAccount).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Unbind WeChat account' })
    expect(within(dialog).getByText(/You will need to scan again/)).toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(unbindWechatAccount).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Unbind WeChat account' })).getByRole('button', { name: 'Unbind WeChat account' }))

    await waitFor(() => {
      expect(unbindWechatAccount).toHaveBeenCalledTimes(1)
    })
  })

  it('confirms before unbinding a DingTalk bot account', async () => {
    const unbindDingtalkBot = vi.fn(async () => {})
    renderAdapterSettings(
      { dingtalk: { clientId: 'dt-client' } },
      { unbindDingtalkBot },
    )

    selectAdapterTab('DingTalk')
    fireEvent.click(screen.getByRole('button', { name: 'Unbind bot account' }))

    expect(unbindDingtalkBot).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Unbind bot account' })
    expect(within(dialog).getByText(/You will need to scan again/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unbind bot account' }))

    await waitFor(() => {
      expect(unbindDingtalkBot).toHaveBeenCalledTimes(1)
    })
  })

  it('shows WhatsApp QR binding controls', () => {
    renderAdapterSettings({})

    selectAdapterTab('WhatsApp')

    expect(screen.getByText('WhatsApp is not bound')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan to Bind' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. 15551234567@s.whatsapp.net')).toBeInTheDocument()
  })

  it('keeps the paired-user confirmation open when unbind fails', async () => {
    renderAdapterSettings(
      {
        telegram: {
          pairedUsers: [{ userId: 123, displayName: 'QA User', pairedAt: 1 }],
        },
      },
      {
        removePairedUser: vi.fn(async () => {
          throw new Error('isolated unbind failed')
        }),
      },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unbind' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Unbind' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unbind' }))

    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: 'Unbind' })).toBeInTheDocument()
      expect(within(screen.getByRole('alertdialog', { name: 'Unbind' })).getByRole('alert')).toHaveTextContent(
        'isolated unbind failed',
      )
    })
  })

  it('restores focus after canceling a paired-user unbind with Escape', async () => {
    renderAdapterSettings({
      telegram: {
        pairedUsers: [{ userId: 123, displayName: 'QA User', pairedAt: 1 }],
      },
    })

    const trigger = screen.getByRole('button', { name: 'Unbind' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('alertdialog', { name: 'Unbind' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('alertdialog', { name: 'Unbind' })).not.toBeInTheDocument()
  })
})
