/**
 * 1 台のデバイスの画面を、このページの中で同時に繋ぐのは 1 か所だけにする。
 *
 * サーバは接続ごとに x11vnc を 1 つ起動し、それぞれが画面全体を取り込み・圧縮して送る。
 * 同じ画面をモーダルとタブ、あるいは別の仮想デスクトップのタブで同時に開くと、
 * 負荷も通信量も倍になり、マウスも取り合いになる。そこで「いま見せたい」と言ったものが
 * 接続を持ち、それまでの持ち主は手放す（「別の場所で表示中」になる）。
 *
 * 持ち主が手放したら、まだ表示されていて接続を待っているものに自動で渡す
 * （モーダルを閉じたら、裏で表示されていたタブが繋ぎ直す）。
 */
export interface ScreenLeaseEntry {
  /** いま表示されていて、接続を持ちたいか */
  wants(): boolean;
  /** 持ち主が変わった。描き直して接続をやり直す */
  changed(): void;
}

const owners = new Map<string, ScreenLeaseEntry>();
const members = new Map<string, Set<ScreenLeaseEntry>>();

function notify(deviceId: string) {
  for (const entry of members.get(deviceId) ?? []) entry.changed();
}

export function ownsScreen(deviceId: string, entry: ScreenLeaseEntry): boolean {
  return owners.get(deviceId) === entry;
}

/** いまこのデバイスの接続を持っているもの（だれも持っていなければ undefined） */
export function screenOwner(deviceId: string): ScreenLeaseEntry | undefined {
  return owners.get(deviceId);
}

/** 接続を持つ。それまでの持ち主は手放す */
export function claimScreen(deviceId: string, entry: ScreenLeaseEntry): void {
  if (owners.get(deviceId) === entry) return;
  owners.set(deviceId, entry);
  notify(deviceId);
}

/** 手放す。表示されていて待っているものがあれば、そちらに渡す */
export function releaseScreen(deviceId: string, entry: ScreenLeaseEntry): void {
  if (owners.get(deviceId) !== entry) return;
  owners.delete(deviceId);
  const next = [...(members.get(deviceId) ?? [])].reverse().find((other) => other !== entry && other.wants());
  if (next) owners.set(deviceId, next);
  notify(deviceId);
}

/** 画面の表示部品が作られたときに登録する。戻り値を呼ぶと抜ける（持っていれば手放す） */
export function joinScreen(deviceId: string, entry: ScreenLeaseEntry): () => void {
  let set = members.get(deviceId);
  if (!set) members.set(deviceId, (set = new Set()));
  set.add(entry);
  return () => {
    releaseScreen(deviceId, entry);
    set!.delete(entry);
    if (set!.size === 0) members.delete(deviceId);
  };
}
