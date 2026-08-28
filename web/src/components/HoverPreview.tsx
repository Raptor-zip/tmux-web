import { useEffect, useRef, useState } from 'react';
import { fetchCapture } from '../api';

/** ホバーしてからプレビューを出すまでの待ち時間。通りすがりで出さないための間 */
const OPEN_DELAY = 320;
/** 開いている間の更新間隔。中身が動いているペインでも追従させる */
const REFRESH_MS = 1000;
/** 画面に出す行数（末尾から） */
const MAX_LINES = 24;

export interface PreviewTarget {
  /** capture-pane に渡す対象（ペイン ID） */
  paneId: string;
  title: string;
  subtitle: string;
  /** 行の位置。ここを基準に横に並べる */
  anchor: DOMRect;
}

/** 末尾の空行を落として、最後の MAX_LINES 行だけ返す */
function trimTail(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  return lines.slice(Math.max(0, lines.length - MAX_LINES)).join('\n');
}

/**
 * サイドバーの行にホバーしたときに出す、ペインの中身のプレビュー。
 *
 * ウィンドウを開かずに「いまそのペインに何が出ているか」を確かめるためのもので、
 * 操作はできない。ANSI エスケープは落として素のテキストだけを出す。
 */
export function HoverPreview({ target }: { target: PreviewTarget | null }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const paneId = target?.paneId ?? null;

  useEffect(() => {
    if (!paneId) {
      setText(null);
      setError(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const res = await fetchCapture(paneId, 1, true);
        if (stopped) return;
        setText(trimTail(res.text));
        setError(null);
      } catch (err) {
        if (!stopped) setError(String((err as Error).message || err));
      }
      if (!stopped) timer = setTimeout(load, REFRESH_MS);
    };

    // 対象が変わったら前の中身は捨てる（別のペインの内容が一瞬残らないように）
    setText(null);
    setError(null);
    timer = setTimeout(load, OPEN_DELAY);

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [paneId]);

  // 行の右側に置く。画面からはみ出すぶんは上下だけ寄せる
  useEffect(() => {
    if (!target) {
      setPos(null);
      return;
    }
    const box = boxRef.current;
    const height = box?.offsetHeight ?? 240;
    const width = box?.offsetWidth ?? 420;
    const left = Math.min(target.anchor.right + 10, window.innerWidth - width - 10);
    const top = Math.max(
      8,
      Math.min(target.anchor.top - 8, window.innerHeight - height - 8),
    );
    setPos({ top, left });
  }, [target, text]);

  if (!target || (text === null && !error)) return null;

  return (
    <div
      className="hover-preview"
      ref={boxRef}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
    >
      <div className="hover-preview-head">
        <span className="hp-title">{target.title}</span>
        {target.subtitle && <span className="hp-sub">{target.subtitle}</span>}
      </div>
      {error ? (
        <p className="hp-error">プレビューを取得できません: {error}</p>
      ) : (
        <pre className="hp-body">{text}</pre>
      )}
    </div>
  );
}
