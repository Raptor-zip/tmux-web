import type { SVGProps } from 'react';

const paths = {
  edit: 'm15 4 5 5 M4 15 15 4a3 3 0 0 1 5 5L9 20H4z',
  keyboard: 'M2 5h20v14H2z M6 9h.01 M10 9h.01 M14 9h.01 M18 9h.01 M6 13h.01 M10 13h.01 M14 13h.01 M18 13h.01 M7 16h10',
  file: 'M14 3H5v18h14V8z M14 3v5h5',
  image: 'M3 3h18v18H3z M3 17l6-6 5 5 3-3 4 4 M16 7h.01',
  video: 'M3 5h13v14H3z M16 10l5-3v10l-5-3',
  audio: 'M9 18V5l11-2v13 M9 9l11-2 M9 18c0 3-6 3-6 0s6-3 6 0 M20 16c0 3-6 3-6 0s6-3 6 0',

  expand: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  claude: 'M12 3v5 M12 16v5 M3 12h5 M16 12h5 M5.6 5.6l3.5 3.5 M14.9 14.9l3.5 3.5 M5.6 18.4l3.5-3.5 M14.9 9.1l3.5-3.5 M8.6 3.9l1.8 4.6 M13.6 15.5l1.8 4.6 M3.9 15.4l4.6-1.8 M15.5 10.4l4.6-1.8',
  codex: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 7l-4 10',
  loading: 'M20 12a8 8 0 1 1-8-8',
  screen: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 13-3l2 2 M4 17l2 2a8 8 0 0 0 13-3',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  upload: 'M12 16V3 M7 8l5-5 5 5 M3 16v5h18v-5',
  download: 'M12 3v13 M7 11l5 5 5-5 M3 16v5h18v-5',
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
