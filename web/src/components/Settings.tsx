import { useId, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Dialog, type DialogSpec } from './Dialog';
import { Icon } from './Icon';
import { requestInstall, useInstallState } from '../pwa';
import { approvalNotificationPermission } from '../approval-notifications';
import {
  FONT_SIZE, LINE_HEIGHT, useAltKeys, useConnectionMode, useFontSize, useInputBar, useLandscapeHideHeader,
  useLineHeight, usePhoneTabs, useStatusLine, type InputBarMode,
} from '../shared-setting';

const INPUT_BAR: { value: InputBarMode; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'always', label: '常に表示' },
  { value: 'hidden', label: '隠す' },
];

const MODES = [
  { value: 'mirror', label: 'ミラー', hint: 'ブラウザごとに見ている端末を分けます。tmux の一覧に一時的なセッションが増えます。' },
  { value: 'direct', label: '直接', hint: 'tmux のセッションに直接つなぎます。同じセッションを開いているほかの画面と、表示中の端末と大きさを共有します。' },
] as const;

function Row({ label, hint, control, id, inline }: { label: string; hint?: string; control: ReactNode; id: string; inline?: boolean }) {
  // inline：スイッチのように小さい部品は、狭い画面でも見出しの右に置いたままにする
  return <div className={`settings-row${inline ? ' inline' : ''}`}>
    <div className="settings-label">
      <span id={id}>{label}</span>
      {hint && <span className="settings-hint" id={`${id}-hint`}>{hint}</span>}
    </div>
    <div className="settings-control">{control}</div>
  </div>;
}

function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  const id = useId();
  return <Row id={id} inline label={label} hint={hint} control={
    <button type="button" role="switch" className={`settings-switch ${checked ? 'on' : ''}`} aria-checked={checked}
      aria-labelledby={id} aria-describedby={hint ? `${id}-hint` : undefined} onClick={() => onChange(!checked)}>
      <span className="settings-switch-text" aria-hidden="true">{checked ? 'オン' : 'オフ'}</span>
    </button>
  } />;
}

/** 選択肢をボタンで並べる（ラジオ） */
function Choice<T extends string>({ label, hint, value, options, onChange }: {
  label: string; hint?: string; value: T; options: readonly { value: T; label: string }[]; onChange(v: T): void;
}) {
  const id = useId();
  return <Row id={id} label={label} hint={hint} control={
    <div className="settings-choice" role="radiogroup" aria-labelledby={id} aria-describedby={hint ? `${id}-hint` : undefined}
      onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        // React は処理のあとで currentTarget を外すので、次のフレームで使う要素を先に取っておく
        const group = e.currentTarget;
        const index = options.findIndex(o => o.value === value);
        const next = options[(index + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length];
        onChange(next.value);
        requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
      }}>
      {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={o.value === value}
        tabIndex={o.value === value ? 0 : -1} className={o.value === value ? 'on' : ''}
        onClick={() => { if (o.value !== value) onChange(o.value); }}>{o.label}</button>)}
    </div>
  } />;
}

/**
 * 表示と接続。めったに変えない設定をここに集める（上バーやメニューには置かない）。
 * パレット（表示と接続…）と接続状態のポップオーバーから開く。値はすべてのワークスペースで共通。
 */
export function Settings({ versions, onOpenShortcuts, onClose }: {
  /** デバイスごとのサーバーのバージョン */
  versions: { name: string; version?: string }[];
  onOpenShortcuts(): void;
  onClose(): void;
}) {
  const [fontSize, setFontSize] = useFontSize();
  const [lineHeight, setLineHeight] = useLineHeight();
  const [inputBar, setInputBar] = useInputBar();
  const [phoneTabs, setPhoneTabs] = usePhoneTabs();
  const [hideHeader, setHideHeader] = useLandscapeHideHeader();
  const [statusLine, setStatusLine] = useStatusLine();
  const [mode, setMode] = useConnectionMode();
  const [altKeys, setAltKeys] = useAltKeys();
  const install = useInstallState();
  const [notificationPermission, setNotificationPermission] = useState(approvalNotificationPermission);
  const [requestingNotification, setRequestingNotification] = useState(false);
  async function allowNotifications() {
    setRequestingNotification(true);
    try {
      await Notification.requestPermission();
    } catch {
      // ブラウザが許可ダイアログを出せない場合は、現在の権限を表示する。
    } finally {
      setNotificationPermission(approvalNotificationPermission());
      setRequestingNotification(false);
    }
  }
  const [confirm, setConfirm] = useState<DialogSpec | null>(null);
  const fontId = useId();
  const lineId = useId();
  const clampFont = (v: number) => Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, v));
  const lineValue = Math.min(LINE_HEIGHT.max, lineHeight);
  const modeHint = MODES.find(m => m.value === mode)!.hint;
  return <Modal title="表示と接続" className="settings-modal" onClose={onClose}>
    <div className="settings-body">
      <section aria-labelledby={`${fontId}-section`}>
        <h3 id={`${fontId}-section`}>表示</h3>
        <Row id={fontId} label="文字サイズ" hint="端末の上で Ctrl+ホイールでも変えられます" control={
          <div className="settings-stepper" role="group" aria-labelledby={fontId}>
            <button type="button" className="btn" aria-label="文字を小さく" disabled={fontSize <= FONT_SIZE.min}
              onClick={() => setFontSize(v => clampFont(v - 1))}>－</button>
            <output className="settings-value" aria-live="polite">{fontSize}px</output>
            <button type="button" className="btn" aria-label="文字を大きく" disabled={fontSize >= FONT_SIZE.max}
              onClick={() => setFontSize(v => clampFont(v + 1))}>＋</button>
            <button type="button" className="btn" disabled={fontSize === FONT_SIZE.initial}
              onClick={() => setFontSize(FONT_SIZE.initial)}>既定に戻す</button>
          </div>
        } />
        <Row id={lineId} label="行間" control={
          <div className="settings-slider" role="group" aria-labelledby={lineId}>
            <input type="range" aria-labelledby={lineId} min={LINE_HEIGHT.min} max={LINE_HEIGHT.max} step={0.01}
              value={lineValue} aria-valuetext={lineHeight.toFixed(2)}
              onChange={e => setLineHeight(Math.round(Number(e.target.value) * 100) / 100)} />
            <output className="settings-value">{lineHeight.toFixed(2)}</output>
            <button type="button" className="btn" disabled={lineHeight === LINE_HEIGHT.initial}
              onClick={() => setLineHeight(LINE_HEIGHT.initial)}>既定に戻す</button>
          </div>
        } />
        <Switch label="tmux のステータス行" hint="端末の下端に tmux のステータス行を出します" checked={statusLine} onChange={setStatusLine} />
        <Switch label="スマホでタブ列を表示" hint="オフのときは見出しを 1 行にまとめ、タブは『現在のタブ ▾』の一覧から選びます。オンにすると、ワークスペースタブとタブ列を並べます" checked={phoneTabs} onChange={setPhoneTabs} />
        <Switch label="横持ちで見出しを隠す" hint="横持ちのスマホで端末を広く使います。画面の上端をタップするか、上へフォーカスを移すと戻ります" checked={hideHeader} onChange={setHideHeader} />
      </section>
      <section aria-labelledby={`${fontId}-input`}>
        <h3 id={`${fontId}-input`}>入力</h3>
        <Choice<InputBarMode> label="入力行" hint="自動：タッチ操作の端末と狭い画面で出します" value={inputBar} options={INPUT_BAR} onChange={setInputBar} />
        <Switch label="Alt ショートカットを使う" hint="オフにすると、Alt キーの組み合わせはすべて端末にそのまま届きます"
          checked={altKeys} onChange={setAltKeys} />
        <Row id={`${fontId}-shortcuts`} label="ショートカット一覧" control={
          <button type="button" className="btn" onClick={onOpenShortcuts}>ショートカット一覧を開く <kbd>Alt+/</kbd></button>
        } />
      </section>
      <section aria-labelledby={`${fontId}-conn`}>
        <h3 id={`${fontId}-conn`}>接続</h3>
        <Choice<"mirror" | "direct"> label="接続方式" hint={modeHint} value={mode} options={MODES} onChange={next => setConfirm({
          kind: 'confirm',
          title: `接続方式を『${MODES.find(m => m.value === next)!.label}』に切り替えますか？`,
          detail: '開いている端末をすべてつなぎ直します。tmux と実行中の処理はそのまま続きます。',
          confirmLabel: '切り替える',
          danger: false,
          onSubmit: () => setMode(next),
        })} />
      </section>
      <section aria-labelledby={`${fontId}-app`}>
        <h3 id={`${fontId}-app`}>アプリ</h3>
        <Row id={`${fontId}-install`} label="アプリとして追加"
          hint={install.installed ? 'アプリとして開いています' : '専用ウィンドウで開き、アプリ一覧やDockから起動できます'}
          control={!install.installed && <button type="button" className="btn"
            disabled={install.busy} onClick={() => void requestInstall()}><Icon name="download" />アプリとして追加</button>} />
        {notificationPermission !== 'unsupported' && <Row id={`${fontId}-sudo-notifications`} label="sudo の OS 通知"
          hint={notificationPermission === 'denied' ? '通知がブロックされています。ブラウザやOSの通知設定で許可できます。'
            : 'アプリの起動中に sudo の承認が必要になると通知します。'}
          control={notificationPermission === 'default'
            ? <button type="button" className="btn" disabled={requestingNotification}
              onClick={() => void allowNotifications()}>通知を許可</button>
            : <output className="settings-value">{notificationPermission === 'granted' ? '許可済み' : 'ブロック中'}</output>} />}
        <Row id={`${fontId}-version`} label="バージョン" control={
          <ul className="settings-versions">
            {versions.length === 0 && <li>不明</li>}
            {versions.map(v => <li key={v.name}><span>{v.name}</span> <span className="settings-value">{v.version ?? '不明'}</span></li>)}
          </ul>
        } />
      </section>
    </div>
    {confirm && <Dialog spec={confirm} onClose={() => setConfirm(null)} />}
  </Modal>;
}
