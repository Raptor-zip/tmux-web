import { useCallback, useEffect, useState } from 'react';

/**
 * 全ワークスペース（App が複数並ぶ）で同じ値を見る設定。
 * usePersisted は各 App が自分の値を持つので、あるワークスペースで切り替えても、
 * 別のワークスペースへ移ると古い値のままになる。キーの横取りのように、どこで切り替えても
 * すぐ効いてほしい設定はこちらを使い、変わったことを他の App とほかのタブへ知らせる。
 */
const SETTING_EVENT = 'tw-setting';
/** この画面での最新値。localStorage に書けない環境（プライベートモードなど）でも App 同士で揃える */
const settingMemory = new Map<string, boolean>();
export function useSharedSetting(key: string, initial: boolean) {
  const read = useCallback(() => {
    const kept = settingMemory.get(key);
    if (kept !== undefined) return kept;
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw) === true;
    } catch {
      return initial;
    }
  }, [key, initial]);
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
  const update = useCallback((next: (v: boolean) => boolean) => {
    const v = next(read());
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
