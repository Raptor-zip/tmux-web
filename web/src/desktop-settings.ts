export interface DesktopSettings {
  lossless: boolean;
  quality: number;
  compression: number;
  scale: '1' | '0.75' | '0.5';
  interval: '16' | '33' | '66' | '100';
}

export const desktopPresets = {
  responsive: { label: '低遅延', lossless: false, quality: 3, compression: 1, scale: '0.5', interval: '33' },
  balanced: { label: 'バランス', lossless: false, quality: 6, compression: 1, scale: '0.75', interval: '33' },
  sharp: { label: '文字くっきり', lossless: true, quality: 9, compression: 1, scale: '1', interval: '33' },
} as const;

export const DESKTOP_SETTINGS_KEY = 'tmux-web:desktop-settings:v1';

export function parseDesktopSettings(value: unknown): DesktopSettings {
  const defaults = desktopPresets.balanced;
  const raw = value && typeof value === 'object' ? value as Partial<DesktopSettings> : {};
  const level = (n: unknown, fallback: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9 ? n : fallback;
  return {
    lossless: typeof raw.lossless === 'boolean' ? raw.lossless : defaults.lossless,
    quality: level(raw.quality, defaults.quality),
    compression: level(raw.compression, defaults.compression),
    scale: ['1', '0.75', '0.5'].includes(raw.scale!) ? raw.scale! : defaults.scale,
    interval: ['16', '33', '66', '100'].includes(raw.interval!) ? raw.interval! : defaults.interval,
  };
}

export function loadDesktopSettings(): DesktopSettings {
  try { return parseDesktopSettings(JSON.parse(localStorage.getItem(DESKTOP_SETTINGS_KEY) || 'null')); }
  catch { return parseDesktopSettings(null); }
}
