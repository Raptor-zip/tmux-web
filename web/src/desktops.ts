import { activateTab, addTab, allLeaves, closeTab, findSameTarget, findLeaf, findScreenTab, findTab, makeLeaf, makeScreenTab, type LayoutNode } from './layout';

export interface Desktop { id: string; name: string }
export interface Desktops { activeId: string; items: Desktop[] }
/** 新しく作るワークスペースの既定名。保存済みの名前（『デスクトップ1』など）はそのまま使う */
export const workspaceName = (number: number) => `ワークスペース ${number}`;
export const INITIAL_DESKTOPS: Desktops = { activeId: 'main', items: [{ id: 'main', name: workspaceName(1) }] };

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
  while (names.has(workspaceName(number))) number++;
  return { activeId: id, items: [...state.items, { id, name: workspaceName(number) }] };
}
/** ワークスペースを並びの中で 1 つ左（-1）か右（+1）へ移す。端では何もしない */
export function moveDesktop(state: Desktops, id: string, delta: -1 | 1): Desktops {
  const index = state.items.findIndex(item => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= state.items.length) return state;
  const items = [...state.items];
  [items[index], items[target]] = [items[target], items[index]];
  return { ...state, items };
}
export function removeDesktop(state: Desktops, id: string): Desktops {
  if (state.items.length <= 1) return state;
  const index = state.items.findIndex(item => item.id === id);
  if (index < 0) return state;
  const items = state.items.filter(item => item.id !== id);
  return { items, activeId: state.activeId === id ? items[Math.min(index, items.length - 1)].id : state.activeId };
}

/** Mounted desktops expose their current layout so transfers never use stale storage. */
export interface DesktopLayoutHandle {
  read(): { layout: LayoutNode | null; focusedId: string | null };
  write(layout: LayoutNode | null, focusedId: string | null): void;
}
export type DesktopLayoutRegistry = Map<string, DesktopLayoutHandle>;

/** Move only the browser tab; tmux windows and running processes stay in place. */
export function transferDesktopTab(source: LayoutNode, destination: LayoutNode | null, tabId: string, focusedId: string | null) {
  const found = findTab(source, tabId);
  if (!found) return null;
  const remaining = closeTab(source, tabId);
  if (!destination) {
    const leaf = makeLeaf(found.tab);
    return { source: remaining, destination: leaf, focusedId: leaf.id };
  }
  // 同じものを映すタブ（同じウィンドウ・同じデバイスの画面）がすでにあれば、それを前に出す
  const existing = findSameTarget(destination, found.tab);
  const target = existing?.leaf ?? findLeaf(destination, focusedId ?? '') ?? allLeaves(destination)[0];
  return {
    source: remaining,
    destination: existing ? activateTab(destination, existing.tab.id) : addTab(destination, target.id, found.tab),
    focusedId: target.id,
  };
}

/** そのデバイスのリモートデスクトップをタブで開く。すでに開いていれば前に出す */
export function openScreenTab(layout: LayoutNode | null, deviceId: string, focusedId: string | null) {
  if (!layout) {
    const leaf = makeLeaf(makeScreenTab(deviceId));
    return { layout: leaf as LayoutNode, focusedId: leaf.id };
  }
  const existing = findScreenTab(layout, deviceId);
  if (existing) return { layout: activateTab(layout, existing.tab.id), focusedId: existing.leaf.id };
  const target = findLeaf(layout, focusedId ?? '') ?? allLeaves(layout)[0];
  return { layout: addTab(layout, target.id, makeScreenTab(deviceId)), focusedId: target.id };
}
