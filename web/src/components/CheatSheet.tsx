import { useEffect, useMemo, useState } from 'react';
import { fetchKeys } from '../api';
import type { KeyBinding } from '../types';

/** tmux コマンド名 → 日本語の説明。ここにあるものを優先して上に並べる */
const DESCRIPTIONS: Record<string, string> = {
  'new-window': '新しいウィンドウを作る',
  'kill-window': 'ウィンドウを閉じる',
  'kill-pane': 'ペインを閉じる',
  'split-window': 'ペインを分割する',
  'select-pane': 'ペインを選ぶ',
  'select-window': 'ウィンドウを選ぶ',
  'next-window': '次のウィンドウへ',
  'previous-window': '前のウィンドウへ',
  'last-window': '直前のウィンドウへ戻る',
  'rename-window': 'ウィンドウ名を変更',
  'rename-session': 'セッション名を変更',
  'resize-pane': 'ペインの大きさを変える',
  'copy-mode': 'コピーモードに入る（スクロール／選択）',
  'paste-buffer': '貼り付け',
  'detach-client': 'デタッチ（tmux から抜ける）',
  'choose-tree': 'セッション／ウィンドウの一覧を出す',
  'command-prompt': 'tmux コマンドを直接入力',
  'list-keys': 'キーバインド一覧',
  'display-panes': 'ペイン番号を表示',
  'break-pane': 'ペインを別ウィンドウに切り出す',
  'swap-pane': 'ペインを入れ替える',
  'next-layout': 'レイアウトを切り替える',
  'refresh-client': '画面を再描画',
  'clock-mode': '時計を表示',
};

const WEB_EQUIVALENTS: { task: string; tmuxKey: string; here: string }[] = [
  { task: 'ウィンドウを作る', tmuxKey: 'prefix c', here: 'タブ列の ＋（Alt+T）' },
  { task: 'ウィンドウを切り替える', tmuxKey: 'prefix 0-9 / n / p', here: 'タブをクリック（Alt+1〜9 / Alt+[ ]）' },
  { task: 'ウィンドウを探す', tmuxKey: 'prefix w', here: '切り替えパレット（Alt+P）' },
  { task: 'ウィンドウを閉じる', tmuxKey: 'prefix &', here: 'タブを右クリック →「ウィンドウを閉じる」' },
  { task: '画面を割って並べる', tmuxKey: 'prefix % / prefix "', here: '上部バーの分割、またはタブを端末の端へドラッグ' },
  { task: 'ペインを縦に割る', tmuxKey: 'prefix %', here: '端末を右クリック →「tmux のペインとして分割（左右）」' },
  { task: 'ペインを移動する', tmuxKey: 'prefix ←↑↓→', here: '端末の中で移りたいペインをクリック' },
  { task: 'ペインをズーム', tmuxKey: 'prefix z', here: '端末を右クリック →「ペインを全画面」' },
  { task: 'ペインを閉じる', tmuxKey: 'prefix x', here: '端末を右クリック →「ペインを閉じる」' },
  { task: '名前を変える', tmuxKey: 'prefix , / prefix $', here: 'サイドバーで名前をダブルクリック' },
  { task: '画面の中身をコピー', tmuxKey: 'prefix [ → 選択 → Enter', here: 'ドラッグで選択（そのままクリップボードへ）' },
  { task: 'デタッチ', tmuxKey: 'prefix d', here: 'ブラウザのタブを閉じるだけ' },
];

/** ブラウザ側のショートカット。Alt 系は tmux に渡さずアプリが受け取る */
const APP_KEYS: { key: string; what: string }[] = [
  { key: 'Alt+1 〜 Alt+9', what: 'そのタイルの n 枚目のタブへ' },
  { key: 'Alt+0', what: '右端のタブへ' },
  { key: 'Alt+[ / Alt+]', what: '前 / 次のタブへ' },
  { key: 'Alt+T', what: '新しい端末をタブで開く' },
  { key: 'Alt+W', what: 'いまのタブを閉じる' },
  { key: 'Alt+P', what: 'ウィンドウ切り替えパレット' },
  { key: 'Alt+B', what: 'サイドバーの開閉' },
  { key: 'Alt+/', what: 'このチートシート' },
  { key: 'Ctrl+Shift+C', what: '選択部分をコピー（Ctrl+C は tmux に渡す）' },
  { key: 'Shift+右クリック', what: 'ブラウザ本来のメニュー' },
];

export function CheatSheet({ onClose, prefix }: { onClose(): void; prefix: string }) {
  const [keys, setKeys] = useState<KeyBinding[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetchKeys('prefix')
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys([]));
  }, []);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const scored = keys.map((k) => {
      const cmdName = k.command.split(/\s+/)[0];
      return { ...k, cmdName, desc: DESCRIPTIONS[cmdName] ?? '' };
    });
    const filtered = q
      ? scored.filter(
          (k) =>
            k.key.toLowerCase().includes(q) ||
            k.command.toLowerCase().includes(q) ||
            k.desc.includes(q),
        )
      : scored;
    return filtered.sort((a, b) => {
      if (Boolean(a.desc) !== Boolean(b.desc)) return a.desc ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }, [keys, filter]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>tmux チートシート</h2>
          <button className="btn ghost" onClick={onClose}>
            閉じる
          </button>
        </header>

        <div className="modal-body">
          <section>
            <h3>この画面ならキーを覚えなくていい</h3>
            <table className="sheet">
              <thead>
                <tr>
                  <th>やりたいこと</th>
                  <th>素の tmux</th>
                  <th>この画面での操作</th>
                </tr>
              </thead>
              <tbody>
                {WEB_EQUIVALENTS.map((r) => (
                  <tr key={r.task}>
                    <td>{r.task}</td>
                    <td>
                      <code>{r.tmuxKey.replace(/prefix/g, prefix)}</code>
                    </td>
                    <td className="hl">{r.here}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>この画面のキーボードショートカット</h3>
            <table className="sheet">
              <tbody>
                {APP_KEYS.map((r) => (
                  <tr key={r.key}>
                    <td className="keycell">
                      <code>{r.key}</code>
                    </td>
                    <td>{r.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>
              いま設定されているキーバインド <span className="dim">(prefix = {prefix})</span>
            </h3>
            <input
              className="filter-input"
              placeholder="キーやコマンドで絞り込む…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <table className="sheet keys">
              <tbody>
                {rows.map((k, i) => (
                  <tr key={`${k.key}-${i}`}>
                    <td className="keycell">
                      <code>
                        {prefix} {k.key}
                      </code>
                    </td>
                    <td>{k.desc || <span className="dim">{k.cmdName}</span>}</td>
                    <td className="dim mono">{k.command}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="dim">
                      該当なし
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
