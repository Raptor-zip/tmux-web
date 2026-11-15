import { Modal } from './Modal';
import { useEffect, useRef, useState } from 'react';

export interface DialogSpec {
  kind: 'confirm' | 'prompt';
  title: string;
  detail?: string;
  /** prompt のとき: 入力欄の初期値とプレースホルダ */
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  danger?: boolean;
  onSubmit(value: string): void;
}

/**
 * ブラウザ標準の confirm() / prompt() の置き換え。
 * 標準ダイアログはページのスクリプトを丸ごと止めてしまい、見た目もアプリから浮くので使わない。
 */
export function Dialog({ spec, onClose }: { spec: DialogSpec; onClose(): void }) {
  const [value, setValue] = useState(spec.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 開いた直後に操作できるようフォーカスを移す。
    // 取り返しのつかない確認（danger）はキャンセルに置き、Enter の押しっぱなしや
    // 続けざまのキー入力でそのまま実行されないようにする。
    const target = spec.kind === 'prompt' ? inputRef.current : spec.danger ? cancelRef.current : confirmRef.current;
    target?.focus();
    inputRef.current?.select();
  }, [spec.kind, spec.danger]);

  const submit = () => {
    onClose();
    spec.onSubmit(value);
  };

  return (
    <Modal title={spec.title} onClose={onClose} className="prompt-dialog">
      <div className="dialog-content">
        {spec.detail && <p className="dialog-detail">{spec.detail}</p>}

        {spec.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="dialog-input"
            value={value}
            placeholder={spec.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') submit();
            }}
          />
        )}

        <div className="dialog-actions">
          <button ref={cancelRef} className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            ref={confirmRef}
            className={`btn ${spec.danger ? 'danger solid' : 'primary'}`}
            onClick={submit}
          >
            {spec.confirmLabel ?? (spec.danger ? '削除する' : 'OK')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
