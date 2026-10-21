import { isMirrorSession } from './attach.js';

// グループを共有するセッションを 1 つにまとめるか。TMUX_WEB_SHOW_GROUP_VIEWS=1 で無効
const COLLAPSE_GROUPS = process.env.TMUX_WEB_SHOW_GROUP_VIEWS !== '1';

/**
 * 画面に出す分だけに絞る。
 *
 * - ミラー（`webmux-*`）は隠す。tmux-web が attach のために作る内部的なもの。
 * - グループを共有するセッションは 1 つだけ残す。tmux のグループはウィンドウを
 *   共有するので、`tmux new-session -t <既存>` で端末ごとに view を作る使い方だと、
 *   同じウィンドウが view の数だけ並んでしまう。中身が同じものを何度も見せない。
 *   残すのはグループ名と同じ名前のもの（＝元のセッション）。無ければいちばん古いもの。
 *
 * ウィンドウとペインはセッションごとに重複して返るので、残したセッションの分だけに揃える。
 */
export function visibleState(state) {
  let sessions = state.sessions.filter((s) => !isMirrorSession(s.name));

  if (COLLAPSE_GROUPS) {
    const keep = new Map(); // グループ名 -> 残すセッション
    // 作成時刻だけで選ぶと、再起動で復元される順番しだいで残るセッションが入れ替わる。
    // ブラウザは配置をセッション名で覚えているので、名前が入れ替わると繋ぎ直せない。
    // グループ名と同じ名前のもの（＝元のセッション）を優先し、無ければ古いほうを残す。
    const better = (s, cur) => {
      if (!cur) return true;
      if ((s.name === s.group) !== (cur.name === cur.group)) return s.name === s.group;
      return s.created < cur.created;
    };
    for (const s of sessions) {
      if (!s.group || s.groupSize <= 1) continue;
      if (better(s, keep.get(s.group))) keep.set(s.group, s);
    }
    const kept = new Set([...keep.values()].map((s) => s.id));
    sessions = sessions.filter((s) => !s.group || s.groupSize <= 1 || kept.has(s.id));
  }

  const ids = new Set(sessions.map((s) => s.id));
  const windows = state.windows.filter((w) => ids.has(w.sessionId));
  const winIds = new Set(windows.map((w) => w.id));
  return {
    ...state,
    sessions,
    windows,
    panes: state.panes.filter((p) => ids.has(p.sessionId) && winIds.has(p.windowId)),
  };
}

/** 取得時刻は状態の変化ではない。 */
export function stateSignature(state) {
  const { ts, ...content } = state;
  return JSON.stringify(content);
}
