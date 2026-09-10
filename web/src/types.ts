export interface Session {
  id: string;
  name: string;
  windows: number;
  created: number;
  activity: number;
  attached: number;
  group: string | null;
  groupSize: number;
  path: string;
}

export interface TmuxWindow {
  id: string;
  sessionId: string;
  sessionName: string;
  index: number;
  name: string;
  active: boolean;
  panes: number;
  layout: string;
  zoomed: boolean;
  activity: boolean;
  /** 最後に何か出力があった時刻（ms）。「もう使われていない」の目安 */
  lastActivity: number;
  bell: boolean;
  width: number;
  height: number;
}

/** ペインの中で実際に動いているもの。端末タイトルではなくプロセスから判定した結果 */
export interface PaneProc {
  /** agent=AI エージェント / server=ポートを開いている / run=何か実行中 / idle=シェルだけ */
  kind: 'agent' | 'server' | 'run' | 'idle';
  /** エージェントの表示名（Claude など）。エージェントでなければ null */
  agent: string | null;
  /** いま前面にいるコマンド名 */
  command: string;
  /** 子孫が LISTEN している TCP ポート */
  ports: number[];
  /** そのコマンドが始まった時刻（ms, 5 秒丸め）。何も動いていなければ null */
  since: number | null;
}

/** 作業ディレクトリが属するリポジトリ */
export interface Project {
  root: string;
  name: string;
}

export interface Pane {
  id: string;
  sessionId: string;
  windowId: string;
  index: number;
  active: boolean;
  /** 端末タイトル。先頭の状態マーク（スピナー等）は取り除いてある */
  title: string;
  /** タイトルの先頭が点字スピナーだった＝何か実行中 */
  busy: boolean;
  command: string;
  path: string;
  pid: number;
  width: number;
  height: number;
  left: number;
  top: number;
  dead: boolean;
  inMode: boolean;
  proc: PaneProc | null;
  project: Project | null;
}

export interface TmuxState {
  sessions: Session[];
  windows: TmuxWindow[];
  panes: Pane[];
  ts: number;
  /** tmux サーバのプロセス id。変わったら再起動＝id が振り直されたということ */
  serverPid?: number | null;
  server?: { version: string; prefix: string; socketName: string; home: string };
}

export interface KeyBinding {
  table: string;
  key: string;
  command: string;
}

export type ActionName =
  | 'newSession'
  | 'killSession'
  | 'renameSession'
  | 'mergeSession'
  | 'newWindow'
  | 'killWindow'
  | 'renameWindow'
  | 'selectWindow'
  | 'moveWindow'
  | 'nextWindow'
  | 'previousWindow'
  | 'splitPane'
  | 'killPane'
  | 'selectPane'
  | 'zoomPane'
  | 'resizePane'
  | 'swapPane'
  | 'breakPane'
  | 'joinPane'
  | 'respawnPane'
  | 'sendKeys'
  | 'runCommand'
  | 'clearPane'
  | 'setOption';
