import { Modal } from './Modal';
import { shortcutRows } from '../commands';

/** ショートカット一覧（Alt+/）。commands.ts の hint から作り、隠れた操作を足す */
export function Shortcuts({ altKeys, onClose }: { altKeys: boolean; onClose(): void }) {
  const rows = shortcutRows();
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
