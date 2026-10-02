/**
 * Roomio-native style tokens. Matches the app's clean panel UI: neutral stone
 * background (#cdccc9), white floating panels, soft shadows, restrained accents.
 * Persistence UI should feel native, not bolted on (brief §6).
 */
import type { CSSProperties } from 'react'

export const T = {
  bg: '#cdccc9',
  panel: '#ffffff',
  panelBorder: '#e3e1dc',
  ink: '#23211e',
  inkSoft: '#6b6862',
  inkFaint: '#9a968f',
  accent: '#3f7d6e',
  accentInk: '#ffffff',
  danger: '#b4453a',
  warn: '#b8862f',
  good: '#3f7d6e',
  radius: 12,
  radiusSm: 8,
  shadow: '0 6px 24px rgba(30,28,24,0.10)',
  shadowSm: '0 2px 8px rgba(30,28,24,0.08)',
} as const

export const panel: CSSProperties = {
  background: T.panel,
  border: `1px solid ${T.panelBorder}`,
  borderRadius: T.radius,
  boxShadow: T.shadow,
}

export const btnBase: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: T.radiusSm,
  border: `1px solid ${T.panelBorder}`,
  padding: '8px 14px',
  cursor: 'pointer',
  background: '#fff',
  color: T.ink,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  lineHeight: 1,
}

export const btnPrimary: CSSProperties = {
  ...btnBase,
  background: T.accent,
  color: T.accentInk,
  border: `1px solid ${T.accent}`,
}

export const btnGhost: CSSProperties = {
  ...btnBase,
  background: 'transparent',
  border: '1px solid transparent',
}

export const btnDanger: CSSProperties = {
  ...btnBase,
  color: T.danger,
  borderColor: '#e7c9c5',
}
