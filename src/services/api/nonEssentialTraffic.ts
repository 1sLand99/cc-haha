/**
 * "禁用非必要外部流量"开关（cc-haha/settings.json 托管）。
 *
 * cc-haha 与 Claude Code 本身已无强绑定，除用户主动配置 Anthropic provider 外，
 * 默认屏蔽所有非必要出站流量（1P 事件遥测、MCP 官方注册表、更新检查、官方插件
 * 市场、Skills 市场等），避免企业安全软件对 anthropic.com 域名的告警（#1173）。
 *
 * 落地方式：
 * - 设置写入 ~/.claude/cc-haha/settings.json 的 `nonEssentialTraffic.disabled`
 * - server 启动时（applyNonEssentialTrafficSetting）把开关映射为进程内的
 *   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1，会话子进程继承该 env，
 *   覆盖 CLI 侧全部 essential-traffic 门控（src/utils/privacyLevel.ts）
 * - 运行中切换时由 updateNonEssentialTrafficDisabled 同步 env
 */

import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../../utils/envUtils.js'
import { saveGlobalConfig } from '../../utils/config.js'

const NON_ESSENTIAL_TRAFFIC_KEY = 'nonEssentialTraffic'
export const NON_ESSENTIAL_TRAFFIC_ENV = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'

export type NonEssentialTrafficSettings = {
  /** true = 禁用非必要外部流量（默认开启） */
  disabled: boolean
}

/** 默认开启禁用：cc-haha 与 Claude Code 已无强绑定，新用户默认不产生非必要流量。 */
export function defaultNonEssentialTrafficSettings(): NonEssentialTrafficSettings {
  return { disabled: true }
}

function getManagedSettingsPath(scope = getClaudeConfigHomeDir()): string {
  return join(scope, 'cc-haha', 'settings.json')
}

function normalizeNonEssentialTrafficSettings(
  settings: Record<string, unknown>,
): NonEssentialTrafficSettings {
  const value = settings[NON_ESSENTIAL_TRAFFIC_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultNonEssentialTrafficSettings()
  }
  const record = value as Record<string, unknown>
  return {
    disabled: typeof record.disabled === 'boolean' ? record.disabled : true,
  }
}

function readManagedSettingsSync(scope = getClaudeConfigHomeDir()): Record<string, unknown> {
  try {
    const filePath = getManagedSettingsPath(scope)
    if (!existsSync(filePath)) return {}
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function readManagedSettings(scope = getClaudeConfigHomeDir()): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(getManagedSettingsPath(scope), 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function writeManagedSettings(
  settings: Record<string, unknown>,
  scope = getClaudeConfigHomeDir(),
): Promise<void> {
  const filePath = getManagedSettingsPath(scope)
  const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(tmpFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
  await fs.rename(tmpFile, filePath)
}

/** 同步读取（用于 server 启动早期）。 */
export function readNonEssentialTrafficDisabledSync(): boolean {
  return normalizeNonEssentialTrafficSettings(readManagedSettingsSync()).disabled
}

export async function readNonEssentialTrafficDisabled(): Promise<boolean> {
  return normalizeNonEssentialTrafficSettings(await readManagedSettings()).disabled
}

/**
 * server 启动时调用：把设置映射为进程内 env，让本进程与派生 CLI 子进程
 * 都走 essential-traffic 门控。
 *
 * 显式 truthy env（'1'/'true' 等）表示用户显式启用 essential-traffic，
 * 优先于设置不覆盖；falsy（'0'/'false'）不算显式启用，直接按设置覆盖，
 * 否则 privacyLevel 的 truthy 判断会把 '0' 当作启用，UI 开关与实际行为不一致。
 */
export function applyNonEssentialTrafficSetting(): void {
  if (isEnvTruthy(process.env[NON_ESSENTIAL_TRAFFIC_ENV])) return
  if (readNonEssentialTrafficDisabledSync()) {
    process.env[NON_ESSENTIAL_TRAFFIC_ENV] = '1'
  } else {
    delete process.env[NON_ESSENTIAL_TRAFFIC_ENV]
  }
}

/** 运行中同步 env：开关关闭时删除 env，恢复非必要流量。 */
export function syncNonEssentialTrafficEnv(disabled: boolean): void {
  if (disabled) {
    process.env[NON_ESSENTIAL_TRAFFIC_ENV] = '1'
  } else {
    delete process.env[NON_ESSENTIAL_TRAFFIC_ENV]
  }
}

/** 更新设置并同步当前进程 env（桌面 UI 切换开关后立即生效）。 */
export async function updateNonEssentialTrafficDisabled(
  disabled: boolean,
): Promise<NonEssentialTrafficSettings> {
  const scope = getClaudeConfigHomeDir()
  const current = await readManagedSettings(scope)
  const next = {
    ...current,
    [NON_ESSENTIAL_TRAFFIC_KEY]: { disabled },
  }
  await writeManagedSettings(next, scope)
  syncNonEssentialTrafficEnv(disabled)
  if (!disabled) {
    // 重新允许流量时，解除官方插件市场自动安装的 policy_blocked 永久标记
    // （开启禁用时记录该标记，避免用户关闭开关后市场永远无法自动安装）。
    saveGlobalConfig(currentConfig => ({
      ...currentConfig,
      officialMarketplaceAutoInstallAttempted: false,
      officialMarketplaceAutoInstalled: false,
      officialMarketplaceAutoInstallFailReason: undefined,
      officialMarketplaceAutoInstallRetryCount: undefined,
      officialMarketplaceAutoInstallLastAttemptTime: undefined,
      officialMarketplaceAutoInstallNextRetryTime: undefined,
    }))
  }
  return { disabled }
}
