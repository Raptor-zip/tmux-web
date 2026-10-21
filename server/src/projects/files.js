import { open, readdir, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { HttpError, tilde, resolveExisting, DENY } from './safety.js';
const MIME = {
    '.txt': ['text/plain; charset=utf-8', 'text'],
    '.md': ['text/plain; charset=utf-8', 'text'],
    '.markdown': ['text/plain; charset=utf-8', 'text'],
    '.json': ['text/plain; charset=utf-8', 'text'],
    '.jsonl': ['text/plain; charset=utf-8', 'text'],
    '.yaml': ['text/plain; charset=utf-8', 'text'],
    '.yml': ['text/plain; charset=utf-8', 'text'],
    '.toml': ['text/plain; charset=utf-8', 'text'],
    '.ini': ['text/plain; charset=utf-8', 'text'],
    '.csv': ['text/plain; charset=utf-8', 'text'],
    '.log': ['text/plain; charset=utf-8', 'text'],
    '.js': ['text/plain; charset=utf-8', 'text'],
    '.mjs': ['text/plain; charset=utf-8', 'text'],
    '.ts': ['text/plain; charset=utf-8', 'text'],
    '.tsx': ['text/plain; charset=utf-8', 'text'],
    '.jsx': ['text/plain; charset=utf-8', 'text'],
    '.py': ['text/plain; charset=utf-8', 'text'],
    '.rs': ['text/plain; charset=utf-8', 'text'],
    '.go': ['text/plain; charset=utf-8', 'text'],
    '.c': ['text/plain; charset=utf-8', 'text'],
    '.h': ['text/plain; charset=utf-8', 'text'],
    '.cpp': ['text/plain; charset=utf-8', 'text'],
    '.hpp': ['text/plain; charset=utf-8', 'text'],
    '.sh': ['text/plain; charset=utf-8', 'text'],
    '.html': ['text/plain; charset=utf-8', 'text'],
    '.css': ['text/plain; charset=utf-8', 'text'],
    '.xml': ['text/plain; charset=utf-8', 'text'],
    '.svg': ['image/svg+xml', 'image'],
    '.png': ['image/png', 'image'],
    '.jpg': ['image/jpeg', 'image'],
    '.jpeg': ['image/jpeg', 'image'],
    '.gif': ['image/gif', 'image'],
    '.webp': ['image/webp', 'image'],
    '.heic': ['image/heic', 'image'],
    '.bmp': ['image/bmp', 'image'],
    '.pdf': ['application/pdf', 'pdf'],
    '.mp4': ['video/mp4', 'video'],
    '.webm': ['video/webm', 'video'],
    '.mov': ['video/quicktime', 'video'],
    '.mp3': ['audio/mpeg', 'audio'],
    '.wav': ['audio/wav', 'audio'],
    '.m4a': ['audio/mp4', 'audio'],
    '.zip': ['application/zip', 'archive'],
    '.gz': ['application/gzip', 'archive'],
    '.tgz': ['application/gzip', 'archive'],
    '.stl': ['model/stl', 'binary'],
    '.step': ['model/step', 'binary'],
    '.stp': ['model/step', 'binary'],
};
const TEXT_BASENAMES = new Set([
    'CLAUDE.md', 'README', 'LICENSE', 'Makefile', 'Dockerfile', '.gitignore', '.env.example',
]);
export function guess(name) {
    const ext = path.extname(name).toLowerCase();
    const hit = MIME[ext];
    if (hit)
        return { mime: hit[0], kind: hit[1] };
    if (TEXT_BASENAMES.has(name) || (!ext && name.startsWith('.'))) {
        return { mime: 'text/plain; charset=utf-8', kind: 'text' };
    }
    return { mime: 'application/octet-stream', kind: 'binary' };
}
/** 先頭 4KB に NUL が無ければテキストとみなす。 */
export async function looksLikeText(file) {
    let fh;
    try {
        fh = await open(file, 'r');
        const buf = Buffer.alloc(4096);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        return !buf.subarray(0, bytesRead).includes(0);
    }
    catch {
        return false;
    }
    finally {
        await fh?.close();
    }
}
export async function listDir(abs, showHidden) {
    const st = await stat(abs);
    if (!st.isDirectory())
        throw new HttpError(400, 'ディレクトリではありません');
    const names = await readdir(abs);
    const entries = [];
    for (const name of names) {
        if (!showHidden && name.startsWith('.'))
            continue;
        try {
            const s = await stat(await resolveExisting(path.join(abs, name)));
            entries.push({
                name,
                dir: s.isDirectory(),
                size: s.size,
                mtime: s.mtimeMs,
                kind: s.isDirectory() ? 'dir' : guess(name).kind,
            });
        }
        catch {
            /* 権限なし・壊れたリンクは飛ばす */
        }
    }
    // ディレクトリを先に、その中で更新の新しい順（＝出来たばかりの生成物が上に来る）
    entries.sort((a, b) => (a.dir === b.dir ? b.mtime - a.mtime : a.dir ? -1 : 1));
    const parent = path.dirname(abs);
    return {
        path: abs,
        display: tilde(abs),
        parent: parent === abs ? null : parent,
        entries,
    };
}
export async function saveUpload(dir, name, data) {
    const safe = path.basename(name).replace(/^\.+/, '') || `upload-${Date.now()}`;
    let i = 1;
    while (true) {
        const ext = path.extname(safe);
        const target = path.join(dir, i === 1 ? safe : `${path.basename(safe, ext)}-${i}${ext}`);
        try {
            await writeFile(target, Buffer.from(data), { flag: 'wx' });
            return target;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            i++;
        }
    }
}
/** ディレクトリを tar.gz にして流す。外部依存を増やさないため tar コマンドに任せる。 */
export function tarStream(abs) {
    const parent = path.dirname(abs);
    const base = path.basename(abs);
    const child = spawn('tar', ['-czf', '-', ...DENY.map(name => `--exclude=${name}`), '--exclude=.env', '--exclude=.env.*', '--exclude=.git', '-C', parent, '--', base], { stdio: ['ignore', 'pipe', 'ignore'] });
    return { stream: child.stdout, filename: `${base}.tar.gz` };
}
