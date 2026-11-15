import { Modal } from './Modal';
import { commandShortcuts } from '../commands';

/**
 * 登録表のヒントに載らない、キーとマウスの操作。
 * どれもメニューには出ないので、ここに書いておかないと見つけられない。
 */
const OTHER_SHORTCUTS: { label: string; keys: string }[] = [
  { label: '探す・操作（端末）', keys: 'Alt+P' },
  { label: '探す・操作（操作）', keys: 'Alt+Shift+P' },
  { label: 'ショートカット一覧', keys: 'Alt+/' },
  { label: '一覧を開く / 閉じる', keys: 'Alt+B' },
  { label: '入力先のパネルの n 番目のタブ', keys: 'Alt+1〜9' },
  { label: '入力先のパネルの最後のタブ', keys: 'Alt+0' },
  { label: '前のタブ / 次のタブ', keys: 'Alt+[ / Alt+]' },
  { label: '新しいワークスペース', keys: 'Alt+Shift+N' },
  { label: '前 / 次のワークスペース', keys: 'Alt+Shift+← / →' },
  { label: '文字サイズを変える', keys: 'Ctrl+ホイール' },
  { label: 'タブを閉じる', keys: 'タブを中クリック' },
  { label: 'ワークスペースの名前を変える', keys: 'ワークスペースをダブルクリック' },
  { label: '端末の文字を選ぶ（tmux がマウスを使っているとき）', keys: 'Shift+ドラッグ' },
  { label: 'ブラウザの右クリックメニューを出す', keys: 'Shift+右クリック' },
  { label: '選択をコピー', keys: 'Ctrl+Shift+C' },
];

/** ショートカット一覧（Alt+/）。commands.ts の hint から作り、隠れた操作を足す */
export function Shortcuts({ altKeys, onClose }: { altKeys: boolean; onClose(): void }) {
  // 同じキーの操作（Alt+T の『新しい端末をタブで開く』と『現在のデバイスで端末を開く』など）は最初の 1 つだけ
  const seen = new Set<string>();
  const fromCommands = commandShortcuts().filter(s => !seen.has(s.keys) && !!seen.add(s.keys));
  const rows = [...fromCommands, ...OTHER_SHORTCUTS.filter(s => !seen.has(s.keys))];
  return (
    <Modal title="ショートカット一覧" className="shortcuts-modal" onClose={onClose}>
      {!altKeys && <p className="shortcuts-note">Alt ショートカットはオフです。Alt キーはそのまま端末に届きます。</p>}
      <div className="shortcuts-body">
      <table className="shortcuts-table">
        <tbody>
          {rows.map(s => (
            <tr key={s.label + s.keys} className={!altKeys && s.keys.startsWith('Alt') ? 'off' : undefined}>
              <td>{s.label}</td>
              <td><kbd>{s.keys}</kbd></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Modal>
  );
}
