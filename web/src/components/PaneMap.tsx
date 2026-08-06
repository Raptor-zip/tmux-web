import type { Pane, TmuxWindow } from '../types';

interface Props {
  window: TmuxWindow | null;
  panes: Pane[];
  onAction(action: string, params: Record<string, unknown>): void;
  onConfirm(title: string, detail: string, run: () => void): void;
}

/**
 * アクティブウィンドウのペイン配置を実際の座標どおりに描く。
 * tmux の pane_left / pane_top / pane_width / pane_height は文字セル単位なので、
 * ウィンドウ全体のセル数で割って % に直せばそのまま縮図になる。
 */
export function PaneMap({ window: win, panes, onAction, onConfirm }: Props) {
  if (!win) return null;

  const cols = Math.max(win.width, ...panes.map((p) => p.left + p.width), 1);
  const rows = Math.max(win.height, ...panes.map((p) => p.top + p.height), 1);

  return (
    <div className="panemap">
      <div className="panemap-head">
        <span className="panemap-title">
          ペイン配置 <span className="dim">{win.name}</span>
        </span>
        <span className="dim">
          {cols}×{rows}
        </span>
      </div>

      <div className="panemap-canvas" style={{ aspectRatio: `${cols} / ${rows * 2}` }}>
        {panes.map((p) => (
          <div
            key={p.id}
            className={`panebox ${p.active ? 'active' : ''} ${p.dead ? 'dead' : ''}`}
            style={{
              left: `${(p.left / cols) * 100}%`,
              top: `${(p.top / rows) * 100}%`,
              width: `${(p.width / cols) * 100}%`,
              height: `${(p.height / rows) * 100}%`,
            }}
            onClick={() => onAction('selectPane', { target: p.id })}
            title={`${p.id} ${p.command}\n${p.path}\n${p.width}×${p.height}`}
          >
            <span className="panebox-id">{p.index}</span>
            <span className="panebox-cmd">{p.command || 'sh'}</span>
            <div className="panebox-tools">
              <button
                title="左右に分割"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('splitPane', { target: p.id, direction: 'horizontal' });
                }}
              >
                ▐
              </button>
              <button
                title="上下に分割"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('splitPane', { target: p.id, direction: 'vertical' });
                }}
              >
                ▄
              </button>
              <button
                title="ズーム切り替え"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('zoomPane', { target: p.id });
                }}
              >
                ⤢
              </button>
              <button
                className="danger"
                title="ペインを閉じる"
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirm(
                    `ペイン ${p.index} を閉じますか？`,
                    `${p.command} が ${p.path} で動いています。`,
                    () => onAction('killPane', { target: p.id }),
                  );
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
