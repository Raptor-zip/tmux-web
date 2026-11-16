import { useCallback, useEffect, useState } from 'react';

/**
 * 全ワークスペース（App が複数並ぶ）で同じ値を見る設定。
 * usePersisted は各 App が自分の値を持つので、あるワークスペースで切り替えても、
 * 別のワークスペースへ移ると古い値のままになる。キーの横取りや『表示と接続』の項目のように、
 * どこで切り替えてもすぐ効いてほしい設定はこちらを使い、変わったことを他の App とほかのタブへ知らせる。
 */
const SETTING_EVENT = 'tw-setting';
/** この画面での最新値。localStorage に書けない環境（プライベートモードなど）でも App 同士で揃える */
const settingMemory = new Map<string, unknown>();

/**
 * revive は保存値（JSON を解いたもの。無ければ null）から値を作る。
 * 壊れた値や古い形式を、ここで既定値や新しい形に直す。
 */
export function useSharedValue<T>(key: string, revive: (raw: unknown) => T) {
  const read = useCallback((): T => {
    if (settingMemory.has(key)) return settingMemory.get(key) as T;
    try {
      const raw = localStorage.getItem(key);
      return revive(raw === null ? null : JSON.parse(raw));
    } catch {
      return revive(null);
    }
    // revive は呼び出し側で毎回作られることがあるので、キーだけで固定する
  }, [key]);
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = (e: Event) => {
      if (e instanceof StorageEvent) {
        if (e.key !== key) return;
        settingMemory.delete(key); // ほかのタブで変わった。保存された値を読み直す
      } else if ((e as CustomEvent<string>).detail !== key) return;
      setValue(read());
    };
    window.addEventListener('storage', sync);
    window.addEventListener(SETTING_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(SETTING_EVENT, sync);
    };
  }, [key, read]);
  const update = useCallback((next: T | ((v: T) => T)) => {
    const v = typeof next === 'function' ? (next as (v: T) => T)(read()) : next;
    settingMemory.set(key, v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* 保存できなくても、この画面の中では切り替える */
    }
    setValue(v);
    window.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: key }));
  }, [key, read]);
  return [value, update] as const;
}

const booleans = new Map<boolean, (raw: unknown) => boolean>([
  [true, raw => (raw === null ? true : raw === true)],
  [false, raw => raw === true],
]);
export function useSharedSetting(key: string, initial: boolean) {
  return useSharedValue<boolean>(key, booleans.get(initial)!);
}

/** 数値の設定。範囲外や壊れた値は既定値にする */
export const numberSetting = (initial: number, min: number, max: number) => (raw: unknown) =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? raw : initial;

/** 入力行（キー列＋入力）の出し方 */
export type InputBarMode = 'auto' | 'always' | 'hidden';
export const INPUT_BAR_KEY = 'tw.inputBar';
/**
 * 入力行の設定を読む。まだ無ければ、旧設定のキーバー（tw.keyBar.v2）を引き継ぐ：
 * オンにしていた人は『常に表示』、それ以外は『自動』。
 */
export function reviveInputBar(raw: unknown, legacy: () => string | null = () => {
  try { return localStorage.getItem('tw.keyBar.v2'); } catch { return null; }
}): InputBarMode {
  if (raw === 'auto' || raw === 'always' || raw === 'hidden') return raw;
  return legacy() === 'true' ? 'always' : 'auto';
}

/*
 * 『表示と接続』の設定。どの App から読んでも同じ値になるよう、キーと読み方をここで 1 つに決める。
 * 保存先のキーは前と同じ（usePersisted で持っていた値をそのまま引き継ぐ）。
 */
export const FONT_SIZE = { key: 'tw.fontSize', initial: 13, min: 6, max: 28 } as const;
export const LINE_HEIGHT = { key: 'tw.lineHeight', initial: 1.15, min: 1, max: 2 } as const;
const reviveFontSize = numberSetting(FONT_SIZE.initial, FONT_SIZE.min, FONT_SIZE.max);
// 2 より広い古い値も、そのまま使えるようにしておく（スライダーの上限だけを 2 にする）
const reviveLineHeight = numberSetting(LINE_HEIGHT.initial, LINE_HEIGHT.min, 4);
const reviveMode = (raw: unknown): 'mirror' | 'direct' => (raw === 'direct' ? 'direct' : 'mirror');
const reviveStoredInputBar = (raw: unknown) => reviveInputBar(raw);

export const useFontSize = () => useSharedValue(FONT_SIZE.key, reviveFontSize);
export const useLineHeight = () => useSharedValue(LINE_HEIGHT.key, reviveLineHeight);
/** 接続方式（ミラー / 直接） */
export const useConnectionMode = () => useSharedValue('tw.mode', reviveMode);
/** tmux のステータス行 */
export const useStatusLine = () => useSharedSetting('tw.statusBar', false);
export const useInputBar = () => useSharedValue(INPUT_BAR_KEY, reviveStoredInputBar);
/** スマホ（幅 760px 以下）でもタブ列を出す */
export const usePhoneTabs = () => useSharedSetting('tw.phoneTabs', false);
/** 横持ち（高さ 480px 以下）で見出しを隠す */
export const useLandscapeHideHeader = () => useSharedSetting('tw.landscapeHideHeader', false);
export const useAltKeys = () => useSharedSetting('tw.altKeys', true);

/** 入力行の出し方を 自動 → 常に表示 → 隠す → 自動 の順に切り替える（パレットの『操作』から） */
export const nextInputBar = (mode: InputBarMode): InputBarMode =>
  mode === 'auto' ? 'always' : mode === 'always' ? 'hidden' : 'auto';
export const INPUT_BAR_LABEL: Record<InputBarMode, string> = { auto: '自動', always: '常に表示', hidden: '隠す' };
