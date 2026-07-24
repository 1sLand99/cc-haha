const PREVIEW_AGENT_THEME = {
  '--cc-haha-color-brand': '#8F482F',
  '--cc-haha-color-on-brand': '#FFFFFF',
  '--cc-haha-color-surface': '#FFFFFF',
  '--cc-haha-color-surface-muted': '#F4F4F0',
  '--cc-haha-color-text-primary': '#1B1C1A',
  '--cc-haha-color-text-secondary': '#54433E',
  '--cc-haha-color-text-tertiary': '#87736D',
  '--cc-haha-color-border': '#DAC1BA',
  '--cc-haha-color-selection': 'rgba(143, 72, 47, 0.12)',
  '--cc-haha-radius-md': '8px',
  '--cc-haha-radius-lg': '12px',
  '--cc-haha-shadow-dropdown': '0 4px 20px rgba(27, 28, 26, 0.04), 0 12px 40px rgba(27, 28, 26, 0.08)',
} as const

export function applyPreviewAgentTheme(host: HTMLElement) {
  for (const [property, value] of Object.entries(PREVIEW_AGENT_THEME)) {
    host.style.setProperty(property, value)
  }
}

export { PREVIEW_AGENT_THEME }
