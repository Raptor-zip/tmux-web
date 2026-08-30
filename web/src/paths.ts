/**
 * パスの見せ方をひとつに揃えるための小物。
 * サイドバーとタイルの見出しで別々に書いていると、同じディレクトリが
 * 片方では `~/src/foo`、もう片方では `foo` と出て見比べられなくなる。
 */
import type { Pane } from './types';

/** 表示用にパスを縮める。ホーム直下なら `~`、それ以外は末尾のディレクトリ名 */
export function shortPath(path: string, home: string): string {
  if (!path) return '';
  if (path === home) return '~';
  const leaf = path.replace(/\/+$/, '').split('/').pop();
  return leaf || path;
}

/** ホームを `~` に畳んだフルパス。見出しの補足とツールチップに使う */
export function tildePath(path: string, home: string): string {
  if (!path) return '';
  return home && path.startsWith(home) ? '~' + path.slice(home.length) : path;
}

/** プロジェクトのルートより下にいるときだけ、その相対パスを返す */
export function subPath(full: string, root: string): string {
  if (!full || !root || full === root || !full.startsWith(root + '/')) return '';
  return full.slice(root.length + 1);
}

/**
 * そのペインが「どのプロジェクトにいるか」の表示名。
 * リポジトリが見つからなければ作業ディレクトリの名前で代用する。
 * 一覧でも見出しでも、まずこの名前を出す。
 */
export function projectName(pane: Pane | null | undefined, home: string): string {
  if (!pane) return '';
  return pane.project?.name || shortPath(pane.path, home);
}
