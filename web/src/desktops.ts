export interface Desktop { id: string; name: string }
export interface Desktops { activeId: string; items: Desktop[] }
export const INITIAL_DESKTOPS: Desktops = { activeId: 'main', items: [{ id: 'main', name: 'デスクトップ1' }] };

/** 最初の画面は以前からの保存キーを使い、既存の配置をそのまま引き継ぐ。 */
export function desktopKey(id: string, key: string): string {
  return id === 'main' ? key : `${key}.${id}`;
}
export function restoreDesktops(raw: unknown): Desktops {
  if (!raw || typeof raw !== 'object') return INITIAL_DESKTOPS;
  const data = raw as Partial<Desktops>;
  const seen = new Set<string>();
  const items = Array.isArray(data.items) ? data.items.filter(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || seen.has(item.id) || typeof item.name !== 'string' || !item.name.trim()) return false;
    seen.add(item.id); return true;
  }).map(({ id, name }) => ({ id, name: name.trim().slice(0, 60) })) : [];
  if (!items.length) return INITIAL_DESKTOPS;
  return { items, activeId: items.some(item => item.id === data.activeId) ? data.activeId! : items[0].id };
}
export function addDesktop(state: Desktops, id: string): Desktops {
  if (state.items.some(item => item.id === id)) return state;
  const names = new Set(state.items.map(item => item.name));
  let number = 1;
  while (names.has(`デスクトップ${number}`)) number++;
  return { activeId: id, items: [...state.items, { id, name: `デスクトップ${number}` }] };
}
export function removeDesktop(state: Desktops, id: string): Desktops {
  if (state.items.length <= 1) return state;
  const index = state.items.findIndex(item => item.id === id);
  if (index < 0) return state;
  const items = state.items.filter(item => item.id !== id);
  return { items, activeId: state.activeId === id ? items[Math.min(index, items.length - 1)].id : state.activeId };
}
