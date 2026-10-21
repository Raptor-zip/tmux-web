import { randomBytes, timingSafeEqual } from 'node:crypto';
/*
 * sudo のパスワードを、この PC の画面ではなくスマホから入れるための受け渡し。
 *
 * 取り扱いの原則（変更するときは必ず守ること）:
 *  - パスワードはメモリ上の Buffer としてだけ持ち、使ったら 0 で埋めて捨てる
 *  - ディスクにもログにも一切書かない。console に出す実装を足さない
 *  - 一度渡したら消える（同じ要求を二度使い回せない）
 *  - 要求を作れるのはループバックから来たリクエストだけ。スマホ側からは作れない
 *  - 取り出しには要求ごとの合言葉が要る。同じ PC の別プロセスでも横取りできない
 */
/** 要求を出してから諦めるまで。sudo 側の待ち時間もこれに合わせる。 */
export const TTL_MS = 150_000;
/** 同時にひとつだけ。sudo のリトライも「新しい要求」として上書きされる。 */
let pending = null;
function clearPending(reason) {
    if (!pending)
        return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p.claim.fill(0);
    if (reason !== 'answered')
        p.deliver(null);
}
/** askpass ヘルパー（ローカル）から呼ばれ、スマホ側に出す要求を登録する。 */
export function create(input) {
    clearPending('replaced');
    const id = randomBytes(9).toString('base64url');
    const claim = randomBytes(32);
    const now = Date.now();
    const expiresAt = now + TTL_MS;
    let deliver;
    const wait = new Promise((resolve) => {
        deliver = resolve;
    });
    pending = {
        id,
        claim,
        cmd: input.cmd.slice(0, 4000),
        cwd: input.cwd.slice(0, 1000),
        detail: input.detail.slice(0, 8000),
        attempt: input.attempt,
        createdAt: now,
        expiresAt,
        deliver,
        wait,
        claimed: false,
        timer: setTimeout(() => clearPending('expired'), TTL_MS).unref(),
    };
    return { id, claim: claim.toString('base64url'), expiresAt, wait };
}
/** スマホ側に見せてよい情報だけ。合言葉は絶対に含めない。 */
export function view() {
    if (!pending)
        return null;
    const { id, cmd, cwd, detail, attempt, createdAt, expiresAt } = pending;
    return { id, cmd, cwd, detail, attempt, createdAt, expiresAt };
}
function claimMatches(raw) {
    if (!pending)
        return false;
    let given;
    try {
        given = Buffer.from(raw, 'base64url');
    }
    catch {
        return false;
    }
    // 長さが違うと timingSafeEqual が例外を投げるので先に弾く
    return given.length === pending.claim.length && timingSafeEqual(given, pending.claim);
}
/**
 * askpass ヘルパーが結果を受け取る。合言葉が合わなければ何も返さない。
 * 受け取れた Buffer は呼び出し側が使い終わったら 0 で埋めること。
 */
export function claimResult(id, claim) {
    if (!pending || pending.claimed || pending.id !== id || !claimMatches(claim))
        return null;
    pending.claimed = true;
    return pending.wait;
}
/** スマホ側から答える。文字列は即座に Buffer にして、以後は Buffer だけを扱う。 */
export function answer(id, password) {
    if (!pending || pending.id !== id)
        return false;
    const buf = Buffer.from(password, 'utf8');
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p.claim.fill(0);
    p.deliver(buf);
    return true;
}
export function cancel(id) {
    if (!pending)
        return false;
    if (id && pending.id !== id)
        return false;
    clearPending('cancelled');
    return true;
}
