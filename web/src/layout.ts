/**
 * 画面分割のレイアウトを二分木で持つ。
 *
 * 木のままレンダリングするとタイルの DOM 上の位置が分割のたびに変わり、
 * React が Terminal を作り直して tmux に繋ぎ直してしまう。そこで木からは
 * 「各タイルの矩形（%）」だけを計算し、描画側はフラットな絶対配置にする。
 */

export interface LeafNode {
  type: 'leaf';
  id: string;
  sessionId: string;
  windowId: string | null;
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

export function makeLeaf(sessionId: string, windowId: string | null): LeafNode {
  return { type: 'leaf', id: newId('t'), sessionId, windowId };
}

export function allLeaves(node: LayoutNode): LeafNode[] {
  return node.type === 'leaf' ? [node] : [...allLeaves(node.a), ...allLeaves(node.b)];
}

export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  if (node.type === 'leaf') return node.id === id ? node : null;
  return findLeaf(node.a, id) ?? findLeaf(node.b, id);
}

/** 各タイルの矩形を % で返す */
export function leafRects(node: LayoutNode, rect: Rect = FULL): Array<{ leaf: LeafNode; rect: Rect }> {
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

/** タイルの指定した辺に新しいタイルを差し込む */
export function splitLeaf(
  tree: LayoutNode,
  targetId: string,
  side: DropSide,
  leaf: LeafNode,
): LayoutNode {
  return mapTree(tree, (node) => {
    if (node.id !== targetId) return node;
    if (side === 'center') return leaf;
    const dir: 'row' | 'column' = side === 'left' || side === 'right' ? 'row' : 'column';
    const first = side === 'left' || side === 'top';
    return {
      type: 'split',
      id: newId('s'),
      dir,
      ratio: 0.5,
      a: first ? leaf : node,
      b: first ? node : leaf,
    };
  });
}

/** タイルが表示するウィンドウを差し替える */
export function retargetLeaf(
  tree: LayoutNode,
  targetId: string,
  sessionId: string,
  windowId: string | null,
): LayoutNode {
  return mapTree(tree, (node) =>
    node.id === targetId && node.type === 'leaf' ? { ...node, sessionId, windowId } : node,
  );
}

/** タイルを閉じる。最後の 1 枚を閉じたら null（＝何も開いていない状態）になる */
export function removeLeaf(tree: LayoutNode, targetId: string): LayoutNode | null {
  const prune = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'leaf') return node.id === targetId ? null : node;
    const a = prune(node.a);
    const b = prune(node.b);
    if (!a) return b;
    if (!b) return a;
    return a === node.a && b === node.b ? node : { ...node, a, b };
  };
  return prune(tree);
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
 * タイル上のどこにドロップしようとしているかを、カーソルの相対位置から決める。
 * 外周 30% が上下左右、中央は差し替え。
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

/** localStorage から読んだ木が今の tmux の状態とずれていないか確かめる */
export function pruneStale(
  tree: LayoutNode,
  validSessionIds: Set<string>,
): LayoutNode | null {
  const walk = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'leaf') return validSessionIds.has(node.sessionId) ? node : null;
    const a = walk(node.a);
    const b = walk(node.b);
    if (!a) return b;
    if (!b) return a;
    return { ...node, a, b };
  };
  return walk(tree);
}
