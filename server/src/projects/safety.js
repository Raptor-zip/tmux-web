import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
export const HOME = homedir();
/**
 * ファイル API から一切触らせないパス（$HOME からの相対パス）。
 * 前方一致で判定するので、配下も丸ごと拒否される。
 */
export const DENY = [
    '.ssh',
    '.codex',
    '.env',
    '.git',
    '.gnupg',
    '.aws',
    '.kube',
    '.docker',
    '.netrc',
    '.npmrc',
    '.git-credentials',
    '.config',
    '.mozilla',
    '.pki',
    '.password-store',
    '.claude',
    '.claude.json',
    '.local/share/keyrings',
    '.local/share/gnome-keyring',
    '.vscode/extensions',
];
export class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
/** `~` 展開と絶対パス化。存在しないパスでも使える。 */
export function expand(p) {
    const raw = (p ?? '').trim();
    if (!raw || raw === '~')
        return HOME;
    const withHome = raw.startsWith('~/') ? path.join(HOME, raw.slice(2)) : raw;
    return path.resolve(HOME, withHome);
}
/** $HOME 配下か、かつ拒否リストに触れていないかを判定する。 */
function assertAllowed(abs) {
    const rel = path.relative(HOME, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new HttpError(403, 'ホームディレクトリの外は開けません');
    }
    if (rel === '')
        return;
    const segs = rel.split(path.sep);
    if (segs.some(seg => seg === '.env' || seg.startsWith('.env.') || ['.ssh', '.gnupg', '.aws', '.git', '.netrc', '.git-credentials'].includes(seg))) {
        throw new HttpError(403, '認証情報を含むパスは保護されています');
    }
    for (const deny of DENY) {
        const dsegs = deny.split('/');
        if (dsegs.every((s, i) => segs[i] === s)) {
            throw new HttpError(403, `${deny} は保護されています`);
        }
    }
}
/**
 * 実在するパスを realpath まで解決したうえで検証する。
 * シンボリックリンク経由でホーム外へ抜けるのを防ぐため、解決前後の両方を見る。
 */
export async function resolveExisting(p) {
    const abs = expand(p);
    assertAllowed(abs);
    let real;
    try {
        real = await realpath(abs);
    }
    catch {
        throw new HttpError(404, 'パスが見つかりません');
    }
    assertAllowed(real);
    return real;
}
/** 新規作成用。親ディレクトリが実在すればよい。 */
export async function resolveForCreate(p) {
    const abs = expand(p);
    assertAllowed(abs);
    const parent = await resolveExisting(path.dirname(abs));
    const target = path.join(parent, path.basename(abs));
    assertAllowed(target);
    return target;
}
/** 表示用に $HOME を `~` に畳む。 */
export function tilde(abs) {
    return abs === HOME ? '~' : abs.startsWith(HOME + path.sep) ? '~' + abs.slice(HOME.length) : abs;
}
/** ディレクトリかどうか（存在しなければ false）。 */
export async function isDir(abs) {
    try {
        return (await stat(abs)).isDirectory();
    }
    catch {
        return false;
    }
}
