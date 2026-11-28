import type { Device } from '../devices';
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchDesktopStatus, measureDesktopRoundTrip, readDesktopClipboard, wsUrl } from '../api';
import { clipboardPageFocused, startDesktopClipboardSync } from '../desktop-clipboard-sync';
import type { ScreenContext } from '../commands';
import { screenMenuItems } from '../menus';
import { DESKTOP_SETTINGS_KEY, desktopPresets, loadDesktopSettings, type DesktopSettings } from '../desktop-settings';
import { claimScreen, joinScreen, ownsScreen, releaseScreen, screenOwner, type ScreenLeaseEntry } from '../screen-lease';
import type { LosslessRFB } from '../vendor/lossless-rfb';
import { Icon } from './Icon';
import { Dialog } from './Dialog';
import { Modal } from './Modal';
import { ContextMenu } from './ContextMenu';

/** 隠れてからこの時間が経ったら切断する。すぐ戻ってきたときは繋いだまま見せる */
export const SCREEN_IDLE_MS = 30_000;
/** お知らせを出しておく時間 */
export const SCREEN_NOTICE_MS = 5_000;
/** タイルの幅がこれ以下なら、見出しから Esc と状態の文字を外す（Esc は ⋯ へ） */
export const SCREEN_NARROW_PX = 290;

/** 画面へ送る修飾キー（入力行の Ctrl / Alt） */
export interface ScreenModifiers { ctrl?: boolean; alt?: boolean }

/** タイルに置いた画面タブを、端末と同じ口で扱うための取っ手 */
export interface ScreenHandle {
  kind: 'screen';
  /** 操作をリモートへ送れるよう、画面にキーボードのフォーカスを移す */
  focus(): void;
  /** 大きさは noVNC が自分で追従するので何もしない（端末と同じ呼び方をするため） */
  fit(): void;
  /** 画面メニューの文脈（いまの状態と操作） */
  context(): ScreenContext;
  /** キーを 1 回押して離す。mods の修飾キーはその間だけ押す */
  pressKey(keysym: number, code: string, mods?: ScreenModifiers): void;
  /** 文字入力を開く */
  openText(): void;
}

export interface ScreenStatus {
  connected: boolean;
  message?: string;
}

interface Props {
  /** modal = ダイアログで大きく表示 / tile = タブとしてタイルの中に置く */
  variant: 'modal' | 'tile';
  deviceId: string;
  devices?: Device[];
  deviceName?: string;
  clipboardEnabled: boolean;
  /** タイルで前面に出ているか（隠れて SCREEN_IDLE_MS 経つと切断する） */
  visible?: boolean;
  /** タイル見出しの差し込み口。状態・見るだけ・⌨・Esc をここに出す（無ければ画面の上に出す） */
  headSlot?: HTMLElement | null;
  /** スマホ：タイル見出しが隠れているので、状態と見るだけのバッジを画面の右上に重ねる（⌨ と Esc は入力行にある） */
  floatHead?: boolean;
  /** モーダルを閉じる */
  onClose?(): void;
  /** モーダルで見ている画面をタブとして開く（タブに戻す） */
  onOpenAsTab?(deviceId: string): void;
  onStatus?(status: ScreenStatus): void;
}

const ESCAPE = 0xff1b;
const RETURN = 0xff0d;
const CONTROL = 0xffe3;
const ALT = 0xffe9;

function sendPaste(rfb: LosslessRFB) {
  rfb.releaseAllKeys();
  rfb.sendKey(CONTROL, 'ControlLeft', true);
  rfb.sendKey(0x76, 'KeyV');
  rfb.sendKey(CONTROL, 'ControlLeft', false);
}

/** 文字を 1 文字ずつのキー（keysym）にする。X11 の決まりで Latin-1 以外は 0x01000000 + コードポイント */
export function keysymFor(ch: string): number {
  if (ch === '\n') return RETURN;
  if (ch === '\t') return 0xff09;
  const cp = ch.codePointAt(0) ?? 0;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
  return 0x01000000 + cp;
}

const presetOrder = ['balanced', 'responsive', 'sharp', 'lan'] as const;
type PresetId = typeof presetOrder[number];
const presetOf = (value: DesktopSettings): PresetId | null =>
  presetOrder.find(id => {
    const p = desktopPresets[id];
    return p.lossless === value.lossless && p.quality === value.quality && p.compression === value.compression && p.scale === value.scale && p.interval === value.interval;
  }) ?? null;

/** 画質モーダル。プリセットはラジオ、細かい値は『詳細』に畳む。保存は『適用して再接続』のときだけ */
function ScreenQuality({ settings, onApply, onClose }: { settings: DesktopSettings; onApply(value: DesktopSettings): void; onClose(): void }) {
  const [draft, setDraft] = useState(settings);
  const current = presetOf(settings);
  const chosen = presetOf(draft);
  const name = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return <Modal title="画質" onClose={onClose} className="screen-quality">
    <div className="screen-quality-body">
      <fieldset className="screen-presets">
        <legend>プリセット</legend>
        {presetOrder.map(id => <label key={id} className="screen-preset">
          <input ref={id === (chosen ?? 'balanced') ? first : undefined} type="radio" name={name} checked={chosen === id}
            onChange={() => { const { label: _label, ...values } = desktopPresets[id]; setDraft({ ...values }); }} />
          <span>{desktopPresets[id].label}{id === 'balanced' ? '〈既定〉' : ''}</span>
          {current === id && <span className="screen-preset-current">使用中</span>}
        </label>)}
        {!chosen && <p className="screen-preset-custom">いまは詳細で調整した値です{current === null ? '（使用中）' : ''}</p>}
      </fieldset>
      <details className="screen-quality-detail">
        <summary>詳細</summary>
        <div className="desktop-settings-fields">
          <label>画質方式<select value={draft.lossless ? 'lossless' : 'jpeg'} onChange={e => setDraft(v => ({ ...v, lossless: e.target.value === 'lossless' }))}>
            <option value="jpeg">JPEG（通信量を削減）</option><option value="lossless">可逆圧縮（文字を鮮明に）</option>
          </select></label>
          <label>配信サイズ<select value={draft.scale} onChange={e => setDraft(v => ({ ...v, scale: e.target.value as DesktopSettings['scale'] }))}>
            <option value="1">100%（縮小なし）</option><option value="0.75">75%</option><option value="0.5">50%</option>
          </select></label>
          <label>更新間隔<select value={draft.interval} onChange={e => setDraft(v => ({ ...v, interval: e.target.value as DesktopSettings['interval'] }))}>
            <option value="16">16 ms（滑らか・高負荷）</option><option value="33">33 ms（標準）</option><option value="66">66 ms（負荷を抑える）</option><option value="100">100 ms（省通信）</option>
          </select></label>
          <label>JPEG 品質：{draft.quality}<input type="range" min="0" max="9" value={draft.quality} disabled={draft.lossless} onChange={e => setDraft(v => ({ ...v, quality: Number(e.target.value) }))} /></label>
          <label>圧縮レベル：{draft.compression}<input type="range" min="0" max="9" value={draft.compression} onChange={e => setDraft(v => ({ ...v, compression: Number(e.target.value) }))} /></label>
        </div>
        <p>圧縮を上げると通信量は減り、処理負荷は増えます。配信サイズはこの接続だけに適用します。更新間隔は目安で、FPS の保証ではありません。</p>
      </details>
      <p className="screen-quality-help">同じ LAN では「LAN 高画質」、回線が遅いときは「低遅延」、文字を読むときは「文字くっきり」。</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>キャンセル</button>
        <button className="btn primary" onClick={() => onApply(draft)}>適用して再接続</button>
      </div>
    </div>
  </Modal>;
}

export const RemoteScreen = forwardRef<ScreenHandle, Props>(function RemoteScreen(
  { variant, deviceId, devices = [], deviceName, visible = true, clipboardEnabled, headSlot, floatHead = false, onClose, onOpenAsTab, onStatus },
  ref,
) {
  const modal = variant === 'modal';
  const ids = useId();
  const clipboardId = `${ids}-clipboard`, textId = `${ids}-text`;
  // モーダルは中でデバイスを切り替えられる。タブはタブが指すデバイスに固定（切り替えは App がタブを差し替える）
  const [modalDeviceId, setModalDeviceId] = useState(deviceId);
  const selectedDeviceId = modal ? modalDeviceId : deviceId;
  const selectedDevice = devices.find(device => device.id === selectedDeviceId);
  const selectedName = selectedDevice?.name || deviceName || 'デバイス';
  const selectionVersion = useRef(0);
  const selectedIdRef = useRef(selectedDeviceId);
  selectedIdRef.current = selectedDeviceId;
  const [attempt, setAttempt] = useState(0);
  /** Ctrl+Alt+Del はロック画面やタスクマネージャーを出すので、送る前に確認する */
  const [confirmCad, setConfirmCad] = useState(false);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('画面に接続中…');
  const [error, setError] = useState('');
  const [fit, setFit] = useState(true);
  const [viewOnly, setViewOnly] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  /** ダイアログの ⋯ で開いた画面メニューの位置 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const textRef = useRef(text); textRef.current = text;
  /** 接続先から受け取ったクリップボード。書きかけの下書きは上書きせず、チップで知らせる */
  const [received, setReceived] = useState<string | null>(null);
  // 同じ文言をもう一度出したときも 5 秒を数え直すよう、出した回数も持つ
  const [noticeState, setNoticeState] = useState({ text: '', n: 0 });
  const notice = noticeState.text;
  const setNotice = (value: string) => setNoticeState(prev => ({ text: value, n: prev.n + 1 }));
  const [copying, setCopying] = useState(false);
  const copyLock = useRef(false);
  const clipboardText = useRef<HTMLTextAreaElement>(null);
  const textToggle = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [full, setFull] = useState(false);
  const [settings, setSettings] = useState(loadDesktopSettings);
  const [roundTrip, setRoundTrip] = useState<number | null>(null);
  const [sourceSize, setSourceSize] = useState('');
  const [narrow, setNarrow] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const client = useRef<LosslessRFB | null>(null);
  const clipboardSync = useRef<ReturnType<typeof startDesktopClipboardSync> | null>(null);
  const clipboardEnabledRef = useRef(clipboardEnabled);
  clipboardEnabledRef.current = clipboardEnabled;
  useLayoutEffect(() => { if (!clipboardEnabled) clipboardSync.current?.reset(); }, [clipboardEnabled]);
  const fitRef = useRef(fit); fitRef.current = fit;
  const viewRef = useRef(viewOnly); viewRef.current = viewOnly;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const statusRef = useRef(onStatus); statusRef.current = onStatus;
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const popoverOpen = textOpen || !!menuAt;
  /** 画面へキー入力が届くようにする（接続前は枠にフォーカスを置く） */
  const focusScreen = () => {
    if (client.current && connected) client.current.focus();
    else panel.current?.focus();
  };
  const closeText = () => {
    setTextOpen(false);
    requestAnimationFrame(() => (textToggle.current ?? panel.current)?.focus());
  };
  const closePopovers = () => {
    if (menuAt) { setMenuAt(null); requestAnimationFrame(() => moreButton.current?.focus()); }
    if (textOpen) closeText();
  };
  const dismissRef = useRef(() => {});
  dismissRef.current = () => {
    if (popoverOpen) closePopovers();
    else closeRef.current?.();
  };
  /** 画質・ガイドを閉じたら、開いた場所（ダイアログの ⋯、タブでは画面）へ戻す */
  const afterModal = () => requestAnimationFrame(() => {
    if (modal && moreButton.current) moreButton.current.focus();
    else focusScreen();
  });

  // ---------------------------------------------------------- 表示と接続の持ち主
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const wants = visible && pageVisible;
  const wantsRef = useRef(wants); wantsRef.current = wants;
  /** 隠れても SCREEN_IDLE_MS のあいだは繋いだままにする */
  const [live, setLive] = useState(wants);
  useEffect(() => {
    if (wants) { setLive(true); return; }
    client.current?.releaseAllKeys();
    const timer = setTimeout(() => setLive(false), SCREEN_IDLE_MS);
    return () => clearTimeout(timer);
  }, [wants]);

  const [, leaseChanged] = useReducer((n: number) => n + 1, 0);
  const lease = useRef<ScreenLeaseEntry>({ wants: () => wantsRef.current, changed: leaseChanged }).current;
  useEffect(() => joinScreen(selectedDeviceId, lease), [selectedDeviceId, lease]);
  // 表示されたら接続を取りにいく（ほかで繋いでいたものは手放す）
  useLayoutEffect(() => { if (wants) claimScreen(selectedDeviceId, lease); }, [wants, selectedDeviceId, lease]);
  // 切断の時間が来たら手放し、待っているほかの表示に譲る
  useEffect(() => { if (!live) releaseScreen(selectedDeviceId, lease); }, [live, selectedDeviceId, lease]);
  const owner = ownsScreen(selectedDeviceId, lease);
  const connectable = live && owner;
  /** ほかの場所（モーダルや別のタブ）がこの画面を表示している */
  // 表示した直後の 1 フレーム（まだ claim 前）に「別の場所」と出さないよう、実際にほかが持っているときだけ
  const elsewhere = wants && !owner && screenOwner(selectedDeviceId) !== undefined;

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      // Escape/Tab inside the desktop belong to the remote application.
      if (viewport.current?.contains(e.target as Node)) return;
      if (e.key === 'Escape') { e.stopPropagation(); dismissRef.current(); }
      if (e.key === 'Tab') {
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, textarea, select, input:not(:disabled), canvas') ?? [])].filter(el=>el.getClientRects().length);
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [modal]);

  // 全画面のままタブを切り替えると、隠れた要素が全画面に残って何も見えなくなる
  useEffect(() => {
    if (!visible && panel.current && document.fullscreenElement === panel.current) void document.exitFullscreen().catch(() => {});
  }, [visible]);

  useEffect(() => {
    const fullscreen = () => setFull(document.fullscreenElement === panel.current);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => document.removeEventListener('fullscreenchange', fullscreen);
  }, []);

  // 狭いタイルでは、見出しから Esc と状態の文字を外す
  useEffect(() => {
    const el = panel.current;
    if (modal || !el) return;
    const measure = () => { if (el.clientWidth > 0) setNarrow(el.clientWidth <= SCREEN_NARROW_PX); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [modal]);

  // 文字入力を開いたら入力欄へ
  useEffect(() => {
    if (textOpen) panel.current?.querySelector<HTMLElement>(`#${CSS.escape(textId)}`)?.focus();
  }, [textOpen, textId]);

  // お知らせは一定時間で消す（× でもすぐ消せる）
  useEffect(() => {
    if (!noticeState.text) return;
    const timer = setTimeout(() => setNoticeState(prev => ({ ...prev, text: '' })), SCREEN_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [noticeState]);

  // 他の画面で設定を変えたら、次の接続から同じ設定を使う
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== DESKTOP_SETTINGS_KEY) return;
      setSettings(loadDesktopSettings());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (!connectable) {
      // 隠れて切断した・ほかで表示中のときは、誤りではないので接続待ちの表示に戻す
      viewport.current?.replaceChildren();
      setConnected(false); setError(''); setMessage(elsewhere ? '別の場所で表示中' : '表示すると接続します');
      return;
    }
    const controller = new AbortController();
    let rfb: LosslessRFB | null = null;
    const area = viewport.current!;
    let pasteShortcut: ReturnType<typeof setTimeout> | undefined;
    const isClipboardActive = () => !controller.signal.aborted && selectedIdRef.current === selectedDeviceId &&
      clipboardEnabledRef.current && ownsScreen(selectedDeviceId, lease) && wantsRef.current && clipboardPageFocused();
    const canSend = () => isClipboardActive() && !viewRef.current;
    const canPaste = () => canSend() && area.contains(document.activeElement);
    const stopClipboard = () => {
      clearTimeout(pasteShortcut);
      area.removeEventListener('keydown', onPasteShortcut, true);
      area.removeEventListener('paste', onBrowserPaste);
      clipboardSync.current?.stop();
      clipboardSync.current = null;
    };
    const onPasteShortcut = (event: KeyboardEvent) => {
      if (!canPaste() || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'v') return;
      // noVNC would consume the shortcut before the browser dispatches a paste event.
      event.stopPropagation();
      clearTimeout(pasteShortcut);
      pasteShortcut = setTimeout(() => {
        if (canPaste() && rfb) sendPaste(rfb);
      }, 150);
    };
    const onBrowserPaste = async (event: ClipboardEvent) => {
      if (!canPaste() || !rfb || !clipboardSync.current) return;
      clearTimeout(pasteShortcut);
      event.preventDefault();
      const value = event.clipboardData?.getData('text/plain');
      try {
        if (value && !await clipboardSync.current.send(value, true, canPaste)) return;
        if (canPaste()) sendPaste(rfb);
      } catch (err) { if (canPaste()) setNotice((err as Error).message); }
    };
    viewport.current?.replaceChildren();
    setConnected(false); setError(''); setSourceSize(''); setMessage('画面を確認中…');
    void fetchDesktopStatus(controller.signal, selectedDeviceId).then(async status => {
      if (controller.signal.aborted) return;
      if (!status.available) throw new Error(status.error || '画面に接続できません');
      setSourceSize(`${status.width}×${status.height}`);
      const { LosslessRFB } = await import('../vendor/lossless-rfb');
      if (controller.signal.aborted) return;
      setMessage('画面に接続中…');
      rfb = new LosslessRFB(viewport.current!, wsUrl('/ws/desktop', { scale: settings.scale, interval: settings.interval }, selectedDeviceId));
      rfb.lossless = settings.lossless;
      client.current = rfb;
      rfb.scaleViewport = fitRef.current;
      rfb.clipViewport = false;
      rfb.resizeSession = false;
      // 縮小表示の余白は端末と同じ黒にする（noVNC の既定は灰色）
      rfb.background = '#000';
      rfb.viewOnly = viewRef.current;
      rfb.compressionLevel = settings.compression;
      rfb.qualityLevel = settings.quality;
      rfb.addEventListener('connect', () => {
        if (controller.signal.aborted) return;
        setConnected(true); setMessage('接続済み');
        // タイルでは、選んだタブの画面へそのままキー入力が届くようにする。
        // ほかの入力欄で打っている最中なら奪わない
        const active = document.activeElement;
        if (!modal && wantsRef.current && (!active || active === document.body || panel.current?.contains(active))) rfb?.focus();
        clipboardSync.current = startDesktopClipboardSync(selectedDeviceId, isClipboardActive, canSend, value => {
          if (!textRef.current) { setText(value); setReceived(null); }
          else if (value !== textRef.current) setReceived(value);
          setNotice('接続先のクリップボードを受信しました');
        });
        area.addEventListener('keydown', onPasteShortcut, true);
        area.addEventListener('paste', onBrowserPaste);
      });
      rfb.addEventListener('disconnect', () => {
        if (controller.signal.aborted) return;
        stopClipboard();
        setConnected(false); setError('接続が切れました。「再接続」で接続し直してください。');
      });
      rfb.addEventListener('securityfailure', () => {
        if (!controller.signal.aborted) setError('画面への認証に失敗しました。');
      });
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => {
      controller.abort();
      stopClipboard();
      // 押したままのキーをリモートに残さない
      rfb?.releaseAllKeys();
      rfb?.disconnect();
      client.current = null;
    };
    // elsewhere は待機中の表示文言だけに使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, settings, selectedDeviceId, connectable]);

  useEffect(() => {
    if (!connectable) setMessage(elsewhere ? '別の場所で表示中' : '表示すると接続します');
  }, [connectable, elsewhere]);

  useEffect(() => {
    statusRef.current?.({ connected, message: error || message });
  }, [connected, error, message]);

  useEffect(() => {
    if (!connected || !wants) { setRoundTrip(null); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const measure = async () => {
      // Include server/network contention, but do not label this as display latency.
      try {
        const value = await measureDesktopRoundTrip(AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]), selectedDeviceId);
        if (!controller.signal.aborted) setRoundTrip(value);
      } catch { if (!controller.signal.aborted) setRoundTrip(null); }
      if (!controller.signal.aborted) timer = setTimeout(() => void measure(), 5000);
    };
    void measure();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [connected, wants, selectedDeviceId]);

  useEffect(() => { if (client.current) client.current.scaleViewport = fit; }, [fit]);
  useEffect(() => { if (client.current) client.current.viewOnly = viewOnly; }, [viewOnly]);

  // 画面からフォーカスが外れたら、押したままのキーをリモートで離す
  // （Alt+数字でタブを移ると、Alt の keyup はリモートに届かない）
  useEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const release = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && area.contains(event.relatedTarget)) return;
      client.current?.releaseAllKeys();
    };
    area.addEventListener('focusout', release);
    return () => area.removeEventListener('focusout', release);
  }, []);

  const applySettings = (value: DesktopSettings) => {
    // Save only on apply: moving a slider must not repeatedly reconnect.
    const next = { lossless: value.lossless, quality: value.quality, compression: value.compression, scale: value.scale, interval: value.interval };
    try { localStorage.setItem(DESKTOP_SETTINGS_KEY, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
    setSettings(next); setQualityOpen(false); afterModal();
  };

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch { setNotice('このブラウザでは全画面表示を利用できません'); }
  };
  const sendEscape = () => { client.current?.sendKey(ESCAPE, 'Escape'); client.current?.focus(); };
  /** 接続先のクリップボードに入れて Ctrl+V を送る。submit なら続けて Enter */
  const paste = async (submit = false) => {
    const rfb = client.current;
    const sync = clipboardSync.current;
    if (!rfb || !sync) return;
    const current = () => selectedIdRef.current === selectedDeviceId && client.current === rfb && !viewRef.current;
    try { if (!await sync.send(text, false, current)) return; }
    catch (err) { if (current()) setNotice((err as Error).message); return; }
    if (!current()) return;
    sendPaste(rfb);
    if (submit) rfb.sendKey(RETURN, 'Enter');
    setNotice(submit ? '接続先へ貼り付けて Enter を送りました' : '接続先へ貼り付けました');
    rfb.focus();
  };
  /** 貼り付けが効かないアプリ向けに、1 文字ずつキーとして打つ */
  const typeText = () => {
    const rfb = client.current;
    if (!rfb || !text) return;
    for (const ch of text.replace(/\r\n?/g, '\n')) rfb.sendKey(keysymFor(ch), ch === '\n' ? 'Enter' : ch === '\t' ? 'Tab' : 'Unidentified');
    setNotice('キーとして送りました');
    rfb.focus();
  };
  const copy = async () => {
    if (copyLock.current) return;
    copyLock.current = true; setCopying(true); setNotice('');
    const version = selectionVersion.current;
    const isCurrent = () => selectionVersion.current === version && selectedIdRef.current === selectedDeviceId && panel.current !== null;
    try {
      const receivedText = readDesktopClipboard(selectedDeviceId).then(({ text: value }) => {
        if (!isCurrent()) throw new Error('接続先が変更されました');
        return value;
      });
      let written = false;
      // Start the browser write during the click, before the network response.
      // This preserves user activation in browsers that require it (e.g. Safari).
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          const data = receivedText.then(value => {
            if (!value) throw new Error('クリップボードが空です');
            return new Blob([value], { type: 'text/plain' });
          });
          // A denied write may never consume the promised data.
          void data.catch(() => {});
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': data })]);
          written = true;
        } catch { /* Retry with writeText or offer the received text for manual copy. */ }
      }
      const value = await receivedText;
      if (!isCurrent()) return;
      if (!value) { setNotice('接続先のクリップボードに文字がありません'); return; }
      if (!written) {
        try { await navigator.clipboard.writeText(value); written = true; }
        catch { /* Some browsers deny clipboard access or require HTTPS. */ }
      }
      if (!isCurrent()) return;
      if (written) {
        clipboardSync.current?.copied(value);
        setNotice('接続先の文字を、この端末のクリップボードにコピーしました');
      }
      else {
        // 手でコピーできるよう、取ってきた文字を入力欄に出して選ぶ（自分で頼んだコピーなので下書きを置き換える）
        setText(value); setReceived(null);
        setTextOpen(true); setMenuAt(null);
        setNotice('自動コピーが許可されていません。入力欄の文字を選択してコピーしてください');
        requestAnimationFrame(() => { if (isCurrent()) { clipboardText.current?.focus(); clipboardText.current?.select(); } });
      }
    } catch (err) { if (isCurrent()) setNotice((err as Error).message); }
    finally { copyLock.current = false; setCopying(false); }
  };
  const switchModalDevice = (id: string) => {
    selectionVersion.current++; selectedIdRef.current = id;
    setText(''); setReceived(null); setNotice(''); setRoundTrip(null); setModalDeviceId(id);
  };

  /** 画面メニューの文脈。タブでは App がダイアログ表示とデバイスの切り替えを足す */
  const context: ScreenContext = {
    ready: true,
    modal,
    connected,
    viewOnly,
    fit,
    copying,
    full,
    canFullscreen,
    narrow: !modal && narrow,
    devices: devices.map(d => ({ id: d.id, name: d.name, connected: d.connected })),
    current: selectedDeviceId,
    setViewOnly,
    setFit,
    copy: () => void copy(),
    reconnect: () => setAttempt(v => v + 1),
    sendEscape,
    toggleFullscreen: () => void fullscreen(),
    backToTab: modal && onOpenAsTab ? () => onOpenAsTab(selectedDeviceId) : undefined,
    switchDevice: id => { if (modal) switchModalDevice(id); },
    openQuality: () => { setMenuAt(null); setQualityOpen(true); },
    sendCtrlAltDel: () => setConfirmCad(true),
    openGuide: () => { setMenuAt(null); setGuideOpen(true); },
    openText: () => { setMenuAt(null); setTextOpen(true); },
  };
  const contextRef = useRef(context); contextRef.current = context;
  const focusRef = useRef(focusScreen); focusRef.current = focusScreen;

  useImperativeHandle(ref, () => ({
    kind: 'screen' as const,
    focus() { focusRef.current(); },
    fit() {},
    context: () => contextRef.current,
    pressKey(keysym, code, mods = {}) {
      const rfb = client.current;
      if (!rfb) return;
      if (mods.ctrl) rfb.sendKey(CONTROL, 'ControlLeft', true);
      if (mods.alt) rfb.sendKey(ALT, 'AltLeft', true);
      rfb.sendKey(keysym, code);
      if (mods.alt) rfb.sendKey(ALT, 'AltLeft', false);
      if (mods.ctrl) rfb.sendKey(CONTROL, 'ControlLeft', false);
    },
    openText() { setMenuAt(null); setTextOpen(true); },
  }), []);

  const statusText = connected ? '接続済み' : error ? '未接続' : elsewhere ? '別の場所で表示中' : '接続中…';
  const statusTitle = [`${selectedName} · ${statusText}`, connected ? `通信往復：${roundTrip === null ? '計測中' : `${roundTrip} ms`}` : ''].filter(Boolean).join('\n');
  /** 見出しの部品：状態・見るだけ・⌨・Esc。タブではタイル見出しへ、ダイアログと全画面では画面の上に出す */
  const headParts = (compact: boolean): ReactNode => <>
    <span className={`desktop-connection-status ${connected ? 'is-connected' : ''}`} role="status" title={statusTitle}>
      <span className={`dot ${connected ? 'ok' : error ? 'bad' : ''}`} />
      <span className={`desktop-status-text${compact && narrow ? ' sr-only' : ''}`}>{statusText}</span>
    </span>
    {viewOnly && <span className="screen-badge" title="マウス・キー操作は送りません。画面メニューの『操作する』で戻せます">見るだけ</span>}
    <button ref={textToggle} className="btn desktop-clipboard-toggle" aria-label="文字入力" title="文字入力"
      aria-expanded={textOpen} aria-controls={clipboardId}
      onClick={() => { setMenuAt(null); setTextOpen(v => !v); }}>
      <Icon name="keyboard" />{!compact && <span className="desktop-button-label">文字入力</span>}
    </button>
    {!(compact && narrow) && <button className="btn screen-esc" aria-label="Esc を送る" title="Esc を送る"
      disabled={!connected || viewOnly} onClick={sendEscape}>Esc</button>}
  </>;
  const tileHead = !modal && !full && !floatHead && headSlot && visible;
  const floating = !modal && !full && floatHead;

  const view = <div
    className={`screen-viewer desktop-viewer ${modal ? '' : 'screen-tab-view'}`}
    ref={panel}
    tabIndex={-1}
    {...(modal
      ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'リモートデスクトップ' }
      : {
        role: 'region',
        'aria-label': `${selectedName} のリモートデスクトップ`,
        hidden: !visible,
        // タイルではアプリのショートカットを奪わない。Escape は開いている小窓を閉じるだけ
        // （タイル見出しへ差し込んだ部品のキーも、React の木を通ってここへ届く）
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key !== 'Escape' || viewport.current?.contains(e.target as Node) || !popoverOpen) return;
          e.stopPropagation();
          closePopovers();
        },
      })}
  >
    {modal ? <div className="screen-head desktop-compact-head">
      <Icon name="screen" />
      <label className="desktop-device-label"><span className="desktop-device-caption">接続先</span>
        {devices.length > 1 ? <select aria-label="接続先" value={selectedDeviceId} onChange={event => switchModalDevice(event.target.value)}>
          {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select> : <strong>{selectedName}</strong>}
      </label>
      {headParts(false)}
      <button ref={moreButton} className="btn desktop-icon-button screen-more" aria-label="画面の操作" title="画面の操作" aria-haspopup="menu" aria-expanded={!!menuAt}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setTextOpen(false); setMenuAt(menuAt ? null : { x: r.right - 220, y: r.bottom }); }}><Icon name="more" /></button>
      <button className="btn desktop-icon-button" aria-label="リモートデスクトップを閉じる" title="リモートデスクトップを閉じる" onClick={onClose}><Icon name="close" /></button>
    </div> : floating ? <div className="screen-float-head">
      <span className={`desktop-connection-status ${connected ? 'is-connected' : ''}`} role="status" title={statusTitle}>
        <span className={`dot ${connected ? 'ok' : error ? 'bad' : ''}`} /><span className="sr-only">{statusText}</span>
      </span>
      {viewOnly && <span className="screen-badge">見るだけ</span>}
    </div> : !tileHead && <div className="screen-head desktop-compact-head screen-inline-head">
      <strong className="desktop-device-label">{selectedName}</strong>
      {headParts(true)}
      {full && <button className="btn desktop-icon-button" aria-label="全画面を終了" title="全画面を終了" onClick={() => void fullscreen()}><Icon name="shrink" /></button>}
    </div>}
    {tileHead && createPortal(<span className="screen-head-slot-parts">{headParts(true)}</span>, headSlot)}
    {textOpen && <div className="desktop-clipboard desktop-popover" id={clipboardId} role="group" aria-label="文字入力">
      <div className="desktop-popover-head"><strong>文字入力</strong><button className="btn desktop-icon-button" aria-label="文字入力を閉じる" onClick={closeText}><Icon name="close" /></button></div>
      <label htmlFor={textId}>{selectedName} へ送る文字（日本語入力可）</label>
      {received !== null && <button className="screen-received" onClick={() => { setText(received); setReceived(null); clipboardText.current?.focus(); }}>
        受信したテキストを使う<span>{received.length > 24 ? `${received.slice(0, 24)}…` : received}</span>
      </button>}
      <textarea ref={clipboardText} id={textId} value={text} onChange={e => setText(e.target.value)} placeholder="ここに入力して、接続先へ送る" />
      <div className="screen-controls">
        <button className="btn primary" disabled={!connected || viewOnly || !text} onClick={() => void paste()}>貼り付け（Ctrl+V）</button>
        <button className="btn" disabled={!connected || viewOnly || !text} onClick={typeText}>キーとして送る</button>
        <button className="btn" disabled={!connected || viewOnly || !text} onClick={() => void paste(true)}>送って Enter</button>
        <button className="btn" disabled={copying} onClick={() => void copy()}>{copying ? 'コピー中…' : '接続先からコピー'}</button>
      </div>
    </div>}
    <div className="desktop-stage">
      <div className="desktop-viewport" ref={viewport} aria-label="画面の操作領域" />
      {!connected && <div className="desktop-message"><div className="desktop-message-content">
        <Icon name="screen" width="32" height="32" />
        {elsewhere && !error
          ? <>
            <strong>別の場所で表示中</strong>
            <p role="status">{selectedName} の画面は、このページの別のタブかウィンドウで表示しています。同じ画面を二重に繋ぐと重くなるため、ここでは止めています。</p>
            <button className="btn primary" onClick={() => claimScreen(selectedDeviceId, lease)}><Icon name="screen" />ここで表示する</button>
            <p className="desktop-message-note">ほかの場所の表示は止まります</p>
          </>
          : <>
            <strong>{error ? '画面に接続できません' : message}</strong>
            <p role={error ? 'alert' : 'status'}>{error || `${selectedName} の画面を準備しています。`}</p>
            {error && <button className="btn primary" onClick={() => setAttempt(v => v + 1)}><Icon name="refresh" />再接続</button>}
          </>}
      </div></div>}
    </div>
    {confirmCad && <Dialog spec={{
      kind: 'confirm',
      title: `${selectedName} に Ctrl+Alt+Del を送りますか？`,
      detail: '接続先でセキュリティ画面（ロック・サインアウト・タスクマネージャー）が開きます。',
      confirmLabel: '送る',
      danger: true,
      onSubmit: () => {
        client.current?.sendCtrlAltDel();
        // 確認ダイアログが閉じてフォーカスを戻したあとで、画面へ移す
        setTimeout(() => client.current?.focus(), 0);
      },
    }} onClose={() => setConfirmCad(false)} />}
    {qualityOpen && <ScreenQuality settings={settings} onApply={applySettings} onClose={() => { setQualityOpen(false); afterModal(); }} />}
    {guideOpen && <Modal title="操作ガイドと接続情報" onClose={() => { setGuideOpen(false); afterModal(); }} className="screen-guide">
      <div className="screen-guide-body">
        <p>{viewOnly ? '見るだけ：マウス・キー操作は送りません。' : '画面をクリックするとマウス・キーボードで操作できます。'}</p>
        <p>スマホ：タップでクリック、1本指でドラッグ、2本指タップで右クリック、2本指ドラッグでスクロール。日本語は「文字入力」から送れます。</p>
        {!modal && <p>Alt+数字などアプリのショートカットはアプリ側で使います。タブを隠して{SCREEN_IDLE_MS / 1000}秒経つと切断し、表示すると繋ぎ直します。</p>}
        <p>{settings.lossless ? '可逆圧縮' : `JPEG 品質${settings.quality}`} · 配信{Math.round(Number(settings.scale) * 100)}%（元画面 {sourceSize || '確認中'}） · 更新{settings.interval}ms · 音声なし</p>
        <p>通信往復：{roundTrip === null ? '未計測／応答なし' : `${roundTrip} ms`}。画面の取り込み・圧縮・描画時間は含みません。</p>
      </div>
    </Modal>}
    {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} title={selectedName} items={screenMenuItems({ screen: context })} onClose={() => setMenuAt(null)} />}
    {notice && <div className="desktop-notification">
      <p className="desktop-notice" role="status">{notice}</p>
      <button className="desktop-notice-close" aria-label="お知らせを閉じる" title="お知らせを閉じる" onClick={() => setNotice('')}><Icon name="close" /></button>
    </div>}
  </div>;

  return modal
    ? <div className="modal-backdrop desktop-backdrop" onClick={e => e.target === e.currentTarget && onClose?.()}>{view}</div>
    : view;
});
