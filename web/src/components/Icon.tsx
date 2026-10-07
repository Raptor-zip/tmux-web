import type { SVGProps } from 'react';

const paths = {
  claude: 'M12 3v5 M12 16v5 M3 12h5 M16 12h5 M5.6 5.6l3.5 3.5 M14.9 14.9l3.5 3.5 M5.6 18.4l3.5-3.5 M14.9 9.1l3.5-3.5 M8.6 3.9l1.8 4.6 M13.6 15.5l1.8 4.6 M3.9 15.4l4.6-1.8 M15.5 10.4l4.6-1.8',
  codex: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 7l-4 10',
  loading: 'M20 12a8 8 0 1 1-8-8',
  screen: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v2H6l-3 11h15l3-11 M3 7v13',
  plus: 'M12 5v14 M5 12h14',
  close: 'm6 6 12 12 M18 6 6 18',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  switch: 'M4 7h16l-4-4 M20 17H4l4 4',
  splitRight: 'M4 4h16v16H4z M12 4v16',
  splitBottom: 'M4 4h16v16H4z M4 12h16',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17h.01',
} as const;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d={paths[name]} />
  </svg>;
}
