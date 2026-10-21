import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { HOME, HttpError, isDir, resolveExisting, tilde } from './safety.js';
import { discover } from './discover.js';
import { claudeAvailable, enableRemoteControl, exitSession, killSession, paneTail, startSession, } from './sessions.js';
import { createProject, toDirName } from './projects.js';
import { guess, listDir, looksLikeText, saveUpload, tarStream } from './files.js';
import * as askpass from './askpass.js';
import { spawnNotes } from './state.js';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
export const projectsApp = new Hono();
const app = projectsApp;
// ── 静的ファイル ─────────────────────────────────────────────────────────────
const STATIC = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/app.js': 'app.js',
    '/icons.js': 'icons.js',
    '/style.css': 'style.css',
    '/manifest.webmanifest': 'manifest.webmanifest',
    '/icon.svg': 'icon.svg',
};
const STATIC_TYPE = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
};
for (const [route, file] of Object.entries(STATIC)) {
    app.get(route, async (c) => {
        let body = await readFile(path.join(PUBLIC_DIR, file), 'utf8');
        if (file === 'index.html') body = body.replace('__TERMINAL_URL__', c.env.token ? '/?token=' + encodeURIComponent(c.env.token) : '/');
        c.header('content-type', STATIC_TYPE[path.extname(file)] ?? 'text/plain; charset=utf-8');
        c.header('cache-control', 'no-cache');
        return c.body(body);
    });
}
function conn(c) {
    const host = c.req.header('host') ?? '';
    return {
        loopback: ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(c.env?.incoming?.socket?.remoteAddress) && !c.req.header('x-forwarded-for') && !c.req.header('tailscale-user-login') && /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/.test(host),
        https: (c.req.header('x-forwarded-proto') ?? '').toLowerCase() === 'https',
        tailnetUser: c.req.header('tailscale-user-login') ?? null,
    };
}
/** パスワードを扱ってよい経路か。ループバックは外に出ないので可、それ以外は TLS 必須。 */
const secureEnough = (k) => k.loopback || k.https;
// ── ヘルパ ──────────────────────────────────────────────────────────────────
const fail = (e) => {
    const status = e instanceof HttpError ? e.status : (e?.status ?? 500);
    const message = e instanceof Error ? e.message : String(e);
    return { status: status, message };
};
function notesFor(paneId) {
    const n = spawnNotes.get(paneId);
    if (!n)
        return null;
    if (Date.now() - n.at > 5 * 60_000)
        return null;
    return n.text;
}
async function requireDir(p) {
    const abs = await resolveExisting(p);
    if (!(await isDir(abs)))
        throw new HttpError(400, 'ディレクトリではありません');
    return abs;
}
// ── セッション ───────────────────────────────────────────────────────────────
app.get('/api/sessions', async (c) => {
    try {
        const { live, stopped } = await discover(c.req.query('fresh') === '1');
        return c.json({
            now: Date.now(),
            live: live.map((s) => ({ ...s, note: notesFor(s.paneId ?? '') })),
            stopped,
        });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.post('/api/sessions', async (c) => {
    try {
        const body = await c.req.json();
        const dir = await requireDir(body.dir);
        const started = await startSession({
            dir,
            title: (body.title || path.basename(dir)).trim(),
            initialPrompt: body.initialPrompt,
            resumeId: body.resumeId,
        });
        return c.json({ ok: true, ...started, display: tilde(started.dir) });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.post('/api/session/rc', async (c) => {
    try {
        const { id } = await c.req.json();
        await enableRemoteControl(id);
        return c.json({ ok: true });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.post('/api/session/exit', async (c) => {
    try {
        const { id } = await c.req.json();
        await exitSession(id);
        return c.json({ ok: true });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.post('/api/session/kill', async (c) => {
    try {
        const { id } = await c.req.json();
        await killSession(id);
        return c.json({ ok: true });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.get('/api/session/pane', async (c) => {
    try {
        const id = c.req.query('id') ?? '';
        const text = await paneTail(id, Number(c.req.query('lines') ?? 60));
        return c.json({ ok: true, text });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
// ── プロジェクト ─────────────────────────────────────────────────────────────
app.post('/api/projects', async (c) => {
    try {
        const body = await c.req.json();
        const result = await createProject(body);
        return c.json({ ok: true, ...result, display: tilde(result.created) });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.get('/api/preview-name', (c) => {
    const name = toDirName(c.req.query('name') ?? '');
    return c.json({ dirName: name, path: name ? tilde(path.join(HOME, name)) : '' });
});
// ── ファイル ────────────────────────────────────────────────────────────────
app.get('/api/files', async (c) => {
    try {
        const abs = await requireDir(c.req.query('path') || HOME);
        const listing = await listDir(abs, c.req.query('hidden') === '1');
        return c.json({
            ...listing,
            parentDisplay: listing.parent ? tilde(listing.parent) : null,
            home: HOME,
        });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.get('/api/file', async (c) => {
    try {
        const abs = await resolveExisting(c.req.query('path') ?? '');
        const st = await stat(abs);
        if (st.isDirectory())
            throw new HttpError(400, 'ファイルではありません');
        const name = path.basename(abs);
        let { mime, kind } = guess(name);
        if (kind === 'binary' && st.size < 8 * 1024 * 1024 && (await looksLikeText(abs))) {
            mime = 'text/plain; charset=utf-8';
        }
        const download = c.req.query('download') === '1';
        const disposition = download ? 'attachment' : 'inline';
        c.header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        c.header('content-type', mime);
        c.header('content-length', String(st.size));
        c.header('content-disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`);
        return c.body(Readable.toWeb(createReadStream(abs)));
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.get('/api/zip', async (c) => {
    try {
        const abs = await requireDir(c.req.query('path') ?? '');
        const { stream, filename } = tarStream(abs);
        c.header('content-type', 'application/gzip');
        c.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return c.body(Readable.toWeb(stream));
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.post('/api/upload', async (c) => {
    try {
        const abs = await requireDir(c.req.query('path') ?? '');
        const body = await c.req.parseBody({ all: true });
        const files = [];
        for (const value of Object.values(body)) {
            for (const v of Array.isArray(value) ? value : [value]) {
                if (v instanceof File)
                    files.push(v);
            }
        }
        if (files.length === 0)
            throw new HttpError(400, 'ファイルがありません');
        const saved = [];
        for (const f of files) {
            saved.push(path.basename(await saveUpload(abs, f.name, await f.arrayBuffer())));
        }
        return c.json({ ok: true, saved });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
// ── sudo のパスワードをスマホから受け取る ────────────────────────────────────
// 要求を作れるのはこの PC の中のプロセスだけ。スマホ側からは作れない。
app.post('/api/askpass/request', async (c) => {
    if (c.req.header('origin') || c.req.header('sec-fetch-site') || !conn(c).loopback)
        return c.json({ error: 'この PC の中からのみ受け付けます' }, 403);
    try {
        const b = await c.req.json();
        const created = askpass.create({
            cmd: b.cmd ?? '(不明)',
            cwd: b.cwd ?? HOME,
            detail: b.detail ?? '',
            attempt: Number(b.attempt) || 1,
        });
        c.header('cache-control', 'no-store');
        return c.json({ id: created.id, claim: created.claim, expiresAt: created.expiresAt });
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
// askpass ヘルパーが答えを待つ。入力されるまで応答を保留する（ロングポーリング）。
app.get('/api/askpass/wait', async (c) => {
    if (c.req.header('origin') || c.req.header('sec-fetch-site') || !conn(c).loopback)
        return c.text('', 403);
    const waiting = askpass.claimResult(c.req.query('id') ?? '', c.req.query('claim') ?? '');
    if (!waiting)
        return c.text('', 404);
    const secret = await waiting;
    if (!secret)
        return c.text('', 410); // 取り消し or 期限切れ
    // 送信用に複製してから元を 0 で埋める。複製のほうは送信後に参照が切れる
    // （JS では文字列やバッファを確実に消す手段が無いので、寿命を最短にするのが精一杯）
    const out = Buffer.from(secret);
    secret.fill(0);
    c.header('cache-control', 'no-store');
    c.header('content-type', 'application/octet-stream');
    return c.body(out);
});
// スマホ側。いま何を承認しようとしているかだけを返す（合言葉は含めない）
app.get('/api/askpass/pending', (c) => {
    const k = conn(c);
    c.header('cache-control', 'no-store');
    return c.json({ pending: askpass.view(), secure: secureEnough(k), https: k.https });
});
app.post('/api/askpass/answer', async (c) => {
    const k = conn(c);
    if (!secureEnough(k)) {
        return c.json({ error: 'TLS で繋いでいないため、パスワードは受け付けません。https:// の URL で開いてください' }, 403);
    }
    // 他サイトからの投げ込みを弾く（ブラウザは同一オリジンなら same-origin を付ける）
    const site = c.req.header('sec-fetch-site');
    if (site && site !== 'same-origin')
        return c.json({ error: '別サイトからは受け付けません' }, 403);
    try {
        const b = await c.req.json();
        if (!b.id || typeof b.password !== 'string')
            return c.json({ error: '不正な要求です' }, 400);
        const ok = askpass.answer(b.id, b.password);
        c.header('cache-control', 'no-store');
        return c.json({ ok }, ok ? 200 : 409);
    }
    catch (e) {
        const { status, message } = fail(e);
        return c.json({ error: message }, status);
    }
});
app.post('/api/askpass/cancel', async (c) => {
    const id = (await c.req.json().catch(() => ({}))).id;
    return c.json({ ok: askpass.cancel(id) });
});
// ── 稼働確認 ─────────────────────────────────────────────────────────────────
app.get('/api/health', async (c) => {
    const k = conn(c);
    return c.json({
        ok: true,
        claude: await claudeAvailable(),
        home: HOME,
        pid: process.pid,
        conn: { ...k, secure: secureEnough(k) },
    });
});
