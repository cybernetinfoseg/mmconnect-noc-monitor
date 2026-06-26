import React from 'react';

const STATUS_COLORS = {
  online: '#10b981',
  warning: '#f59e0b',
  offline: '#ef4444',
  unknown: '#94a3b8',
};

// All available icon types
export const ICON_TYPES = [
  { key: 'zkteco',    label: 'ZKTeco' },
  { key: 'anviz',     label: 'Anviz' },
  { key: 'hikvision', label: 'Hikvisn' },
  { key: 'dahua',     label: 'Dahua' },
  { key: 'timmy',     label: 'Timmy' },
  { key: 'suprema',   label: 'Suprema' },
  { key: 'nitgen',    label: 'Nitgen' },
  { key: 'outro',     label: 'Genérico' },
];

const icons = {
  // Fingerprint (ZKTeco)
  zkteco: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <path d="M20 10 C14 10 10 14.5 10 20 C10 25.5 14 30 20 30" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M20 13.5 C15.5 13.5 13 16.5 13 20 C13 23.5 15.5 26.5 20 26.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      <path d="M20 17 C17.5 17 16 18.3 16 20 C16 21.7 17.5 23 20 23" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      <circle cx="20" cy="20" r="1.6" fill="white"/>
    </svg>
  ),
  // Palm/hand (Anviz)
  anviz: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <path d="M14 27 L14 17.5 C14 16.7 14.7 16 15.5 16 C16.3 16 17 16.7 17 17.5 L17 13.5 C17 12.7 17.7 12 18.5 12 C19.3 12 20 12.7 20 13.5 L20 16 C20 15.2 20.7 14.5 21.5 14.5 C22.3 14.5 23 15.2 23 16 L23 17 C23 16.2 23.7 15.5 24.5 15.5 C25.3 15.5 26 16.2 26 17 L26 27 C26 29.2 24.2 31 22 31 L18 31 C15.8 31 14 29.2 14 27Z" stroke="white" strokeWidth="1.8" fill="none" strokeLinejoin="round"/>
    </svg>
  ),
  // Face recognition with scan corners (Hikvision)
  hikvision: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <circle cx="20" cy="18" r="6" stroke="white" strokeWidth="1.8" fill="none"/>
      <circle cx="17.5" cy="17" r="1.1" fill="white"/>
      <circle cx="22.5" cy="17" r="1.1" fill="white"/>
      <path d="M17 21 Q20 23 23 21" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      <path d="M8 8 L8 12 M8 8 L12 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      <path d="M32 8 L32 12 M32 8 L28 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      <path d="M8 32 L8 28 M8 32 L12 32" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      <path d="M32 32 L32 28 M32 32 L28 32" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  // Face + body silhouette (Dahua)
  dahua: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <circle cx="20" cy="15" r="5.5" stroke="white" strokeWidth="1.8" fill="none"/>
      <circle cx="18" cy="14" r="1" fill="white"/>
      <circle cx="22" cy="14" r="1" fill="white"/>
      <path d="M17.5 17.5 Q20 19.5 22.5 17.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
      <path d="M12 31 C12 26 15.5 23.5 20 23.5 C24.5 23.5 28 26 28 31" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    </svg>
  ),
  // Face + wifi cloud (Timmy / THbio)
  timmy: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <circle cx="20" cy="16" r="5" stroke="white" strokeWidth="1.8" fill="none"/>
      <circle cx="18.3" cy="15" r="1" fill="white"/>
      <circle cx="21.7" cy="15" r="1" fill="white"/>
      <path d="M17.5 18.5 Q20 20 22.5 18.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
      <path d="M13 27.5 Q20 23 27 27.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <path d="M16 31 Q20 28 24 31" stroke="white" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
    </svg>
  ),
  // Iris/eye scan (Suprema)
  suprema: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <ellipse cx="20" cy="20" rx="10" ry="7" stroke="white" strokeWidth="1.8" fill="none"/>
      <circle cx="20" cy="20" r="4.5" stroke="white" strokeWidth="1.5" fill="none"/>
      <circle cx="20" cy="20" r="1.8" fill="white"/>
      <path d="M20 11 L20 9 M20 31 L20 29 M10 20 L8 20 M32 20 L30 20" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  // Fingerprint + card chip (Nitgen)
  nitgen: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <rect x="9" y="13" width="22" height="15" rx="3" stroke="white" strokeWidth="1.6" fill="none"/>
      <path d="M20 13 C17 13 15 15 15 18 C15 21 17 23 20 23" stroke="white" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <path d="M20 16 C18.5 16 18 17 18 18 C18 19 18.5 20 20 20" stroke="white" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <circle cx="20" cy="18" r="1.2" fill="white"/>
    </svg>
  ),
  // Generic access card
  outro: ({ color, size }) => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="7" fill={color} stroke="white" strokeWidth="2"/>
      <rect x="9" y="12" width="22" height="16" rx="3" stroke="white" strokeWidth="1.8" fill="none"/>
      <circle cx="16" cy="20" r="3.5" stroke="white" strokeWidth="1.5" fill="none"/>
      <path d="M22 16.5 L29 16.5 M22 20 L29 20 M22 23.5 L26.5 23.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
};

// Aliases
icons['thbio'] = icons.timmy;

function resolveFabKey(fab) {
  const f = (fab || 'outro').toLowerCase().replace(/[^a-z]/g, '');
  if (f.includes('zkteco')) return 'zkteco';
  if (f.includes('anviz')) return 'anviz';
  if (f.includes('hikvision') || f.includes('hik')) return 'hikvision';
  if (f.includes('dahua')) return 'dahua';
  if (f.includes('timmy') || f.includes('thbio') || f.includes('timbio')) return 'timmy';
  if (f.includes('suprema')) return 'suprema';
  if (f.includes('nitgen')) return 'nitgen';
  return 'outro';
}

export function getTerminalIcon(terminal, size = 40, iconOverride) {
  const fabKey = resolveFabKey(iconOverride || terminal.fabricante);
  const color = STATUS_COLORS[terminal.status] || STATUS_COLORS.unknown;
  const IconComp = icons[fabKey] || icons.outro;
  return <IconComp color={color} size={size} />;
}

export default function TerminalIcon({ terminal, size = 40, iconOverride }) {
  return getTerminalIcon(terminal, size, iconOverride);
}