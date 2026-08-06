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

  useEffect(() => {
    // 開いた直後に操作できるようフォーカスを移す
    (spec.kind === 'prompt' ? inputRef.current : confirmRef.current)?.focus();
    inputRef.current?.select();
  }, [spec.kind]);

  const submit = () => {
    onClose();
    spec.onSubmit(value);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Enter' && spec.kind === 'confirm') submit();
        }}
      >
        <h2 className="dialog-title">{spec.title}</h2>
        {spec.detail && <p className="dialog-detail">{spec.detail}</p>}

        {spec.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="dialog-input"
            value={value}
            placeholder={spec.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
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
    </div>
  );
}
