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
  bell: boolean;
  width: number;
  height: number;
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
}

export interface TmuxState {
  sessions: Session[];
  windows: TmuxWindow[];
  panes: Pane[];
  ts: number;
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
  | 'setLayout'
  | 'respawnPane'
  | 'sendKeys'
  | 'runCommand'
  | 'clearPane'
  | 'setOption';

export const LAYOUTS = [
  { id: 'even-horizontal', label: '横並び' },
  { id: 'even-vertical', label: '縦並び' },
  { id: 'main-horizontal', label: 'メイン上' },
  { id: 'main-vertical', label: 'メイン左' },
  { id: 'tiled', label: 'タイル' },
] as const;
