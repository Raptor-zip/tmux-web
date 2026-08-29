import type { Pane, TmuxWindow } from './types';

/**
 * ウィンドウ 1 行に出す「いまの状態」。
 *
 * 端末タイトルだけを見ていると、エージェントが終了したあともタイトルが残るせいで
 * 全部が動いているように見える。ここではサーバが返すプロセス判定（pane.proc）を
 * 主にして、スピナー（pane.busy）で作業中と入力待ちを分ける。
 */
export type StatusKind = 'working' | 'waiting' | 'server' | 'run' | 'idle';

export interface WindowStatus {
  kind: StatusKind;
  /** 行の下段に出す状態語 */
  label: string;
  /** 行の右に出す短いチップ（エージェント名・ポート） */
  chips: string[];
  agent: string | null;
  ports: number[];
  /** 最後に出力があってからの経過（ms）。idle の行だけ意味がある */
  idleFor: number;
}

export const STATUS_TEXT: Record<StatusKind, string> = {
  working: '作業中',
  waiting: '入力待ち',
  server: 'サーバ稼働',
  run: '実行中',
  idle: '未使用',
};

/** 状態の強さ。並べ替えとグループ見出しの集計に使う */
export const STATUS_ORDER: StatusKind[] = ['working', 'waiting', 'server', 'run', 'idle'];

export function relTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}分`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}時間`;
  return `${Math.round(h / 24)}日`;
}

/** ウィンドウに属するペインをまとめて 1 つの状態にする */
export function windowStatus(win: TmuxWindow, panes: Pane[], now: number): WindowStatus {
  const agentPane = panes.find((p) => p.proc?.kind === 'agent');
  const ports = [...new Set(panes.flatMap((p) => p.proc?.ports ?? []))].sort((a, b) => a - b);
  const running = panes.find((p) => p.proc && p.proc.kind !== 'idle');

  let kind: StatusKind;
  if (agentPane) kind = agentPane.busy ? 'working' : 'waiting';
  else if (ports.length) kind = 'server';
  else if (running) kind = 'run';
  else kind = 'idle';

  const agent = agentPane?.proc?.agent ?? null;
  const chips: string[] = [];
  if (agent) chips.push(agent);
  for (const port of ports.slice(0, 2)) chips.push(`:${port}`);
  if (!agent && !ports.length && kind === 'run' && running?.proc?.command) {
    chips.push(running.proc.command);
  }

  const idleFor = win.lastActivity ? now - win.lastActivity : 0;
  const label =
    kind === 'idle' && idleFor > 90_000
      ? `${STATUS_TEXT.idle}・${relTime(idleFor)}`
      : STATUS_TEXT[kind];

  return { kind, label, chips, agent, ports, idleFor };
}

/** 状態ごとの件数。プロジェクト見出しに出す要約 */
export function summarize(list: WindowStatus[]): Partial<Record<StatusKind, number>> {
  const out: Partial<Record<StatusKind, number>> = {};
  for (const s of list) out[s.kind] = (out[s.kind] ?? 0) + 1;
  return out;
}
