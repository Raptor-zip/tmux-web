/**
 * 画面の配置を二分木で持つ。
 *
 * 葉（タイル）は 1 枚の端末ではなく「タブの束」で、そのうち 1 つを前面に出す。
 * ブラウザや VS Code と同じで、いくつ開いても場所を取らず、並べて比べたいときだけ
 * タイルを増やす。
 *
 * 木のままレンダリングするとタイルの DOM 上の位置が分割のたびに変わり、
 * React が Terminal を作り直して tmux に繋ぎ直してしまう。そこで木からは
 * 「各タイルの矩形（%）」だけを計算し、描画側はフラットな絶対配置にする。
 */

/** タブ 1 枚 = tmux のウィンドウ 1 つ */
export interface TabRef {
  id: string;
  sessionId: string;
  /** null ならそのセッションのアクティブウィンドウを映す */
  windowId: string | null;
  /**
   * 繋ぎ直し用の目印。tmux を再起動すると $1 や @3 といった id は全部振り直されるので、
   * id だけを保存していても復元できない。名前と番号を一緒に覚えておき、
   * サーバが入れ替わったときはこちらを頼りに同じ配置へ戻す。
   */
  sessionName?: string;
  windowName?: string;
  windowIndex?: number;
}

/** タイル = タブの束。activeId が前面のタブ */
export interface LeafNode {
  type: 'leaf';
  id: string;
  tabs: TabRef[];
  activeId: string;
}

export interface SplitNode {
  type: 'split';
  id: string;
  /** row = 左右に並ぶ / column = 上下に並ぶ */
  dir: 'row' | 'column';
  /** a が占める割合 (0.1〜0.9) */
  ratio: number;
  a: LayoutNode;
  b: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type DropSide = 'left' | 'right' | 'top' | 'bottom' | 'center';

export const FULL: Rect = { left: 0, top: 0, width: 100, height: 100 };

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function makeTab(sessionId: string, windowId: string | null): TabRef {
  return { id: newId('w'), sessionId, windowId };
}

export function makeLeaf(tabs: TabRef | TabRef[]): LeafNode {
  const list = Array.isArray(tabs) ? tabs : [tabs];
  return { type: 'leaf', id: newId('t'), tabs: list, activeId: list[0].id };
}

// ------------------------------------------------------------------ 参照する

export function allLeaves(node: LayoutNode): LeafNode[] {
  return node.type === 'leaf' ? [node] : [...allLeaves(node.a), ...allLeaves(node.b)];
}

export function allTabs(node: LayoutNode): Array<{ leaf: LeafNode; tab: TabRef }> {
  return allLeaves(node).flatMap((leaf) => leaf.tabs.map((tab) => ({ leaf, tab })));
}

/** 前面に出ているタブ。activeId が壊れていても先頭にフォールバックする */
export function activeTab(leaf: LeafNode): TabRef | null {
  return leaf.tabs.find((t) => t.id === leaf.activeId) ?? leaf.tabs[0] ?? null;
}

export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  return allLeaves(node).find((l) => l.id === id) ?? null;
}

export function findTab(
  node: LayoutNode,
  tabId: string,
): { leaf: LeafNode; tab: TabRef } | null {
  return allTabs(node).find((x) => x.tab.id === tabId) ?? null;
}

/**
 * そのタブが「何を映しているか」を表す鍵。
 * windowId が null のタブはセッションのアクティブウィンドウを映すので、
 * 同じセッションの null 同士も同じものを映していることになる。
 */
export function targetKey(tab: Pick<TabRef, 'sessionId' | 'windowId'>): string {
  return `${tab.sessionId}:${tab.windowId ?? '*'}`;
}

/** 同じものを映しているタブを探す。except は自分自身を除くため */
export function findByTarget(
  tree: LayoutNode,
  sessionId: string,
  windowId: string | null,
  exceptTabId?: string | null,
): { leaf: LeafNode; tab: TabRef } | null {
  const key = targetKey({ sessionId, windowId });
  return (
    allTabs(tree).find((x) => x.tab.id !== exceptTabId && targetKey(x.tab) === key) ?? null
  );
}

// ------------------------------------------------------------------ 書き換える

/**
 * 葉ごとに書き換える。null を返すとその葉は消え、親の分割も畳まれる。
 * 変化が無ければ同じ木をそのまま返すので、状態更新のループにはならない。
 */
function mapLeaves(
  node: LayoutNode,
  fn: (leaf: LeafNode) => LeafNode | null,
): LayoutNode | null {
  if (node.type === 'leaf') return fn(node);
  const a = mapLeaves(node.a, fn);
  const b = mapLeaves(node.b, fn);
  if (!a) return b;
  if (!b) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** タブが 1 枚も無い葉は消し、activeId が迷子なら先頭に寄せる */
function settle(leaf: LeafNode): LeafNode | null {
  if (leaf.tabs.length === 0) return null;
  if (leaf.tabs.some((t) => t.id === leaf.activeId)) return leaf;
  return { ...leaf, activeId: leaf.tabs[0].id };
}

/** before に指定したタブの手前に差し込む（null なら末尾）。差し込んだタブを前面にする */
export function addTab(
  tree: LayoutNode,
  leafId: string,
  tab: TabRef,
  before: string | null = null,
): LayoutNode {
  const next = mapLeaves(tree, (leaf) => {
    if (leaf.id !== leafId) return leaf;
    const at = before ? leaf.tabs.findIndex((t) => t.id === before) : -1;
    const tabs =
      at < 0
        ? [...leaf.tabs, tab]
        : [...leaf.tabs.slice(0, at), tab, ...leaf.tabs.slice(at)];
    return { ...leaf, tabs, activeId: tab.id };
  });
  return next ?? tree;
}

export function activateTab(tree: LayoutNode, tabId: string): LayoutNode {
  const next = mapLeaves(tree, (leaf) =>
    leaf.activeId !== tabId && leaf.tabs.some((t) => t.id === tabId)
      ? { ...leaf, activeId: tabId }
      : leaf,
  );
  return next ?? tree;
}

/**
 * タブを閉じる。最後の 1 枚を閉じたタイルは畳まれ、
 * 木ごと空になったら null（＝何も開いていない状態）になる。
 *
 * 隣のどれを前面に出すかは「右隣、無ければ左隣」。ブラウザのタブと同じ動きにして、
 * まとめて閉じるときに手が止まらないようにする。
 */
export function closeTab(tree: LayoutNode, tabId: string): LayoutNode | null {
  return mapLeaves(tree, (leaf) => {
    const at = leaf.tabs.findIndex((t) => t.id === tabId);
    if (at < 0) return leaf;
    const tabs = leaf.tabs.filter((t) => t.id !== tabId);
    if (tabs.length === 0) return null;
    const activeId =
      leaf.activeId === tabId ? (tabs[at] ?? tabs[tabs.length - 1]).id : leaf.activeId;
    return { ...leaf, tabs, activeId };
  });
}

export function closeTabs(tree: LayoutNode, ids: string[]): LayoutNode | null {
  let next: LayoutNode | null = tree;
  for (const id of ids) {
    if (!next) break;
    next = closeTab(next, id);
  }
  return next;
}

/** タブを別のタイルへ、または同じタイルの別の位置へ移す */
export function moveTab(
  tree: LayoutNode,
  tabId: string,
  toLeafId: string,
  before: string | null = null,
): LayoutNode {
  const found = findTab(tree, tabId);
  if (!found) return tree;
  if (found.leaf.id === toLeafId) {
    // 自分自身の手前に落とした = 動かさない
    if (before === tabId) return tree;
    const next = mapLeaves(tree, (leaf) => {
      if (leaf.id !== toLeafId) return leaf;
      const rest = leaf.tabs.filter((t) => t.id !== tabId);
      const at = before ? rest.findIndex((t) => t.id === before) : -1;
      const tabs =
        at < 0 ? [...rest, found.tab] : [...rest.slice(0, at), found.tab, ...rest.slice(at)];
      return { ...leaf, tabs, activeId: tabId };
    });
    return next ?? tree;
  }
  const base = closeTab(tree, tabId);
  if (!base) return makeLeaf(found.tab);
  if (!findLeaf(base, toLeafId)) return base;
  return addTab(base, toLeafId, found.tab, before);
}

/** タイルの指定した辺に、そのタブだけを持つ新しいタイルを差し込む */
export function splitWithTab(
  tree: LayoutNode,
  targetLeafId: string,
  side: Exclude<DropSide, 'center'>,
  tab: TabRef,
): { tree: LayoutNode; leafId: string } {
  const leaf = makeLeaf(tab);
  const dir: 'row' | 'column' = side === 'left' || side === 'right' ? 'row' : 'column';
  const first = side === 'left' || side === 'top';
  const next = mapTree(tree, (node) =>
    node.id !== targetLeafId
      ? node
      : {
          type: 'split',
          id: newId('s'),
          dir,
          ratio: 0.5,
          a: first ? leaf : node,
          b: first ? node : leaf,
        },
  );
  return { tree: next, leafId: leaf.id };
}

/** タイルごと閉じる（中のタブは全部閉じる） */
export function removeLeaf(tree: LayoutNode, leafId: string): LayoutNode | null {
  return mapLeaves(tree, (leaf) => (leaf.id === leafId ? null : leaf));
}

export function setRatio(tree: LayoutNode, splitId: string, ratio: number): LayoutNode {
  return mapTree(tree, (node) =>
    node.id === splitId && node.type === 'split'
      ? { ...node, ratio: Math.min(0.9, Math.max(0.1, ratio)) }
      : node,
  );
}

function mapTree(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  const replaced = fn(node);
  if (replaced !== node) return replaced;
  if (node.type === 'leaf') return node;
  const a = mapTree(node.a, fn);
  const b = mapTree(node.b, fn);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/**
 * 同じものを映すタブが 2 枚以上あれば 1 枚に畳む。
 * 同じ端末が並んでいても情報は増えず、どちらを操作しているのか分からなくなるだけ。
 * keepId を渡すと、その 1 枚を残す（いま選んだタブを消さないため）。
 *
 * ウィンドウが決まっていないタブ（windowId が null）は畳まない。同じセッションの
 * アクティブウィンドウを映すので見た目は同じだが、これは繋ぎ直しに失敗したタブが
 * 一時的に取る形でもある。ここで畳むと、行き先を見失っただけのタブが
 * タイルごと消えてしまい、再起動のたびに配置が痩せていく。
 */
export function dedupeTabs(tree: LayoutNode, keepId?: string | null): LayoutNode | null {
  const tabs = allTabs(tree).map((x) => x.tab).filter((t) => t.windowId !== null);
  const keep = new Map<string, string>();
  for (const tab of tabs) {
    const key = targetKey(tab);
    if (!keep.has(key) || tab.id === keepId) keep.set(key, tab.id);
  }
  const drop = tabs.filter((tab) => keep.get(targetKey(tab)) !== tab.id).map((t) => t.id);
  return drop.length === 0 ? tree : closeTabs(tree, drop);
}

// -------------------------------------------------------------- 矩形を求める

/** 各タイルの矩形を % で返す */
export function leafRects(
  node: LayoutNode,
  rect: Rect = FULL,
): Array<{ leaf: LeafNode; rect: Rect }> {
  if (node.type === 'leaf') return [{ leaf: node, rect }];
  const [ra, rb] = splitRect(rect, node.dir, node.ratio);
  return [...leafRects(node.a, ra), ...leafRects(node.b, rb)];
}

/** 分割線の位置。ドラッグで比率を変えるためのつまみを置く場所 */
export function dividers(
  node: LayoutNode,
  rect: Rect = FULL,
): Array<{ id: string; dir: 'row' | 'column'; rect: Rect; parent: Rect }> {
  if (node.type === 'leaf') return [];
  const [ra, rb] = splitRect(rect, node.dir, node.ratio);
  const line: Rect =
    node.dir === 'row'
      ? { left: ra.left + ra.width, top: rect.top, width: 0, height: rect.height }
      : { left: rect.left, top: ra.top + ra.height, width: rect.width, height: 0 };
  return [
    { id: node.id, dir: node.dir, rect: line, parent: rect },
    ...dividers(node.a, ra),
    ...dividers(node.b, rb),
  ];
}

function splitRect(rect: Rect, dir: 'row' | 'column', ratio: number): [Rect, Rect] {
  if (dir === 'row') {
    const w = rect.width * ratio;
    return [
      { ...rect, width: w },
      { ...rect, left: rect.left + w, width: rect.width - w },
    ];
  }
  const h = rect.height * ratio;
  return [
    { ...rect, height: h },
    { ...rect, top: rect.top + h, height: rect.height - h },
  ];
}

/**
 * タイル上のどこにドロップしようとしているかを、カーソルの相対位置から決める。
 * 外周 30% が上下左右、中央はタブとして追加。
 */
export function dropSideFor(x: number, y: number, w: number, h: number): DropSide {
  const fx = x / w;
  const fy = y / h;
  const edge = 0.3;
  const distances: Array<[DropSide, number]> = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  distances.sort((p, q) => p[1] - q[1]);
  const [side, dist] = distances[0];
  return dist < edge ? side : 'center';
}

// ------------------------------------------------------- 保存した配置の手入れ

interface NameSource {
  sessions: Array<{ id: string; name: string }>;
  windows: Array<{ id: string; sessionId: string; index: number; name: string }>;
}

/**
 * いま繋がっているセッション／ウィンドウの名前をタブに焼き込む。
 * これを毎回やっておかないと、tmux が落ちてから名前を引く先が無くなる。
 */
export function stampNames(tree: LayoutNode, { sessions, windows }: NameSource): LayoutNode {
  const next = mapLeaves(tree, (leaf) => {
    let changed = false;
    const tabs = leaf.tabs.map((tab) => {
      const session = sessions.find((s) => s.id === tab.sessionId);
      const win = tab.windowId ? windows.find((w) => w.id === tab.windowId) : null;
      const stamped: TabRef = {
        ...tab,
        sessionName: session?.name ?? tab.sessionName,
        windowName: win?.name ?? tab.windowName,
        windowIndex: win?.index ?? tab.windowIndex,
      };
      const same =
        stamped.sessionName === tab.sessionName &&
        stamped.windowName === tab.windowName &&
        stamped.windowIndex === tab.windowIndex;
      if (same) return tab;
      changed = true;
      return stamped;
    });
    return changed ? { ...leaf, tabs } : leaf;
  });
  return next ?? tree;
}

/**
 * tmux サーバが入れ替わったあとの繋ぎ直し。id が通じなくなっているので、
 * 覚えておいた名前（同名が複数あるときは番号）で同じウィンドウを探し直す。
 *
 * 探す順番は名前が先で、id は当てにしない。tmux の id は 0 番から振り直されるので、
 * 入れ替わったあとの `$0` は前の `$0` とは別のセッションになる。ここで id を先に見ると、
 * 覚えていた配置が丸ごと別のセッションに繋がってしまう（実際にそうなっていた）。
 * 名前を覚えていないタブ（名前を焼き込む前に保存された古い配置）だけ id を頼る。
 *
 * ・セッションが見つからないタブは落とす（復元の対象が無い）
 * ・セッションは見つかるがウィンドウが見つからないタブは残し、windowId を null にして
 *   そのセッションのアクティブウィンドウを映す。配置だけでも保つほうが混乱が少ない。
 * ・同じウィンドウを 2 枚のタブが取り合わないよう、割り当て済みは避ける。
 *   それでも同じものを映す 2 枚が残ったら、あとで dedupeTabs が 1 枚に畳む。
 */
export function remapByName(tree: LayoutNode, src: NameSource): LayoutNode | null {
  const { sessions, windows } = src;
  const used = new Set<string>();
  /** 前の id → 今の id。同じウィンドウを映していた 2 枚は繋ぎ直しても同じものを映す */
  const mapped = new Map<string, string>();

  const resolve = (tab: TabRef): TabRef | null => {
    const session = tab.sessionName
      ? sessions.find((s) => s.name === tab.sessionName)
      : sessions.find((s) => s.id === tab.sessionId);
    if (!session) return null;

    const inSession = windows.filter((w) => w.sessionId === session.id);
    // 同じウィンドウを映していたタブ同士は、繋ぎ直しても同じウィンドウを映す
    const already = tab.windowId ? mapped.get(tab.windowId) : undefined;
    const candidates = tab.windowName
      ? inSession.filter((w) => w.name === tab.windowName && !used.has(w.id))
      : [];
    // 名前と番号が両方合うものが最有力。次が番号だけ、最後が名前だけ。
    // 再起動すると、中で動いていたプロセスが戻らない窓は名前が変わる（claude → bash）。
    // 名前が同じ窓は何十枚もあるのに番号は resurrect が保つので、名前より番号が当てになる。
    // 名前を先に見ていたせいで、別の窓を掴んだタブが正しい窓を奪い、
    // 奪われたタブは行き先を失って（windowId が null）タイルごと消えていた。
    const byNameIndex = candidates.find((w) => w.index === tab.windowIndex);
    const byIndex =
      tab.windowIndex !== undefined
        ? inSession.find((w) => w.index === tab.windowIndex && !used.has(w.id))
        : undefined;
    const byName = candidates[0];
    // 名前も番号も覚えていない古い配置だけ、最後の手段として id を見る
    const byId =
      tab.windowName === undefined && tab.windowIndex === undefined && tab.windowId
        ? inSession.find((w) => w.id === tab.windowId)
        : undefined;

    // windowId が null のタブ（セッションのアクティブを映す）はそのままにする
    const win = tab.windowId
      ? (already ? inSession.find((w) => w.id === already) : undefined) ??
        byNameIndex ??
        byIndex ??
        byName ??
        byId ??
        null
      : null;
    if (win) {
      used.add(win.id);
      if (tab.windowId) mapped.set(tab.windowId, win.id);
    }

    return {
      ...tab,
      sessionId: session.id,
      sessionName: session.name,
      windowId: win?.id ?? null,
      windowName: win?.name ?? tab.windowName,
      windowIndex: win?.index ?? tab.windowIndex,
    };
  };

  return mapLeaves(tree, (leaf) => {
    let changed = false;
    const tabs: TabRef[] = [];
    for (const tab of leaf.tabs) {
      const next = resolve(tab);
      if (!next) {
        changed = true;
        continue;
      }
      const same =
        next.sessionId === tab.sessionId &&
        next.windowId === tab.windowId &&
        next.sessionName === tab.sessionName &&
        next.windowName === tab.windowName &&
        next.windowIndex === tab.windowIndex;
      if (!same) changed = true;
      tabs.push(same ? tab : next);
    }
    return changed ? settle({ ...leaf, tabs }) : leaf;
  });
}

/** localStorage から読んだ木が今の tmux の状態とずれていないか確かめる */
export function pruneStale(tree: LayoutNode, validSessionIds: Set<string>): LayoutNode | null {
  return mapLeaves(tree, (leaf) => {
    const tabs = leaf.tabs.filter((t) => validSessionIds.has(t.sessionId));
    return tabs.length === leaf.tabs.length ? leaf : settle({ ...leaf, tabs });
  });
}

/**
 * localStorage に残っている古い形（1 タイル = 1 ウィンドウ）をタブの形に読み替える。
 * 保存キーを変えて捨ててしまうと、開いていた配置が一度だけ消える。
 */
export function migrate(raw: unknown): LayoutNode | null {
  const walk = (node: unknown): LayoutNode | null => {
    if (!node || typeof node !== 'object') return null;
    const n = node as Record<string, unknown>;
    if (n.type === 'split') {
      const a = walk(n.a);
      const b = walk(n.b);
      if (!a) return b;
      if (!b) return a;
      return {
        type: 'split',
        id: typeof n.id === 'string' ? n.id : newId('s'),
        dir: n.dir === 'column' ? 'column' : 'row',
        ratio: typeof n.ratio === 'number' ? n.ratio : 0.5,
        a,
        b,
      };
    }
    if (n.type !== 'leaf') return null;
    if (Array.isArray(n.tabs)) {
      const tabs = (n.tabs as TabRef[]).filter((t) => t && typeof t.sessionId === 'string');
      if (tabs.length === 0) return null;
      return {
        type: 'leaf',
        id: typeof n.id === 'string' ? n.id : newId('t'),
        tabs,
        activeId: tabs.some((t) => t.id === n.activeId) ? String(n.activeId) : tabs[0].id,
      };
    }
    if (typeof n.sessionId !== 'string') return null;
    const tab: TabRef = {
      id: newId('w'),
      sessionId: n.sessionId,
      windowId: typeof n.windowId === 'string' ? n.windowId : null,
      sessionName: typeof n.sessionName === 'string' ? n.sessionName : undefined,
      windowName: typeof n.windowName === 'string' ? n.windowName : undefined,
      windowIndex: typeof n.windowIndex === 'number' ? n.windowIndex : undefined,
    };
    return { type: 'leaf', id: typeof n.id === 'string' ? n.id : newId('t'), tabs: [tab], activeId: tab.id };
  };
  return walk(raw);
}
