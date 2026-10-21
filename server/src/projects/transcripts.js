import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { HOME } from './safety.js';
export const PROJECTS_ROOT = path.join(HOME, '.claude', 'projects');
/** Claude Code が会話履歴の置き場に使うディレクトリ名。英数字以外はすべて `-` になる。 */
export function encodeCwd(cwd) {
    return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
/** そのプロジェクトで最後に更新された履歴ファイル（= 直近のセッション）。 */
export async function latestTranscript(cwd) {
    const dir = path.join(PROJECTS_ROOT, encodeCwd(cwd));
    let names;
    try {
        names = await readdir(dir);
    }
    catch {
        return null;
    }
    let best = null;
    for (const name of names) {
        if (!name.endsWith('.jsonl'))
            continue;
        const file = path.join(dir, name);
        try {
            const s = await stat(file);
            if (!best || s.mtimeMs > best.mtimeMs) {
                best = { sessionId: name.slice(0, -'.jsonl'.length), file, mtimeMs: s.mtimeMs };
            }
        }
        catch {
            /* 消えた直後などは無視 */
        }
    }
    return best;
}
/**
 * 履歴の冒頭を読んで作業ディレクトリを取り出す。
 * ディレクトリ名のエンコードは不可逆（英数字以外がすべて `-`）なので実パスは復元できない。
 * 1 行目は `mode` レコードで `cwd` を持たないため、見つかるまで数行たどる。
 */
function readHead(file, limit = 96 * 1024) {
    return new Promise((resolve) => {
        const chunks = [];
        const rs = createReadStream(file, { encoding: 'utf8', start: 0, end: limit });
        rs.on('data', (c) => chunks.push(typeof c === 'string' ? c : c.toString('utf8')));
        rs.on('error', () => resolve(chunks.join('')));
        rs.on('end', () => resolve(chunks.join('')));
    });
}
async function cwdFromTranscript(file) {
    const head = await readHead(file);
    for (const line of head.split('\n').slice(0, 40)) {
        if (!line.includes('"cwd"'))
            continue;
        try {
            const cwd = JSON.parse(line)?.cwd;
            if (typeof cwd === 'string' && cwd)
                return cwd;
        }
        catch {
            /* 途中で切れた行は捨てる */
        }
    }
    return '';
}
/** ディレクトリ名 → cwd。一度分かれば変わらないので覚えておく（毎回 78 個読むのを避ける）。 */
const cwdCache = new Map();
/**
 * `~/.claude/projects` に記録されている全プロジェクトを、最終更新の新しい順に返す。
 * ディレクトリ名は不可逆なエンコードなので、履歴 1 行目の `cwd` から実パスを取る。
 */
export async function listKnownProjects(limit = 60) {
    let dirs;
    try {
        dirs = await readdir(PROJECTS_ROOT);
    }
    catch {
        return [];
    }
    const withTime = [];
    for (const dir of dirs) {
        try {
            const s = await stat(path.join(PROJECTS_ROOT, dir));
            if (s.isDirectory())
                withTime.push({ dir, mtimeMs: s.mtimeMs });
        }
        catch {
            /* ignore */
        }
    }
    withTime.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const out = [];
    for (const { dir, mtimeMs } of withTime.slice(0, limit)) {
        let names;
        try {
            names = (await readdir(path.join(PROJECTS_ROOT, dir))).filter((n) => n.endsWith('.jsonl'));
        }
        catch {
            continue;
        }
        if (names.length === 0)
            continue;
        // 最新の履歴ファイルを 1 つ選び、その 1 行目から cwd を得る
        let newest = { name: names[0], mtimeMs: 0 };
        for (const name of names) {
            try {
                const s = await stat(path.join(PROJECTS_ROOT, dir, name));
                if (s.mtimeMs > newest.mtimeMs)
                    newest = { name, mtimeMs: s.mtimeMs };
            }
            catch {
                /* ignore */
            }
        }
        let cwd = cwdCache.get(dir) ?? '';
        if (!cwd) {
            cwd = await cwdFromTranscript(path.join(PROJECTS_ROOT, dir, newest.name));
            if (cwd)
                cwdCache.set(dir, cwd);
        }
        if (!cwd)
            continue;
        out.push({ cwd, mtimeMs: Math.max(mtimeMs, newest.mtimeMs), sessionId: newest.name.slice(0, -6) });
    }
    return out;
}
