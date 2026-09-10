/**
 * ウィンドウ 1 つを画面に出すときの言い方を 1 か所にまとめる。
 *
 * サイドバーの行・タブ・切り替えパレットが別々に組み立てていると、
 * 同じウィンドウが場所によって違う名前で出て見比べられなくなる。
 */
import { shortPath, subPath } from './paths';
import { windowStatus, type WindowStatus } from './status';
import type { Pane, Session, TmuxWindow } from './types';

export interface WindowView {
  win: TmuxWindow;
  /** そのウィンドウを代表するペイン。アクティブなもの、無ければ先頭 */
  lead: Pane | null;
  /** 見出しの主役。作業ディレクトリのリポジトリ名（無ければディレクトリ名） */
  project: string;
  /** プロジェクトルートより下にいるときの相対パス */
  rel: string;
  /** 行の主役。端末タイトル、無ければウィンドウ名 */
  primary: string;
  /** tmux 側の居場所（`1:claude`） */
  where: string;
  fullPath: string;
  command: string;
  status: WindowStatus;
}

/** ウィンドウ id → そのウィンドウのペイン（セッションをまたいで重複して届くので id で畳む） */
export function groupPanes(panes: Pane[]): Map<string, Pane[]> {
  const map = new Map<string, Map<string, Pane>>();
  for (const p of panes) {
    let inner = map.get(p.windowId);
    if (!inner) map.set(p.windowId, (inner = new Map()));
    inner.set(p.id, p);
  }
  return new Map([...map].map(([id, inner]) => [id, [...inner.values()]]));
}

export function leadPaneOf(list: Pane[]): Pane | null {
  return list.find((p) => p.active) ?? [...list].sort((a, b) => a.index - b.index)[0] ?? null;
}

export function buildWindowViews(
  windows: TmuxWindow[],
  panes: Pane[],
  home: string,
  now: number,
): Map<string, WindowView> {
  const byWindow = groupPanes(panes);
  const out = new Map<string, WindowView>();
  for (const win of windows) {
    const list = byWindow.get(win.id) ?? [];
    const lead = leadPaneOf(list);
    const full = lead?.path ?? '';
    out.set(win.id, {
      win,
      lead,
      project: lead?.project?.name || shortPath(full, home),
      rel: lead?.project ? subPath(full, lead.project.root) : '',
      primary: lead?.title?.trim() || win.name,
      where: `${win.index}:${win.name}`,
      fullPath: full,
      command: lead?.command ?? '',
      status: windowStatus(win, list, now),
    });
  }
  return out;
}

/** タブやパレットの補足行。セッション名がプロジェクト名と同じなら繰り返さない */
export function whereWithSession(view: WindowView, session: Session | null): string {
  return [view.where, session && session.name !== view.project ? session.name : '']
    .filter(Boolean)
    .join(' · ');
}
