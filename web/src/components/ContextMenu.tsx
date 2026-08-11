import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  /** 右側に薄く出すキー表記。VS Code のメニューと同じ体裁 */
  hint?: string;
  disabled?: boolean;
  run(): void;
}

/** 区切り線 */
export const SEP = null;
export type MenuEntry = MenuItem | typeof SEP;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose(): void;
}

/**
 * 端末の右クリックで出すメニュー。
 *
 * tmux にも `display-menu` があるが、そちらはマウス報告が届くかどうかに左右され、
 * コピーモード中や TUI がマウスを掴んでいるときは出ない。ブラウザ側で出せば
 * どの状況でも同じように使える（VS Code の端末も自前のメニューを出している）。
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // 画面からはみ出すなら内側に寄せる
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // capture で拾う。メニューの外を押した時点で閉じたい
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="ctxmenu"
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === SEP ? (
          <hr key={`s${i}`} />
        ) : (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.hint && <span className="ctx-key">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
