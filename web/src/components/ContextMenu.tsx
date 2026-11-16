import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  /** 右側に薄く出すキー表記。VS Code のメニューと同じ体裁 */
  hint?: string;
  /** メニューを開いているあいだ、この 1 文字を押すと選ぶ（大文字小文字は区別しない） */
  accel?: string;
  disabled?: boolean;
  /** 押せない理由。項目の下に小さく出し、ツールチップにも付ける */
  disabledReason?: string;
  /** 取り消せない操作 */
  danger?: boolean;
  /**
   * 1 段だけのサブメニュー。サブメニューの中にさらにサブメニューは作らない。
   * マウスでは右に開き、タッチのシートでは同じシートの中で前へ進む（先頭に『‹ 戻る』）。
   */
  submenu?: MenuEntry[];
  /**
   * 行の右に並べる小さなボタン（新規メニューの『右に並べる』『下に並べる』）。
   * 上下の矢印では行の本体だけを移り、→ ← で行の中のボタンへ移る。
   */
  side?: MenuItem[];
  /** 読み上げ用の名前。見た目が短い名前のとき（side のボタン）だけ使う */
  ariaLabel?: string;
  run(): void;
}

/** 段の見出し。押せない */
export interface MenuHeading {
  heading: true;
  label: string;
  disabled?: undefined;
}

/** 区切り線 */
export const SEP = null;
export type MenuEntry = MenuItem | MenuHeading | typeof SEP;

export const isHeading = (entry: MenuEntry): entry is MenuHeading => !!entry && 'heading' in entry;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  /** メニューの見出し（操作の対象。タブ名など） */
  title?: string;
  onClose(): void;
}

/** タッチではメニューを下端のシートで出す（responsive.css と同じ条件） */
const SHEET_QUERY = '(any-pointer:coarse)';
const isSheet = () => typeof window !== 'undefined' && !!window.matchMedia?.(SHEET_QUERY).matches;

const focusable = (root: HTMLElement | null) =>
  [...(root?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled):not([data-side])') ?? [])].filter(b => b.getClientRects().length > 0);

/**
 * アプリ側で出すメニュー（端末の右クリック・タブ・パネル ⋯ など）。
 *
 * tmux にも `display-menu` があるが、そちらはマウス報告が届くかどうかに左右され、
 * コピーモード中や TUI がマウスを掴んでいるときは出ない。ブラウザ側で出せば
 * どの状況でも同じように使える（VS Code の端末も自前のメニューを出している）。
 */
export function ContextMenu({ x, y, items, title, onClose }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sheet] = useState(isSheet);
  /** 開いているサブメニュー（親の項目の位置）。1 段だけ */
  const [sub, setSub] = useState<{ index: number; via: 'key' | 'pointer' } | null>(null);
  const [flyPos, setFlyPos] = useState<{ x: number; y: number } | null>(null);
  const subRef = useRef(sub);
  subRef.current = sub;
  const parentButton = useRef<HTMLButtonElement | null>(null);

  const subItem = sub ? (items[sub.index] as MenuItem | undefined) : undefined;
  const subEntries = subItem?.submenu;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    focusable(ref.current)[0]?.focus();
    return () => { if (document.activeElement === document.body) previous?.focus(); };
  }, []);

  const closeSub = useCallback(() => {
    const index = subRef.current?.index;
    setSub(null);
    setFlyPos(null);
    // シートでは親の一覧に戻ってから、開いた項目へフォーカスを戻す
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`button[data-level="top"][data-index="${index}"]`)?.focus());
  }, []);

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

  // サブメニューを開いたら、その先頭の項目にフォーカスを移す。マウスでは親の右に出す
  useLayoutEffect(() => {
    if (!sub) return;
    if (!sheet) {
      const anchor = parentButton.current?.getBoundingClientRect();
      const el = flyout.current;
      if (anchor && el) {
        const r = el.getBoundingClientRect();
        const right = anchor.right + 2;
        const fx = right + r.width + 4 <= window.innerWidth ? right : Math.max(4, anchor.left - r.width - 2);
        const fy = Math.max(4, Math.min(anchor.top - 4, window.innerHeight - r.height - 4));
        if (!flyPos || flyPos.x !== fx || flyPos.y !== fy) setFlyPos({ x: fx, y: fy });
      }
    }
    if (sub.via === 'key' || sheet) {
      const list = focusable(sheet ? ref.current : flyout.current);
      // シートの先頭は『‹ 戻る』なので、その次（サブメニューの最初の項目）に当てる
      (sheet ? list[1] ?? list[0] : list[0])?.focus();
    }
  }, [sub, sheet, flyPos]);

  useEffect(() => {
    /**
     * メニューの外を押したら閉じる。
     * capture で拾うので、中を押したかどうかは自分で見分ける必要がある。
     * ここで無条件に閉じると、pointerdown の時点でメニューが消えてしまい、
     * 続く click が項目に届かない＝どれを押しても何も起きない、になる。
     */
    const onDown = (e: PointerEvent) => {
      if (layer.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // サブメニューを開いているときは、1 段だけ戻る
      if (subRef.current) { e.preventDefault(); closeSub(); return; }
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, closeSub]);

  const activate = (item: MenuItem, index: number | null, button: HTMLButtonElement | null, via: 'key' | 'pointer') => {
    if (item.disabled) return;
    if (item.submenu && index !== null) {
      parentButton.current = button;
      // マウスでは乗った時点で開いているので、続くクリックで閉じない（開いたままにする）
      if (sub?.index === index && !sheet && via === 'pointer') return;
      setSub({ index, via });
      return;
    }
    onClose();
    item.run();
  };

  /** 矢印・Home/End・accel・サブメニューの開け閉め。level は、そのキーを受けた段 */
  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>, entries: MenuEntry[], level: 'top' | 'sub') => {
    const root = e.currentTarget;
    const buttons = focusable(root);
    let current = document.activeElement as HTMLButtonElement;
    // 行の右のボタン（side）：← → で行の中を移り、↑ ↓ は行の本体から数える
    const row = current?.closest('.ctx-row');
    if (row && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const inRow = [...row.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
      const at = inRow.indexOf(current);
      const to = inRow[at + (e.key === 'ArrowRight' ? 1 : -1)];
      if (to) { e.preventDefault(); e.stopPropagation(); to.focus(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); return; }
    }
    if (current?.dataset.side) current = row?.querySelector<HTMLButtonElement>('button[data-index]') ?? current;
    const index = buttons.indexOf(current);
    let next = index;
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Tab') { onClose(); return; }
    else if (level === 'sub' && (e.key === 'ArrowLeft' || (sheet && e.key === 'Backspace'))) {
      e.preventDefault(); e.stopPropagation(); closeSub(); return;
    } else if (level === 'top' && e.key === 'ArrowRight' && current?.dataset.index) {
      const i = Number(current.dataset.index);
      const item = entries[i];
      if (item && !isHeading(item) && item.submenu && !item.disabled) {
        e.preventDefault(); e.stopPropagation(); activate(item, i, current, 'key');
      } else if (item && !isHeading(item) && item.side) {
        e.preventDefault(); e.stopPropagation();
        current.closest('.ctx-row')?.querySelector<HTMLButtonElement>('button[data-side]:not(:disabled)')?.focus();
      }
      return;
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase();
      const i = entries.findIndex(entry => entry && !isHeading(entry) && !entry.disabled && entry.accel?.toLowerCase() === key);
      if (i < 0) return;
      e.preventDefault(); e.stopPropagation();
      const button = root.querySelector<HTMLButtonElement>(`button[data-level="${level}"][data-index="${i}"]`);
      activate(entries[i] as MenuItem, level === 'top' ? i : null, button, 'key');
      return;
    } else return;
    e.preventDefault(); e.stopPropagation(); buttons[next]?.focus();
  };

  const renderEntries = (entries: MenuEntry[], level: 'top' | 'sub') => entries.map((item, i) => {
    if (item === SEP) return <hr role="separator" key={`s${i}`} />;
    if (isHeading(item)) return <div className="ctx-heading" role="presentation" key={`h${i}`}>{item.label}</div>;
    if (item.side?.length) {
      return (
        <div className="ctx-row" role="none" key={`${level}${i}:${item.label}`}>
          {renderItem(item, i, level)}
          {item.side.map((side, j) => (
            <button
              role="menuitem" tabIndex={-1} key={j}
              className="ctx-side"
              data-side={j}
              disabled={side.disabled}
              aria-label={side.ariaLabel}
              title={side.disabled ? side.disabledReason : side.ariaLabel}
              onPointerEnter={sheet || level !== 'top' || !sub ? undefined : () => { setSub(null); setFlyPos(null); }}
              onClick={() => activate(side, null, null, 'pointer')}
            >{side.label}</button>
          ))}
        </div>
      );
    }
    return renderItem(item, i, level);
  });

  const renderItem = (item: MenuItem, i: number, level: 'top' | 'sub') => {
    const reasonId = item.disabled && item.disabledReason ? `ctx-reason-${level}-${i}` : undefined;
    const hasSub = level === 'top' && !!item.submenu;
    return (
      <button
        role="menuitem" tabIndex={-1}
        key={`${level}${i}:${item.label}`}
        data-index={i}
        data-level={level}
        disabled={item.disabled}
        title={item.disabled ? item.disabledReason : undefined}
        aria-describedby={reasonId}
        aria-keyshortcuts={item.accel}
        aria-haspopup={hasSub ? 'menu' : undefined}
        aria-expanded={hasSub ? sub?.index === i : undefined}
        className={hasSub && sub?.index === i ? 'ctx-open' : undefined}
        onPointerEnter={sheet || level !== 'top' ? undefined : e => {
          // マウスでは、別の項目に乗ったらサブメニューを閉じ、サブメニューの項目に乗ったら開く
          if (hasSub && !item.disabled) { parentButton.current = e.currentTarget; if (sub?.index !== i) setSub({ index: i, via: 'pointer' }); }
          else if (sub) { setSub(null); setFlyPos(null); }
        }}
        onClick={e => activate(item, level === 'top' ? i : null, e.currentTarget, e.detail === 0 ? 'key' : 'pointer')}
      >
        <span className="ctx-text">
          <span className="ctx-label">
            {item.label}
            {item.accel && <span className="ctx-accel" aria-hidden="true">({item.accel.toUpperCase()})</span>}
          </span>
          {reasonId && <span className="ctx-reason" id={reasonId} aria-hidden="true">{item.disabledReason}</span>}
        </span>
        {hasSub ? <span className="ctx-key ctx-sub" aria-hidden="true">▸</span> : item.hint && <span className="ctx-key">{item.hint}</span>}
      </button>
    );
  };

  // シートでは、サブメニューを同じシートの中で開く（親の一覧と入れ替える）
  const inSheetSub = sheet && subEntries;
  const heading = inSheetSub ? subItem!.label : title;

  return createPortal(
    <div className="ctxmenu-layer" ref={layer}>
      <div
        role="menu" aria-label={heading ?? '操作メニュー'}
        onKeyDown={e => onMenuKey(e, inSheetSub ? subEntries : items, inSheetSub ? 'sub' : 'top')}
        className="ctxmenu"
        ref={ref}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {(heading || sheet) && <div className="ctx-title" role="presentation">
          <span>{heading}</span>
          <button type="button" className="touch-menu-close" aria-label="メニューを閉じる" title="メニューを閉じる" tabIndex={-1} onClick={onClose}>×</button>
        </div>}
        {inSheetSub ? <>
          <button role="menuitem" tabIndex={-1} className="ctx-back" onClick={closeSub}>‹ 戻る</button>
          {renderEntries(subEntries, 'sub')}
        </> : renderEntries(items, 'top')}
      </div>
      {!sheet && subEntries && <div
        role="menu" aria-label={subItem!.label}
        className="ctxmenu ctx-flyout"
        ref={flyout}
        style={{ left: flyPos?.x ?? -9999, top: flyPos?.y ?? -9999 }}
        onKeyDown={e => onMenuKey(e, subEntries, 'sub')}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {renderEntries(subEntries, 'sub')}
      </div>}
    </div>, document.body
  );
}
