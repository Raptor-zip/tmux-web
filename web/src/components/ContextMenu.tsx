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
    /**
     * メニューの外を押したら閉じる。
     * capture で拾うので、中を押したかどうかは自分で見分ける必要がある。
     * ここで無条件に閉じると、pointerdown の時点でメニューが消えてしまい、
     * 続く click が項目に届かない＝どれを押しても何も起きない、になる。
     */
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onClose);
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
