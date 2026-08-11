import { useState } from 'react';
import { LAYOUTS } from '../types';
import type { Pane, TmuxWindow } from '../types';

interface Props {
  window: TmuxWindow | null;
  activePane: Pane | null;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  showPaneMap: boolean;
  showKeyBar: boolean;
  fontSize: number;
  lineHeight: number;
  onAction(action: string, params: Record<string, unknown>): void;
  /** 新しいウィンドウを作って、その向きに並べる */
  onSplitNewWindow(side: 'right' | 'bottom'): void;
  onToggle(key: 'mode' | 'showStatusBar' | 'showPaneMap' | 'showKeyBar'): void;
  onFontSize(delta: number): void;
  onLineHeight(delta: number): void;
  onCopyPane(): void;
  onOpenCheatSheet(): void;
}

export function Toolbar({
  window: win,
  activePane,
  mode,
  showStatusBar,
  showPaneMap,
  showKeyBar,
  fontSize,
  lineHeight,
  onAction,
  onSplitNewWindow,
  onToggle,
  onFontSize,
  onLineHeight,
  onCopyPane,
  onOpenCheatSheet,
}: Props) {
  const [cmd, setCmd] = useState('');
  const paneTarget = activePane?.id;
  const disabled = !paneTarget;

  const submitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim() || !paneTarget) return;
    onAction('runCommand', { target: paneTarget, command: cmd });
    setCmd('');
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          className="btn"
          disabled={!win}
          title="このセッションに新しいウィンドウを作る"
          onClick={() => win && onAction('newWindow', { target: win.sessionId })}
        >
          ＋ ウィンドウ
        </button>
        <button
          className="btn"
          disabled={!win}
          title="新しいウィンドウを作って右隣に並べる（tmux のペインは増やさない）"
          onClick={() => onSplitNewWindow('right')}
        >
          ▐ 左右に分割
        </button>
        <button
          className="btn"
          disabled={!win}
          title="新しいウィンドウを作って下に並べる（tmux のペインは増やさない）"
          onClick={() => onSplitNewWindow('bottom')}
        >
          ▄ 上下に分割
        </button>
        <button
          className="btn"
          disabled={disabled}
          title="ペインのズームを切り替え"
          onClick={() => onAction('zoomPane', { target: paneTarget })}
        >
          ⤢ ズーム
        </button>
        <button
          className="btn danger"
          disabled={disabled}
          title="このペインを閉じる（確認なし）"
          onClick={() => onAction('killPane', { target: paneTarget })}
        >
          ✕ ペイン
        </button>
      </div>

      <div className="toolbar-group">
        <span className="label">レイアウト</span>
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            className="btn small"
            disabled={!win}
            title={l.id}
            onClick={() => win && onAction('setLayout', { target: win.id, layout: l.id })}
          >
            {l.label}
          </button>
        ))}
      </div>

      <form className="toolbar-group grow" onSubmit={submitCommand}>
        <input
          className="cmd-input"
          placeholder={
            activePane
              ? `ペイン ${activePane.index} (${activePane.command}) にコマンドを送る…`
              : 'ペインを選択してください'
          }
          value={cmd}
          disabled={disabled}
          onChange={(e) => setCmd(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={disabled || !cmd.trim()}>
          送信
        </button>
      </form>

      <div className="toolbar-group">
        <button className="btn" disabled={disabled} title="表示中の内容をクリップボードへ" onClick={onCopyPane}>
          ⧉ 本文をコピー
        </button>
        <button className="btn small" title="文字を小さく" onClick={() => onFontSize(-1)}>
          A−
        </button>
        <span className="dim mono">{fontSize}</span>
        <button className="btn small" title="文字を大きく" onClick={() => onFontSize(1)}>
          A＋
        </button>
        <button className="btn small" title="行間を詰める" onClick={() => onLineHeight(-0.05)}>
          ↕−
        </button>
        <span className="dim mono">{lineHeight.toFixed(2)}</span>
        <button className="btn small" title="行間を広げる" onClick={() => onLineHeight(0.05)}>
          ↕＋
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className={`btn toggle ${showPaneMap ? 'on' : ''}`}
          title="ペイン配置図の表示切り替え"
          onClick={() => onToggle('showPaneMap')}
        >
          配置図
        </button>
        <button
          className={`btn toggle ${showKeyBar ? 'on' : ''}`}
          title="特殊キーのツールバー"
          onClick={() => onToggle('showKeyBar')}
        >
          キー
        </button>
        <button
          className={`btn toggle ${showStatusBar ? 'on' : ''}`}
          title="tmux のステータスバーをブラウザ側にも出す"
          onClick={() => onToggle('showStatusBar')}
        >
          status
        </button>
        <button
          className={`btn toggle ${mode === 'direct' ? 'on' : ''}`}
          title={
            mode === 'mirror'
              ? 'ミラー接続中: 端末側の tmux 表示を邪魔しません（クリックで直接接続に切替）'
              : '直接接続中: 端末側とサイズ・表示ウィンドウを共有します（クリックでミラーに切替）'
          }
          onClick={() => onToggle('mode')}
        >
          {mode === 'mirror' ? 'ミラー' : '直接'}
        </button>
        <button className="btn ghost" title="tmux チートシート" onClick={onOpenCheatSheet}>
          ？
        </button>
      </div>
    </div>
  );
}
