import { useEffect, useState } from 'react';

/**
 * スマホの見出し 1 行（≡ / 現在のタブ ▾ n/m / 要対応 / ＋ / ⋯）を使う画面。
 * 縦持ちは幅 760px 以下、横持ちは高さ 480px 以下のタッチ端末。
 * responsive.css の .desktop-shell.phone* はこのクラスを見て切り替わる（Desktops.tsx が付ける）。
 */
export const PHONE_QUERY = '(max-width: 760px), (max-height: 480px) and (pointer: coarse)';
/** スマホ横：見出し 36px・入力行 40px */
export const PHONE_LANDSCAPE_QUERY = '(max-height: 480px) and (pointer: coarse), (max-height: 480px) and (max-width: 760px)';

export const matches = (query: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/** メディアクエリが当てはまるか。画面の回転や幅の変化に追従する */
export function useMedia(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setValue(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return value;
}
