import type { MenuEntry, MenuItem } from './components/ContextMenu';
import type { Pane, Session, TmuxWindow } from './types';
import { INPUT_BAR_LABEL, nextInputBar, type InputBarMode } from './shared-setting';

/**
 * 操作の登録表。
 *
 * メニュー（ワークスペース・端末の右クリック・タブ・パネル・新規・文字サイズ／行間）は
 * すべてここに並べた操作から組み立てる。ラベル・ヒント・押せない理由・実行内容を 1 か所に置き、
 * メニューごとに同じ操作を書き直さない。どのメニューに何を出すかは menus.ts が決める。
 *
 * 各操作は「どの対象に効くか」を scope で持つ。メニューを開く側が、その対象の文脈
 * （CommandContext の該当する欄）を組み立てて渡す。状態そのものは今までどおり App.tsx などが持ち、
 * ここには関数と値のスナップショットが渡ってくるだけ。
 */

/** 端末とワークスペース全体の操作（旧 Toolbar の Props） */
export interface AppContext {
  session: Session | null;
  window: TmuxWindow | null;
  activePane: Pane | null;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  /** 入力行の出し方（tw.inputBar） */
  inputBar: InputBarMode;
  /** Alt のショートカットをアプリで受けるか（tw.altKeys）。オフなら Alt キーは端末へそのまま届く */
  altKeys: boolean;
  onAction(action: string, params: Record<string, unknown>): void;
  /** 新しいウィンドウを作って、いまのタイルにタブで足す */
  onNewTab(): void;
  onLaunchAgent(agent: 'claude' | 'codex'): void;
  launchingAgent: 'claude' | 'codex' | null;
  /** 新しいウィンドウを作って、その向きに並べる。agent を渡すとそのエージェントを起動する */
  onSplitNewWindow(side: 'right' | 'bottom', agent?: 'claude' | 'codex'): void;
  /** 新規メニュー（＋▾）を入力先のパネルで開く */
  onOpenNewMenu(): void;
  /** 入力待ちの端末の数 */
  waitingCount?: number;
  /** 次の入力待ちの端末へ移る（Alt+J） */
  onNextWaiting?(): void;
  /** mode は確認してから切り替える。inputBar は 自動 → 常に表示 → 隠す の順に回す */
  onToggle(key: 'mode' | 'showStatusBar' | 'inputBar' | 'altKeys'): void;
  onCopyPane(): void;
  onKillPane(): void;
  onOpenFiles(): void;
  onRemoteControl(): void;
  /** 入力先の Claude に /exit を送る（確認してから） */
  onExitClaude(): void;
  onOpenScreen(): void;
  /** リモートデスクトップをタブで開く（端末と並べて見る） */
  onOpenScreenTab(): void;
  /** パレット（探す・操作）を開く */
  onOpenSwitcher(): void;
  /** ショートカット一覧を開く */
  onOpenShortcuts(): void;
  /** 『表示と接続』を開く */
  onOpenSettings?(): void;
  /** アプリとして開いている（追加済み）。『アプリとして追加』を出さない */
  appInstalled?: boolean;
  onInstallApp?(): void;
  /** sudo の承認待ちがあるか */
  approvalPending: boolean;
  onOpenApproval(): void;
  onSendCommand(): void;
  /** 全文（履歴込み）をシートに出して、指やマウスで範囲を選んでコピーする */
  onSelectText(): void;
  onPaste(): void;
  /** false なら貼り付けられない（メニューを開いたタブが前面にない） */
  canPaste?: boolean;
  /** 対象のタブがリモートデスクトップ。ペインと端末の操作は出さない */
  screenTab?: boolean;
  /** 前面がリモートデスクトップでも、そのデバイスの端末を新しく開ける */
  canOpenTerminal?: boolean;
}

/** 端末で選んでいる文字 */
export interface SelectionContext {
  text: string;
  copy(): void;
  clear(): void;
}

/** 1 枚のタブ（右クリックしたタブ、または入力先のタブ） */
export interface TabContext {
  /** パネルの中での位置 */
  index: number;
  /** そのパネルのタブ数 */
  count: number;
  screen: boolean;
  /** tmux のウィンドウが見つかったか（端末タブのみ） */
  hasWindow: boolean;
  others: number;
  right: number;
  /** 移せる先のワークスペース（自分以外） */
  desktops: { id: string; name: string }[];
  /** 移せる先のパネル（自分以外）。name はそのパネルで表示中のタブ名 */
  panels: { id: string; name: string; tabs: number }[];
  moveLeft(): void;
  moveRight(): void;
  moveToDesktop(id: string): void;
  moveToPanel(id: string): void;
  close(): void;
  closeOthers(): void;
  closeRight(): void;
  split(side: 'right' | 'bottom'): void;
  openAsDialog(): void;
  renameWindow(): void;
  killWindow(): void;
}

/** パネル（タイル）の拡大 */
export interface PanelContext {
  /** パネルが 2 つ以上ある＝広げる意味がある */
  multiple: boolean;
  /** いま 1 枚だけを大きく出している（最大化中、または狭くて自動で 1 パネル表示） */
  maximized?: boolean;
  toggleFocus(): void;
}

/** タブがあるパネルそのものの操作 */
export interface StripContext {
  tabCount: number;
  closable: boolean;
  closePanel(): void;
}

/** 新規メニュー（＋▾）：どのデバイスで何を開くか */
export interface CreateContext {
  devices: { id: string; name: string; connected?: boolean }[];
  /** 入力先のデバイス。『別のデバイスで ▸』からは外し、『リモートデスクトップ ▸』では先頭に置く */
  current?: string;
  newTerminal(deviceId?: string): void;
  openScreen(deviceId: string): void;
  newProject?(): void;
  openFolder?(): void;
  resume?(): void;
  newSession?(): void;
}

/** ワークスペース（コード上は desktop）。タブのメニューと、パレットの『操作』（表示中のワークスペース）で使う */
export interface DesktopContext {
  /** 並びの中の位置（0 始まり）と数 */
  index: number;
  count: number;
  rename(): void;
  create(): void;
  move(delta: -1 | 1): void;
  remove(): void;
}

/**
 * リモートデスクトップの画面（画面タブ・ダイアログ）。RemoteScreen が作り、
 * タブのときは App がタブに効く操作（ダイアログで大きく表示・別のデバイスに切り替え）を足す。
 */
export interface ScreenContext {
  /** 画面が前面にあって操作できる（裏のタブでは false） */
  ready: boolean;
  /** ダイアログで大きく表示している */
  modal: boolean;
  connected: boolean;
  viewOnly: boolean;
  /** 画面に合わせて縮小している（false は原寸） */
  fit: boolean;
  copying: boolean;
  /** 全画面表示中 */
  full: boolean;
  /** Fullscreen API が使える */
  canFullscreen: boolean;
  /** タイルが狭く、見出しから Esc を外している */
  narrow: boolean;
  devices: { id: string; name: string; connected?: boolean }[];
  /** いま表示しているデバイス */
  current: string;
  setViewOnly(value: boolean): void;
  setFit(value: boolean): void;
  copy(): void;
  reconnect(): void;
  sendEscape(): void;
  toggleFullscreen(): void;
  openAsDialog?(): void;
  backToTab?(): void;
  switchDevice(id: string): void;
  openQuality(): void;
  sendCtrlAltDel(): void;
  openGuide(): void;
  /** 文字入力を開く（入力行を隠しているスマホでも届くよう、メニューにも置く） */
  openText(): void;
}

/** 一覧（サイドバー）全体。見出しの ⋯ と、パレットの『操作』で使う */
export interface ListContext {
  groupBy: 'project' | 'session';
  setGroupBy(next: 'project' | 'session'): void;
  /** まとめて片付けられる未使用の端末の数 */
  closable: number;
  cleanUp(): void;
  /** 一覧の中でだけ使える（パレットからは出さない） */
  collapseAll?(): void;
  expandAll?(): void;
  /** 畳んでいるグループ・デバイスがある */
  anyCollapsed?: boolean;
  manageDevices(): void;
  /** 一覧が開いているときだけ */
  close?(): void;
}

/** 一覧のデバイス見出し */
export interface DeviceContext {
  id: string;
  name: string;
  connected: boolean;
  /** 新規・プロジェクト・リモートデスクトップの対象として選んでいる */
  selected: boolean;
  select(): void;
  openScreen(): void;
  manage(): void;
}

/** 一覧の 1 行（端末の行、またはグループの行） */
export interface RowContext {
  /** window = 端末、session = tmux セッション（セッション別）、project = プロジェクト（プロジェクト別） */
  kind: 'window' | 'session' | 'project';
  name: string;
  open(): void;
  /** 端末の行だけ。ドラッグで端末の端に落としたときと同じ */
  openSide?(side: 'right' | 'bottom'): void;
  /** 中身をシートで見る（タッチではホバーのプレビューが出ないため） */
  peek?(): void;
  /** グループの行だけ。そのグループで新しい端末を開く */
  newTerminal?(): void;
  rename?(): void;
  /** 移す先・まとめる先（同じデバイスの、自分以外のセッション） */
  sessions: { id: string; name: string }[];
  /** 端末の行だけ。ドラッグで別のセッション行に落としたときと同じ */
  moveTo?(sessionId: string): void;
  /** セッションの行だけ。ドラッグで別のセッション行に重ねたときと同じ */
  mergeInto?(sessionId: string): void;
  /** グループの中の、まとめて片付けられる未使用の端末の数 */
  closable: number;
  cleanUp?(): void;
  kill?(): void;
}

/** 文字サイズと行間 */
export interface ViewContext {
  fontSize: number;
  lineHeight: number;
  setFontSize(update: (value: number) => number): void;
  setLineHeight(value: number): void;
  stepLineHeight(delta: number): void;
}

export interface Sections {
  app: AppContext;
  selection: SelectionContext;
  tab: TabContext;
  panel: PanelContext;
  strip: StripContext;
  create: CreateContext;
  desktop: DesktopContext;
  view: ViewContext;
  screen: ScreenContext;
  list: ListContext;
  device: DeviceContext;
  row: RowContext;
}

export type Scope = keyof Sections;

/** メニューを開く側が渡す文脈。そのメニューで使う欄だけ埋めればよい */
export type CommandContext = Partial<Sections>;

export type CommandGroup =
  | 'create'
  | 'agent'
  | 'navigate'
  | 'pane'
  | 'clipboard'
  | 'screen'
  | 'view'
  | 'tab'
  | 'panel'
  | 'window'
  | 'workspace'
  | 'font'
  | 'lineHeight'
  | 'list';

export interface Command<S extends Scope = Scope> {
  id: string;
  scope: S;
  /** 操作の正式な名前。登録表の中で重複させない（検索やショートカット一覧でもこれを使う） */
  label: string;
  /** メニューの文脈で省略・状態つきにした表示名。無ければ label を出す */
  menuLabel?: string | ((ctx: Sections[S]) => string);
  /** 検索で引っかける別名（旧ラベルなど） */
  aliases?: string[];
  group: CommandGroup;
  /** 右側に薄く出すキー表記や補足 */
  hint?: string | ((ctx: Sections[S]) => string | undefined);
  /** ショートカット一覧での名前。キーが label より広い操作をするとき（Alt+B は開くのにも使う）に付ける */
  shortcutLabel?: string;
  /** false ならメニューに出さない */
  when?(ctx: Sections[S]): boolean;
  /** 押せない理由。null / undefined なら押せる */
  disabledReason?(ctx: Sections[S]): string | null | undefined;
  /** プロセスを止めるなど、取り消せない操作 */
  danger?: boolean;
  run(ctx: Sections[S]): void;
}

/** デバイスごと・パネルごとのように、対象の数だけ項目が並ぶ操作 */
export interface CommandFamily<S extends Scope = Scope, A = any> {
  id: string;
  scope: S;
  /** 名前のひな形（重複検査と一覧用）。実際の表示は itemLabel */
  label: string;
  aliases?: string[];
  group: CommandGroup;
  items(ctx: Sections[S]): A[];
  itemLabel(ctx: Sections[S], item: A): string;
  /** メニューでの表示名（サブメニューの中で短くする）。無ければ itemLabel */
  itemMenuLabel?(ctx: Sections[S], item: A): string;
  hint?(ctx: Sections[S], item: A): string | undefined;
  disabledReason?(ctx: Sections[S], item: A): string | null | undefined;
  danger?: boolean;
  run(ctx: Sections[S], item: A): void;
}

const define = <S extends Scope>(command: Command<S>) => command as unknown as Command;
const family = <S extends Scope, A>(f: CommandFamily<S, A>) => f as unknown as CommandFamily;

const NO_PANE = '操作するペインがありません';
const NO_WINDOW = 'tmux のウィンドウが見つかりません';
const ONE_PANEL = 'パネルが1つのときは使えません';
const NOT_FRONT = 'このタブを前面に出してから使えます';
const SCREEN_OFFLINE = '画面に接続していません';
const VIEW_ONLY = '見るだけのときは送れません';

const canOpen = (c: AppContext) => !!c.window || !!c.canOpenTerminal;
const canLaunch = (c: AppContext) => (!!c.session || !!c.canOpenTerminal) && c.launchingAgent === null;
const isClaude = (c: AppContext) => c.activePane?.proc?.agent === 'Claude';
const onTerminal = (c: AppContext) => !c.screenTab;

export const COMMANDS: Command[] = [
  // ---- 作る・起動する
  define({
    id: 'terminal.newTab', scope: 'app', group: 'create', label: '新しい端末', hint: 'Alt+T',
    aliases: ['新しい端末をタブで開く', '現在のデバイスで端末を開く'],
    run: c => c.onNewTab(),
  }),
  define({
    id: 'terminal.splitRight', scope: 'app', group: 'create', label: '新しい端末を右に並べる', menuLabel: '右に並べる',
    disabledReason: c => (canOpen(c) ? null : '端末を開けるセッションがありません'),
    run: c => c.onSplitNewWindow('right'),
  }),
  define({
    id: 'terminal.splitBottom', scope: 'app', group: 'create', label: '新しい端末を下に並べる', menuLabel: '下に並べる',
    disabledReason: c => (canOpen(c) ? null : '端末を開けるセッションがありません'),
    run: c => c.onSplitNewWindow('bottom'),
  }),
  define({
    id: 'create.menu', scope: 'app', group: 'create', label: '新規メニュー', hint: 'Alt+Shift+T',
    aliases: ['新しく開く', '作る'],
    run: c => c.onOpenNewMenu(),
  }),
  ...(['claude', 'codex'] as const).flatMap(agent => {
    const name = agent === 'claude' ? 'Claude' : 'Codex';
    const launchReason = (c: AppContext) => (canLaunch(c) ? null : c.launchingAgent ? '起動中です' : '起動できるセッションがありません');
    return [
      define({
        id: `agent.${agent}`, scope: 'app', group: 'agent', label: `${name} を起動`,
        hint: agent === 'claude' ? 'Alt+Shift+C' : 'Alt+Shift+X',
        aliases: [`${name} を新しいタブで起動`],
        disabledReason: launchReason,
        run: c => c.onLaunchAgent(agent),
      }),
      define({
        id: `agent.${agent}Right`, scope: 'app', group: 'agent', label: `${name} を右に並べる`, menuLabel: '右に並べる',
        disabledReason: launchReason,
        run: c => c.onSplitNewWindow('right', agent),
      }),
      define({
        id: `agent.${agent}Bottom`, scope: 'app', group: 'agent', label: `${name} を下に並べる`, menuLabel: '下に並べる',
        disabledReason: launchReason,
        run: c => c.onSplitNewWindow('bottom', agent),
      }),
    ];
  }),
  define({
    id: 'create.project', scope: 'create', group: 'create', label: 'プロジェクトを作る…', aliases: ['新しいプロジェクト'],
    when: c => !!c.newProject, run: c => c.newProject?.(),
  }),
  define({
    id: 'create.folder', scope: 'create', group: 'create', label: 'フォルダーを開く…', aliases: ['既存のフォルダー'],
    when: c => !!c.openFolder, run: c => c.openFolder?.(),
  }),
  define({
    id: 'create.resume', scope: 'create', group: 'create', label: '過去の会話を再開…',
    aliases: ['最近のClaude履歴', '履歴', 'resume', 'Codex', 'Claude'],
    when: c => !!c.resume, run: c => c.resume?.(),
  }),
  define({
    id: 'create.session', scope: 'create', group: 'create', label: 'tmux セッションを作る…',
    aliases: ['新しいセッションを作る', 'セッション'],
    when: c => !!c.newSession, run: c => c.newSession?.(),
  }),
  define({
    id: 'agent.remoteControl', scope: 'app', group: 'agent', label: 'Claude アプリに接続…',
    when: isClaude, run: c => c.onRemoteControl(),
  }),
  define({
    id: 'agent.exitClaude', scope: 'app', group: 'agent', label: 'Claude を終了…', aliases: ['Claude を終了する', '/exit'], danger: true,
    when: isClaude,
    disabledReason: c => (c.activePane?.busy ? 'Claude が作業中です' : null),
    run: c => c.onExitClaude(),
  }),

  // ---- 移動・表示
  define({
    id: 'navigate.switcher', scope: 'app', group: 'navigate', label: '探す・操作', hint: 'Alt+P', shortcutLabel: '探す・操作（端末）',
    aliases: ['ウィンドウを切り替える…', 'パレット', 'タブ・パネルの一覧'],
    run: c => c.onOpenSwitcher(),
  }),
  define({
    id: 'navigate.nextWaiting', scope: 'app', group: 'navigate', label: '次の入力待ちへ', hint: 'Alt+J',
    aliases: ['入力待ち', '次の入力待ちへ移る', 'waiting'],
    when: c => !!c.onNextWaiting,
    disabledReason: c => (c.waitingCount ? null : '入力待ちの端末はありません'),
    run: c => c.onNextWaiting?.(),
  }),
  define({
    id: 'navigate.shortcuts', scope: 'app', group: 'navigate', label: 'ショートカット一覧', hint: 'Alt+/',
    aliases: ['キーボード', 'ヘルプ'],
    run: c => c.onOpenShortcuts(),
  }),
  define({
    id: 'navigate.approval', scope: 'app', group: 'navigate', label: '承認待ちを確認', aliases: ['sudo', '承認'],
    when: c => c.approvalPending, run: c => c.onOpenApproval(),
  }),

  // ---- ペイン
  define({
    id: 'pane.files', scope: 'app', group: 'pane', label: '作業フォルダーを開く', hint: 'Alt+O',
    aliases: ['作業フォルダーのファイルを見る', 'ファイル'],
    when: onTerminal, disabledReason: c => (c.activePane ? null : NO_PANE), run: c => c.onOpenFiles(),
  }),
  define({
    id: 'pane.sendCommand', scope: 'app', group: 'pane', label: 'コマンドを送る…',
    when: onTerminal, disabledReason: c => (c.activePane ? null : NO_PANE), run: c => c.onSendCommand(),
  }),
  define({
    id: 'pane.copyAll', scope: 'app', group: 'clipboard', label: '全文をコピー（履歴込み）',
    aliases: ['本文をコピー', '画面全体をコピー', 'スクロールバック込み'],
    when: onTerminal, disabledReason: c => (c.activePane ? null : NO_PANE), run: c => c.onCopyPane(),
  }),
  define({
    id: 'pane.selectText', scope: 'app', group: 'clipboard', label: 'テキストを選んでコピー…',
    aliases: ['範囲を選んでコピー', 'テキストを選択'],
    when: onTerminal, disabledReason: c => (c.activePane ? null : NO_PANE), run: c => c.onSelectText(),
  }),
  define({
    id: 'clipboard.paste', scope: 'app', group: 'clipboard', label: '貼り付け', hint: 'Ctrl+V',
    when: onTerminal, disabledReason: c => (c.canPaste === false ? NOT_FRONT : null),
    run: c => c.onPaste(),
  }),
  define({
    id: 'pane.zoom', scope: 'app', group: 'pane', label: 'ペインを拡大（tmux）',
    aliases: ['ペインを全画面 / 元に戻す', 'ズーム'],
    when: onTerminal, disabledReason: c => (c.activePane ? null : NO_PANE),
    run: c => c.activePane && c.onAction('zoomPane', { target: c.activePane.id }),
  }),
  define({
    id: 'pane.kill', scope: 'app', group: 'pane', label: 'ペインを終了…', aliases: ['ペインを閉じる…'], danger: true,
    when: onTerminal, disabledReason: c => (c.activePane ? null : NO_PANE), run: c => c.onKillPane(),
  }),

  // ---- 選択
  define({
    id: 'selection.copy', scope: 'selection', group: 'clipboard', label: '選択をコピー', aliases: ['選択部分をコピー'],
    menuLabel: c => `選択をコピー（${c.text.split('\n').length} 行）`, hint: 'Ctrl+Shift+C',
    when: c => !!c.text, run: c => c.copy(),
  }),
  define({
    id: 'selection.clear', scope: 'selection', group: 'clipboard', label: '選択を解除',
    when: c => !!c.text, run: c => c.clear(),
  }),

  // ---- リモートデスクトップ
  define({
    id: 'screen.openTab', scope: 'app', group: 'screen', label: 'リモートデスクトップをタブで開く',
    run: c => c.onOpenScreenTab(),
  }),
  define({
    id: 'screen.openDialog', scope: 'app', group: 'screen', label: 'リモートデスクトップをダイアログで開く',
    run: c => c.onOpenScreen(),
  }),

  // ---- 画面メニュー（画面タブのタブメニューの先頭の段と、ダイアログの ⋯）。画面を主語にし、相手の機器は『接続先』と呼ぶ
  define({
    id: 'screen.viewOnly', scope: 'screen', group: 'screen', label: '操作する / 見るだけを切り替える',
    aliases: ['見るだけ', '操作する', '操作モード'],
    menuLabel: c => (c.viewOnly ? '操作する' : '見るだけ'),
    disabledReason: c => (c.ready ? null : NOT_FRONT), run: c => c.setViewOnly(!c.viewOnly),
  }),
  define({
    id: 'screen.fit', scope: 'screen', group: 'screen', label: '画面に合わせる / 原寸で表示',
    aliases: ['表示サイズ', '原寸（100%）'],
    menuLabel: c => (c.fit ? '原寸で表示' : '画面に合わせる'),
    disabledReason: c => (c.ready ? null : NOT_FRONT), run: c => c.setFit(!c.fit),
  }),
  define({
    id: 'screen.copy', scope: 'screen', group: 'screen', label: '接続先からコピー', aliases: ['この端末へコピー'],
    menuLabel: c => (c.copying ? 'コピー中…' : '接続先からコピー'),
    disabledReason: c => (!c.ready ? NOT_FRONT : c.copying ? 'コピー中です' : null), run: c => c.copy(),
  }),
  define({
    id: 'screen.reconnect', scope: 'screen', group: 'screen', label: '画面を再接続', menuLabel: '再接続',
    aliases: ['もう一度接続する', '再接続'],
    disabledReason: c => (c.ready ? null : NOT_FRONT), run: c => c.reconnect(),
  }),
  define({
    id: 'screen.text', scope: 'screen', group: 'screen', label: '文字入力', aliases: ['文字入力・コピー', '日本語', '接続先へ貼り付け'],
    disabledReason: c => (c.ready ? null : NOT_FRONT), run: c => c.openText(),
  }),
  define({
    id: 'screen.sendEscape', scope: 'screen', group: 'screen', label: 'Esc を送る',
    // 見出しに Esc が入りきらない狭いタイルでだけ、メニューに出す
    when: c => c.narrow,
    disabledReason: c => (!c.ready ? NOT_FRONT : !c.connected ? SCREEN_OFFLINE : c.viewOnly ? VIEW_ONLY : null), run: c => c.sendEscape(),
  }),
  define({
    id: 'screen.fullscreen', scope: 'screen', group: 'screen', label: '全画面',
    menuLabel: c => (c.full ? '全画面を終了' : '全画面'),
    // iOS などでは Fullscreen API が無い。代わりは『パネルを最大化』
    when: c => c.canFullscreen,
    disabledReason: c => (c.ready ? null : NOT_FRONT), run: c => c.toggleFullscreen(),
  }),
  define({
    id: 'screen.asDialog', scope: 'screen', group: 'screen', label: 'ダイアログで大きく表示',
    aliases: ['ダイアログで大きく開く'],
    when: c => !c.modal && !!c.openAsDialog, run: c => c.openAsDialog?.(),
  }),
  define({
    id: 'screen.toTab', scope: 'screen', group: 'screen', label: 'タブに戻す', aliases: ['タブで開く'],
    when: c => c.modal && !!c.backToTab, run: c => c.backToTab?.(),
  }),
  define({
    id: 'screen.quality', scope: 'screen', group: 'screen', label: '画質…', aliases: ['画質・遅延設定', '画質と遅延'],
    disabledReason: c => (c.ready ? null : NOT_FRONT), run: c => c.openQuality(),
  }),
  define({
    id: 'screen.ctrlAltDel', scope: 'screen', group: 'screen', label: 'Ctrl+Alt+Del を送る…', danger: true,
    disabledReason: c => (!c.ready ? NOT_FRONT : !c.connected ? SCREEN_OFFLINE : c.viewOnly ? VIEW_ONLY : null), run: c => c.sendCtrlAltDel(),
  }),
  define({
    id: 'screen.guide', scope: 'screen', group: 'screen', label: '操作ガイドと接続情報', aliases: ['操作ガイド', '接続情報', '通信往復'],
    disabledReason: c => (c.ready ? null : NOT_FRONT), run: c => c.openGuide(),
  }),

  // ---- 表示
  define({
    id: 'view.settings', scope: 'app', group: 'view', label: '表示と接続…',
    aliases: ['設定', '文字サイズ', '行間', 'インストール', 'バージョン'],
    when: c => !!c.onOpenSettings, run: c => c.onOpenSettings!(),
  }),
  define({
    id: 'view.inputBar', scope: 'app', group: 'view', label: '入力行の表示を切り替える',
    aliases: ['キーバーの表示を切り替える', 'キーバー'],
    hint: c => `${INPUT_BAR_LABEL[c.inputBar]} → ${INPUT_BAR_LABEL[nextInputBar(c.inputBar)]}`,
    run: c => c.onToggle('inputBar'),
  }),
  define({
    id: 'view.statusBar', scope: 'app', group: 'view', label: 'tmux のステータス行の表示を切り替える',
    menuLabel: c => `tmux のステータス行を${c.showStatusBar ? '隠す' : '表示'}`,
    run: c => c.onToggle('showStatusBar'),
  }),
  define({
    id: 'view.mode', scope: 'app', group: 'view', label: '接続方式を切り替える…',
    aliases: ['接続方式を切り替える', 'ミラー', '直接'],
    menuLabel: c => (c.mode === 'mirror' ? '直接接続に切り替える…' : 'ミラー接続に切り替える…'),
    run: c => c.onToggle('mode'),
  }),
  define({
    id: 'view.altKeys', scope: 'app', group: 'view', label: 'Alt ショートカットを使う',
    aliases: ['Alt キー', 'ショートカットを無効にする'],
    hint: c => (c.altKeys ? 'オン' : 'オフ'),
    run: c => c.onToggle('altKeys'),
  }),
  define({
    id: 'app.install', scope: 'app', group: 'view', label: 'アプリとして追加',
    aliases: ['アプリとしてインストール', 'インストール', 'ホーム画面に追加'],
    when: c => !c.appInstalled && !!c.onInstallApp, run: c => c.onInstallApp!(),
  }),

  // ---- タブ
  define({
    id: 'tab.moveLeft', scope: 'tab', group: 'tab', label: '左へ移す', aliases: ['左へ移動'],
    disabledReason: c => (c.index === 0 ? '先頭のタブです' : null), run: c => c.moveLeft(),
  }),
  define({
    id: 'tab.moveRight', scope: 'tab', group: 'tab', label: '右へ移す', aliases: ['右へ移動'],
    disabledReason: c => (c.index === c.count - 1 ? '末尾のタブです' : null), run: c => c.moveRight(),
  }),
  define({
    id: 'tab.close', scope: 'tab', group: 'tab', label: 'タブを閉じる', hint: 'Alt+W',
    run: c => c.close(),
  }),
  define({
    id: 'tab.closeOthers', scope: 'tab', group: 'tab', label: '他のタブを閉じる',
    menuLabel: c => `他のタブ（${c.others}）`,
    disabledReason: c => (c.others === 0 ? '他のタブがありません' : null), run: c => c.closeOthers(),
  }),
  define({
    id: 'tab.closeRight', scope: 'tab', group: 'tab', label: '右側のタブを閉じる',
    menuLabel: c => `右側のタブ（${c.right}）`,
    disabledReason: c => (c.right === 0 ? '右側にタブがありません' : null), run: c => c.closeRight(),
  }),
  define({
    id: 'tab.splitRight', scope: 'tab', group: 'tab', label: '右に分割して移す', aliases: ['右に切り出す'],
    disabledReason: c => (c.count < 2 ? 'パネルのタブが1つのときは使えません' : null), run: c => c.split('right'),
  }),
  define({
    id: 'tab.splitBottom', scope: 'tab', group: 'tab', label: '下に分割して移す', aliases: ['下に切り出す'],
    disabledReason: c => (c.count < 2 ? 'パネルのタブが1つのときは使えません' : null), run: c => c.split('bottom'),
  }),

  // ---- tmux のウィンドウ（画面上は「端末」と呼ぶ）
  define({
    id: 'window.rename', scope: 'tab', group: 'window', label: '端末の名前を変更…', aliases: ['ウィンドウ名を変更…'],
    when: c => !c.screen, disabledReason: c => (c.hasWindow ? null : NO_WINDOW), run: c => c.renameWindow(),
  }),
  define({
    id: 'window.kill', scope: 'tab', group: 'window', label: '端末を終了…',
    aliases: ['ウィンドウを閉じる…'], hint: 'tmux ごと', danger: true,
    when: c => !c.screen, disabledReason: c => (c.hasWindow ? null : NO_WINDOW), run: c => c.killWindow(),
  }),

  // ---- パネル
  define({
    id: 'panel.toggleFocus', scope: 'panel', group: 'panel', label: 'パネルを最大化 / 並びに戻す',
    aliases: ['このパネルを広げる / 元に戻す'], hint: 'Alt+Enter',
    menuLabel: c => (c.maximized ? '並びに戻す' : 'パネルを最大化'),
    disabledReason: c => (c.multiple ? null : ONE_PANEL), run: c => c.toggleFocus(),
  }),
  define({
    id: 'panel.close', scope: 'strip', group: 'panel', label: 'このパネルを閉じる',
    menuLabel: c => `このパネル（${c.tabCount} タブ）`,
    disabledReason: c => (c.closable ? null : ONE_PANEL), run: c => c.closePanel(),
  }),

  // ---- ワークスペース（コード上は desktop）
  define({
    id: 'desktop.rename', scope: 'desktop', group: 'workspace', label: 'ワークスペースの名前を変更…', menuLabel: '名前を変更…',
    aliases: ['デスクトップの名前を変更…', '現在のデスクトップの名前を変更'],
    run: c => c.rename(),
  }),
  define({
    id: 'desktop.new', scope: 'desktop', group: 'workspace', label: '新しいワークスペース', hint: 'Alt+Shift+N',
    aliases: ['デスクトップを追加', 'ワークスペースを追加'],
    run: c => c.create(),
  }),
  define({
    id: 'desktop.moveLeft', scope: 'desktop', group: 'workspace', label: 'ワークスペースを左へ移す', menuLabel: '左へ移す',
    disabledReason: c => (c.index <= 0 ? 'いちばん左にあります' : null),
    run: c => c.move(-1),
  }),
  define({
    id: 'desktop.moveRight', scope: 'desktop', group: 'workspace', label: 'ワークスペースを右へ移す', menuLabel: '右へ移す',
    disabledReason: c => (c.index >= c.count - 1 ? 'いちばん右にあります' : null),
    run: c => c.move(1),
  }),
  define({
    id: 'desktop.remove', scope: 'desktop', group: 'workspace', label: 'ワークスペースを削除…', danger: true,
    aliases: ['デスクトップを削除', 'デスクトップの配置を削除'],
    disabledReason: c => (c.count <= 1 ? 'ワークスペースが 1 つだけのときは削除できません' : null),
    run: c => c.remove(),
  }),

  // ---- 一覧（サイドバー）
  define({
    id: 'list.byProject', scope: 'list', group: 'list', label: 'プロジェクト別に並べる', menuLabel: 'プロジェクト別',
    aliases: ['並べ方', 'プロジェクト別'],
    hint: c => (c.groupBy === 'project' ? '選択中' : undefined), run: c => c.setGroupBy('project'),
  }),
  define({
    id: 'list.bySession', scope: 'list', group: 'list', label: 'セッション別に並べる', menuLabel: 'セッション別',
    aliases: ['並べ方', 'セッション別', 'tmux の構造'],
    hint: c => (c.groupBy === 'session' ? '選択中' : undefined), run: c => c.setGroupBy('session'),
  }),
  define({
    id: 'list.cleanUp', scope: 'list', group: 'list', label: '未使用の端末を片付ける…', danger: true,
    aliases: ['片付ける', '未使用のウィンドウを閉じる'],
    hint: c => (c.closable ? `${c.closable} 枚` : undefined),
    disabledReason: c => (c.closable ? null : '片付けられる未使用の端末はありません'), run: c => c.cleanUp(),
  }),
  define({
    id: 'list.collapseAll', scope: 'list', group: 'list', label: 'すべて折りたたむ',
    when: c => !!c.collapseAll, run: c => c.collapseAll?.(),
  }),
  define({
    id: 'list.expandAll', scope: 'list', group: 'list', label: 'すべて広げる',
    when: c => !!c.expandAll && !!c.anyCollapsed, run: c => c.expandAll?.(),
  }),
  define({
    id: 'list.manageDevices', scope: 'list', group: 'list', label: 'デバイス接続を管理…',
    aliases: ['デバイスを追加', '接続先'], run: c => c.manageDevices(),
  }),
  define({
    id: 'list.close', scope: 'list', group: 'list', label: '一覧を閉じる', hint: 'Alt+B', shortcutLabel: '一覧を開く / 閉じる',
    aliases: ['サイドバーを閉じる', 'セッション一覧'], when: c => !!c.close, run: c => c.close?.(),
  }),

  // ---- 一覧のデバイス見出し
  define({
    id: 'device.screen', scope: 'device', group: 'screen', label: 'このデバイスのリモートデスクトップを開く', menuLabel: 'リモートデスクトップを開く',
    disabledReason: c => (c.connected ? null : 'このデバイスは接続していません'), run: c => c.openScreen(),
  }),
  define({
    id: 'device.select', scope: 'device', group: 'list', label: 'このデバイスを選ぶ',
    disabledReason: c => (c.selected ? '選択中です' : null), run: c => c.select(),
  }),
  define({
    id: 'device.manage', scope: 'device', group: 'list', label: 'デバイスの接続設定…', menuLabel: '接続設定…',
    run: c => c.manage(),
  }),

  // ---- 一覧の行（端末・セッション・プロジェクト）
  define({
    id: 'row.open', scope: 'row', group: 'list', label: 'タブで開く', run: c => c.open(),
  }),
  define({
    id: 'row.openRight', scope: 'row', group: 'list', label: '右に並べて開く',
    when: c => !!c.openSide, run: c => c.openSide?.('right'),
  }),
  define({
    id: 'row.openBottom', scope: 'row', group: 'list', label: '下に並べて開く',
    when: c => !!c.openSide, run: c => c.openSide?.('bottom'),
  }),
  define({
    id: 'row.peek', scope: 'row', group: 'list', label: 'のぞく', aliases: ['プレビュー'],
    when: c => !!c.peek, run: c => c.peek?.(),
  }),
  define({
    id: 'row.newTerminal', scope: 'row', group: 'list', label: 'このグループで新しい端末を開く', menuLabel: 'ここに新しい端末',
    aliases: ['ウィンドウを追加'], when: c => !!c.newTerminal, run: c => c.newTerminal?.(),
  }),
  define({
    id: 'row.rename', scope: 'row', group: 'list', label: '一覧の項目の名前を変更…', menuLabel: '名前を変更…',
    when: c => !!c.rename, run: c => c.rename?.(),
  }),
  define({
    id: 'row.cleanUp', scope: 'row', group: 'list', label: 'このグループの未使用の端末を片付ける…', menuLabel: '未使用の端末を片付ける…',
    danger: true, hint: c => (c.closable ? `${c.closable} 枚` : undefined),
    when: c => c.kind !== 'window' && !!c.cleanUp,
    disabledReason: c => (c.closable ? null : '片付けられる未使用の端末はありません'), run: c => c.cleanUp?.(),
  }),
  define({
    id: 'row.killWindow', scope: 'row', group: 'window', label: 'この端末を終了…', menuLabel: '端末を終了…',
    aliases: ['ウィンドウを閉じる'], danger: true,
    when: c => c.kind === 'window' && !!c.kill, run: c => c.kill?.(),
  }),
  define({
    id: 'row.killSession', scope: 'row', group: 'window', label: 'tmux セッションを終了…',
    aliases: ['セッションを削除'], danger: true,
    when: c => c.kind === 'session' && !!c.kill, run: c => c.kill?.(),
  }),

  // ---- 文字サイズ
  define({
    id: 'font.larger', scope: 'view', group: 'font', label: '文字を大きく', menuLabel: '大きく', hint: '+1px',
    run: c => c.setFontSize(f => Math.min(28, f + 1)),
  }),
  define({
    id: 'font.smaller', scope: 'view', group: 'font', label: '文字を小さく', menuLabel: '小さく', hint: '-1px',
    disabledReason: c => (c.fontSize <= 6 ? 'これより小さくできません' : null),
    run: c => c.setFontSize(f => Math.max(6, f - 1)),
  }),
  define({
    id: 'font.min', scope: 'view', group: 'font', label: '文字サイズを最小にする', menuLabel: '最小にする', hint: '6px',
    run: c => c.setFontSize(() => 6),
  }),
  define({
    id: 'font.reset', scope: 'view', group: 'font', label: '文字サイズを既定に戻す', menuLabel: '既定に戻す', hint: '13px',
    run: c => c.setFontSize(() => 13),
  }),

  // ---- 行間
  define({
    id: 'lineHeight.wider', scope: 'view', group: 'lineHeight', label: '行間を広げる', menuLabel: '広げる', hint: '+0.01',
    run: c => c.stepLineHeight(0.01),
  }),
  define({
    id: 'lineHeight.narrower', scope: 'view', group: 'lineHeight', label: '行間を詰める', menuLabel: '詰める', hint: '-0.01',
    disabledReason: c => (c.lineHeight <= 1 ? 'これより詰められません' : null),
    run: c => c.stepLineHeight(-0.01),
  }),
  define({
    id: 'lineHeight.min', scope: 'view', group: 'lineHeight', label: '行間を最小にする', menuLabel: '最小にする', hint: '1.00',
    run: c => c.setLineHeight(1),
  }),
  define({
    id: 'lineHeight.reset', scope: 'view', group: 'lineHeight', label: '行間を既定に戻す', menuLabel: '既定に戻す', hint: '1.15',
    run: c => c.setLineHeight(1.15),
  }),
];

export const FAMILIES: CommandFamily[] = [
  family({
    id: 'create.terminalOnDevice', scope: 'create', group: 'create', label: '{デバイス} で端末を開く',
    // 入力先のデバイスは『新しい端末』と同じなので、ここには出さない
    items: c => c.devices.filter(d => d.id !== c.current),
    itemLabel: (_c, d) => `${d.name} で端末を開く`, itemMenuLabel: (_c, d) => d.name,
    disabledReason: (_c, d) => (d.connected ? null : 'このデバイスは接続していません'),
    run: (c, d) => c.newTerminal(d.id),
  }),
  family({
    id: 'create.screenOnDevice', scope: 'create', group: 'screen', label: '{デバイス} のリモートデスクトップを開く',
    // 入力先のデバイスを先頭に
    items: c => [...c.devices].sort((a, b) => Number(b.id === c.current) - Number(a.id === c.current)),
    itemLabel: (_c, d) => `${d.name} のリモートデスクトップを開く`, itemMenuLabel: (_c, d) => d.name,
    hint: (c, d) => (d.id === c.current ? '入力先' : undefined),
    disabledReason: (_c, d) => (d.connected ? null : 'このデバイスは接続していません'),
    run: (c, d) => c.openScreen(d.id),
  }),
  family({
    id: 'screen.switchDevice', scope: 'screen', group: 'screen', label: '{デバイス} の画面に切り替え',
    items: c => c.devices.filter(d => d.id !== c.current),
    itemLabel: (_c, d) => `${d.name} の画面に切り替え`, itemMenuLabel: (_c, d) => d.name,
    disabledReason: (_c, d) => (d.connected === false ? 'このデバイスは接続していません' : null),
    run: (c, d) => c.switchDevice(d.id),
  }),
  family({
    id: 'row.moveTo', scope: 'row', group: 'list', label: 'セッション「{名前}」へ移す',
    items: c => (c.moveTo ? c.sessions : []),
    itemLabel: (_c, s) => `セッション「${s.name}」へ移す`, itemMenuLabel: (_c, s) => s.name,
    run: (c, s) => c.moveTo?.(s.id),
  }),
  family({
    id: 'row.mergeInto', scope: 'row', group: 'list', label: 'セッション「{名前}」とまとめる…',
    items: c => (c.mergeInto ? c.sessions : []),
    itemLabel: (_c, s) => `セッション「${s.name}」とまとめる…`, itemMenuLabel: (_c, s) => `${s.name}…`,
    run: (c, s) => c.mergeInto?.(s.id),
  }),
  family({
    id: 'tab.moveToDesktop', scope: 'tab', group: 'tab', label: 'ワークスペース「{名前}」へ移す',
    aliases: ['{デスクトップ} へ移動'],
    items: c => c.desktops, itemLabel: (_c, d) => `ワークスペース「${d.name}」へ移す`,
    run: (c, d) => c.moveToDesktop(d.id),
  }),
  family({
    id: 'tab.moveToPanel', scope: 'tab', group: 'tab', label: '「{タブ名}」のパネルへ移す',
    aliases: ['パネル {番号} へ移動'],
    items: c => c.panels, itemLabel: (_c, p) => `「${p.name}」のパネルへ移す`,
    hint: (_c, p) => `${p.tabs} タブ`,
    run: (c, p) => c.moveToPanel(p.id),
  }),
];

const commandById = new Map(COMMANDS.map(c => [c.id, c]));
const familyById = new Map(FAMILIES.map(f => [f.id, f]));

export function findCommand(id: string): Command | undefined {
  return commandById.get(id);
}

/**
 * メニューの 1 行。id だけか、そのメニューでだけヒントや 1 文字キーを付けるときは {id, hint, accel}。
 * {heading} は段の見出し、{submenu, items} は 1 段だけのサブメニュー（中にサブメニューは置けない）。
 */
export type MenuSlot =
  | string
  | { id: string; hint?: string; accel?: string; label?: string; side?: readonly string[] }
  | { heading: string }
  | { submenu: string; items: readonly MenuSlot[]; accel?: string }
  | null;

/** 区切り線。ContextMenu の SEP と同じ値 */
export const SEP = null;

/**
 * 並び（MenuSlot の列）と文脈からメニューの項目を作る。
 * when が false の操作は出さない。文脈の欄が無い操作は、押せない項目として出す。
 * 続いた区切り線は 1 本にまとめ、先頭と末尾に残った区切り線は落とす。
 */
export function buildMenu(slots: readonly MenuSlot[], ctx: CommandContext, nested = false): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const slot of slots) {
    if (slot === null) { out.push(SEP); continue; }
    if (typeof slot !== 'string' && 'heading' in slot) { out.push({ heading: true, label: slot.heading }); continue; }
    if (typeof slot !== 'string' && 'submenu' in slot) {
      if (nested) throw new Error(`nested submenu: ${slot.submenu}`);
      const items = buildMenu(slot.items, ctx, true);
      // 中身が全部出ないときは、サブメニューごと出さない
      if (items.some(e => e && !('heading' in e))) out.push({ label: slot.submenu, accel: slot.accel, submenu: items, run: () => {} });
      continue;
    }
    const id = typeof slot === 'string' ? slot : slot.id;
    const override = typeof slot === 'string' ? undefined : slot.hint;
    const accel = typeof slot === 'string' ? undefined : slot.accel;
    const labelOverride = typeof slot === 'string' ? undefined : slot.label;
    const sideIds = typeof slot === 'string' ? undefined : slot.side;
    const fam = familyById.get(id);
    if (fam) {
      const section = ctx[fam.scope];
      if (!section) continue;
      for (const item of fam.items(section)) {
        const reason = fam.disabledReason?.(section, item) ?? null;
        out.push({
          label: fam.itemMenuLabel?.(section, item) ?? fam.itemLabel(section, item),
          hint: override ?? fam.hint?.(section, item),
          accel,
          disabled: reason !== null,
          disabledReason: reason ?? undefined,
          danger: fam.danger,
          run: () => fam.run(section, item),
        });
      }
      continue;
    }
    const command = commandById.get(id);
    if (!command) throw new Error(`unknown command: ${id}`);
    const section = ctx[command.scope];
    if (!section) {
      out.push({ label: typeof command.menuLabel === 'string' ? command.menuLabel : command.label, hint: override ?? (typeof command.hint === 'string' ? command.hint : undefined), disabled: true, disabledReason: '対象がありません', run: () => {} });
      continue;
    }
    if (command.when && !command.when(section)) continue;
    const reason = command.disabledReason?.(section) ?? null;
    const label = labelOverride ?? (typeof command.menuLabel === 'function' ? command.menuLabel(section) : command.menuLabel ?? command.label);
    const hint = override ?? (typeof command.hint === 'function' ? command.hint(section) : command.hint);
    // 行の右に並べる小さなボタン（新規メニューの『右に並べる』『下に並べる』）
    // 見た目は短い名前（右に並べる）、読み上げは正式な名前（新しい端末を右に並べる）
    const side = sideIds?.flatMap(sid => buildMenu([sid], ctx, true)
      .filter((e): e is MenuItem => !!e && !('heading' in e))
      .map(e => ({ ...e, ariaLabel: commandById.get(sid)?.label })));
    out.push({
      label,
      hint,
      accel,
      side: side?.length ? side : undefined,
      disabled: reason !== null,
      disabledReason: reason ?? undefined,
      danger: command.danger,
      run: () => command.run(section),
    });
  }
  // 見出しの直後が区切り・見出し・末尾なら、その見出しは落とす（中身の無い段を出さない）
  const isHead = (e: MenuEntry | undefined) => !!e && 'heading' in e;
  // 区切りが続いたら 1 本にまとめる（間の段が全部出なかったとき）
  const kept = out
    .filter((e, i) => !isHead(e) || (i + 1 < out.length && out[i + 1] !== SEP && !isHead(out[i + 1])))
    .filter((e, i, list) => e !== SEP || list[i - 1] !== SEP);
  while (kept.length && kept[0] === SEP) kept.shift();
  while (kept.length && kept[kept.length - 1] === SEP) kept.pop();
  return kept;
}

/** パレットの『操作』に出す 1 行 */
export interface PaletteCommand {
  /** 操作の id。ファミリーの項目は `id:番号` */
  key: string;
  id: string;
  label: string;
  hint?: string;
  group: CommandGroup;
  /** 検索に使う語（label・menuLabel・aliases） */
  words: string[];
  disabledReason?: string;
  danger?: boolean;
  run(): void;
}

/**
 * パレットの『操作』の一覧。文脈がある操作だけを、登録表の順に正式な名前（label）で並べる。
 * when が false の操作は出さない。exclude の id は出さない（パレット自身を開く操作など）。
 */
export function paletteCommands(ctx: CommandContext, exclude: ReadonlySet<string> = new Set()): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  for (const command of COMMANDS) {
    if (exclude.has(command.id)) continue;
    const section = ctx[command.scope];
    if (!section || (command.when && !command.when(section))) continue;
    const menuLabel = typeof command.menuLabel === 'function' ? command.menuLabel(section) : command.menuLabel;
    const hint = typeof command.hint === 'function' ? command.hint(section) : command.hint;
    const reason = command.disabledReason?.(section) ?? null;
    out.push({
      key: command.id,
      id: command.id,
      label: command.label,
      hint,
      group: command.group,
      words: [command.label, menuLabel ?? '', ...(command.aliases ?? [])],
      disabledReason: reason ?? undefined,
      danger: command.danger,
      run: () => command.run(section),
    });
  }
  for (const fam of FAMILIES) {
    if (exclude.has(fam.id)) continue;
    const section = ctx[fam.scope];
    if (!section) continue;
    fam.items(section).forEach((item, i) => {
      const label = fam.itemLabel(section, item);
      const reason = fam.disabledReason?.(section, item) ?? null;
      out.push({
        key: `${fam.id}:${i}`,
        id: fam.id,
        label,
        hint: fam.hint?.(section, item),
        group: fam.group,
        words: [label, ...(fam.aliases ?? [])],
        disabledReason: reason ?? undefined,
        danger: fam.danger,
        run: () => fam.run(section, item),
      });
    });
  }
  return out;
}

/** 空白で区切った語がすべて、名前か別名のどれかに含まれるか（大文字小文字は区別しない） */
export function matchesCommand(command: Pick<PaletteCommand, 'words' | 'hint'>, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = [...command.words, command.hint ?? ''].join(' ').toLocaleLowerCase();
  return terms.every(t => text.includes(t));
}

/** ショートカット一覧に載せる、キー表記を持つ操作（hint が文字列で、キーの形のもの） */
export function commandShortcuts(): { label: string; keys: string }[] {
  return COMMANDS
    .filter(c => typeof c.hint === 'string' && /^(Alt|Ctrl|Shift)\+/.test(c.hint))
    .map(c => ({ label: c.shortcutLabel ?? c.label, keys: c.hint as string }));
}

/**
 * 登録表のヒントに載らない、キーとマウスの操作。
 * どれもメニューには出ないので、ショートカット一覧に書いておかないと見つけられない。
 * 登録表の hint にあるキーはここに書かない（一覧は hint から作る）。
 */
export const OTHER_SHORTCUTS: readonly { label: string; keys: string }[] = [
  { label: '探す・操作（操作）', keys: 'Alt+Shift+P' },
  { label: '見えているタブ列の n 番目のタブ（分割表示では入力先のパネル、1 パネル表示ではワークスペース全体で数える）', keys: 'Alt+1〜9' },
  { label: '見えているタブ列の最後のタブ', keys: 'Alt+0' },
  { label: '前のタブ / 次のタブ（見えているタブ列の順）', keys: 'Alt+[ / Alt+]' },
  { label: '前 / 次のワークスペース', keys: 'Alt+Shift+← / →' },
  { label: '文字サイズを変える', keys: 'Ctrl+ホイール' },
  { label: 'タブを閉じる', keys: 'タブを中クリック' },
  { label: '新しい端末', keys: 'タブ列の空いた所をダブルクリック' },
  { label: 'ワークスペースの名前を変える', keys: 'ワークスペースをダブルクリック' },
  { label: '端末の文字を選ぶ（tmux がマウスを使っているとき）', keys: 'Shift+ドラッグ' },
  { label: 'ブラウザの右クリックメニューを出す', keys: 'Shift+右クリック' },
];

/** ショートカット一覧（Alt+/）の行。登録表の hint から作り、同じキーは最初の 1 つだけにして、隠れた操作を後ろに足す */
export function shortcutRows(): { label: string; keys: string }[] {
  const seen = new Set<string>();
  const fromCommands = commandShortcuts().filter(s => !seen.has(s.keys) && !!seen.add(s.keys));
  return [...fromCommands, ...OTHER_SHORTCUTS.filter(s => !seen.has(s.keys))];
}
