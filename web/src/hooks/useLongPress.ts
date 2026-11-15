import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

export interface LongPressOptions<T> {
  /** 押し続ける時間（ms）。既定 550 */
  delay?: number;
  /** これより動いたら取り消す（px）。既定 8 */
  tolerance?: number;
  /** マウスでも長押しを取るか。既定 false（マウスは右クリックがある） */
  mouse?: boolean;
  /** 押し始めに長押しを受け付けるかを決める（例：端末で文字を選んでいるときは取らない） */
  canStart?(event: React.PointerEvent, target: T): boolean;
}

export interface LongPressPoint {
  x: number;
  y: number;
}

type Handlers = Pick<React.DOMAttributes<HTMLElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onPointerLeave' | 'onClickCapture'>;

/**
 * 長押し（タッチ・ペン）でメニューを開くための部品。
 *
 * - delay（550ms）押し続けたら onLongPress を呼ぶ
 * - tolerance（8px）より動いたら取り消す（スワイプでのスクロールと区別する）
 * - 2 本目の指が触れたら取り消す（ピンチやマルチタッチは長押しにしない）
 * - 発火したあとの click は 1 回だけ握りつぶす（長押しで開いたのに、指を離したら選ばれる、を防ぐ）
 *
 * 1 つの hook を複数の要素で共有できるよう、bind(target) が要素ごとのハンドラーを返す。
 */
export function useLongPress<T>(onLongPress: (target: T, point: LongPressPoint, event: React.PointerEvent) => void, options: LongPressOptions<T> = {}) {
  const { delay = 550, tolerance = 8, mouse = false } = options;
  const press = useRef<{ pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** 長押しが発火した対象。次の click を 1 回だけ止める */
  const fired = useRef<{ target: T } | null>(null);
  const latest = useRef({ onLongPress, canStart: options.canStart });
  latest.current = { onLongPress, canStart: options.canStart };

  const cancel = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }, []);

  /**
   * 発火したあと指を離すと、ブラウザは互換のマウスイベント（mousedown→フォーカス移動）を出す。
   * そのままだと、開いたメニューの先頭に当てたフォーカスが押した要素へ戻ってしまうので、
   * 指を離すまでの間だけ touchend と mousedown の既定動作を止める。
   */
  const releaseGuard = useRef<(() => void) | null>(null);
  const guardRelease = useCallback(() => {
    releaseGuard.current?.();
    const stop = (e: Event) => e.preventDefault();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('touchend', stop, true);
      window.removeEventListener('mousedown', stop, true);
      window.removeEventListener('pointerup', later, true);
      window.removeEventListener('pointercancel', later, true);
      releaseGuard.current = null;
    };
    // 指を離したあと、互換イベントが届くまで少し待ってから外す
    const later = () => { clearTimeout(timer); timer = setTimeout(done, 400); };
    window.addEventListener('touchend', stop, { capture: true, passive: false });
    window.addEventListener('mousedown', stop, true);
    window.addEventListener('pointerup', later, true);
    window.addEventListener('pointercancel', later, true);
    timer = setTimeout(done, 5000);
    releaseGuard.current = done;
  }, []);

  useEffect(() => {
    // 押しているあいだに、別の指が触れた／フォーカスが外れたら取り消す
    const other = (e: PointerEvent) => { if (press.current && e.pointerId !== press.current.pointerId) cancel(); };
    window.addEventListener('pointerdown', other, true);
    window.addEventListener('blur', cancel);
    return () => {
      cancel();
      releaseGuard.current?.();
      window.removeEventListener('pointerdown', other, true);
      window.removeEventListener('blur', cancel);
    };
  }, [cancel]);

  const bind = (target: T): Handlers => ({
    onPointerDown: e => {
      cancel();
      fired.current = null;
      if ((!mouse && e.pointerType === 'mouse') || !e.isPrimary || e.button !== 0) return;
      if (latest.current.canStart && !latest.current.canStart(e, target)) return;
      e.persist?.();
      const { clientX: x, clientY: y, pointerId } = e;
      press.current = { pointerId, x, y, timer: setTimeout(() => {
        press.current = null;
        fired.current = { target };
        if (e.pointerType !== 'mouse') guardRelease();
        latest.current.onLongPress(target, { x, y }, e);
      }, delay) };
    },
    onPointerMove: e => {
      const start = press.current;
      if (start && (e.pointerId !== start.pointerId || Math.hypot(e.clientX - start.x, e.clientY - start.y) > tolerance)) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: e => {
      if (fired.current && Object.is(fired.current.target, target)) {
        fired.current = null;
        e.preventDefault();
        e.stopPropagation();
      }
    },
  });

  return { bind, cancel };
}
