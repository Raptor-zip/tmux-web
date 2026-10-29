import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const HIDDEN = new Set(['node_modules', '__pycache__']);
const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.txt': 'text/plain', '.md': 'text/plain', '.log': 'text/plain',
  '.json': 'text/plain', '.csv': 'text/plain',
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const hidden = (name) => name.startsWith('.') || HIDDEN.has(name);

// Leave room for temporary prefixes and collision suffixes; never split UTF-8.
function fitName(name, maxBytes, suffix = '') {
  const ext = path.extname(name);
  const extension = Buffer.byteLength(ext) < 64 ? ext : '';
  const base = extension ? name.slice(0, -extension.length) : name;
  const budget = maxBytes - Buffer.byteLength(suffix + extension);
  let stem = '', used = 0;
  for (const character of base) {
    const size = Buffer.byteLength(character);
    if (used + size > budget) break;
    stem += character; used += size;
  }
  return stem + suffix + extension;
}

async function resolveFile(root, relative = '') {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)
      || relative.split(/[\\/]/).some((part) => part === '..' || hidden(part))) {
    throw fail(403, 'このパスは開けません');
  }
  const file = await fsp.realpath(path.resolve(root, relative));
  if (path.relative(root, file).split(path.sep).some((part) => hidden(part))) throw fail(403, '隠しファイルは開けません');
  if (!inside(root, file)) throw fail(403, '作業フォルダの外は開けません');
  return file;
}

function handleError(res, error) {
  if (res.headersSent) { res.destroy(); return; }
  const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404
    : ['EACCES', 'EPERM', 'ELOOP'].includes(error.code) ? 403 : 500);
  res.status(status).json({ error: status === 500 ? 'ファイルを読み込めませんでした' : error.message });
}

/** 一覧と開く操作は既存の /api 認証を使用。メディアにはファイル限定の署名 URL を発行する。 */
export function installFiles(app, getPane, { secret = randomBytes(32), now = Date.now, pasteDir = path.join(os.tmpdir(), 'tmux-web-paste') } = {}) {
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  const issue = (data) => {
    const payload = Buffer.from(JSON.stringify({ ...data, expires: now() + 60 * 60 * 1000 })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };
  const verify = (ticket) => {
    if (typeof ticket !== 'string' || ticket.length > 16000) throw fail(401, 'リンクが無効です');
    const [payload, signature, extra] = ticket.split('.');
    const expected = Buffer.from(sign(payload || ''));
    const supplied = Buffer.from(signature || '');
    if (extra || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw fail(401, 'リンクが無効です');
    }
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); }
    catch { throw fail(401, 'リンクが無効です'); }
    if (!data.root || typeof data.path !== 'string' || !Number.isFinite(data.expires) || data.expires <= now()) {
      throw fail(401, 'リンクの期限が切れました。一覧から開き直してください');
    }
    return data;
  };
  const rootFor = async (paneId) => {
    if (typeof paneId !== 'string') throw fail(400, '端末を選んでください');
    const pane = await getPane(paneId);
    if (!pane) throw fail(404, '端末が見つかりません');
    return fsp.realpath(pane.project?.root || pane.path);
  };

  app.get('/api/files', async (req, res) => {
    try {
      const root = await rootFor(req.query.pane);
      const relative = req.query.path || '';
      const directory = await resolveFile(root, relative);
      const entries = await fsp.readdir(directory, { withFileTypes: true });
      // 1 階層ずつ読む。巨大なリポジトリを毎回再帰走査しない。
      const visible = entries.filter((entry) => !hidden(entry.name));
      const items = [];
      for (let offset = 0; offset < visible.length; offset += 32) {
        const batch = await Promise.all(visible.slice(offset, offset + 32).map(async (entry) => {
          const relativePath = path.posix.join(String(relative), entry.name);
          try {
            const resolved = await resolveFile(root, relativePath);
            const stat = await fsp.stat(resolved);
            if (!stat.isDirectory() && !stat.isFile()) return null;
            const mime = TYPES[path.extname(entry.name).toLowerCase()] || 'application/octet-stream';
            return { name: entry.name, path: relativePath, directory: stat.isDirectory(),
              size: stat.size, modified: stat.mtimeMs, mime };
          } catch { return null; } // 消えたファイル・外向きリンク・読めないものは省く
        }));
        items.push(...batch.filter(Boolean));
      }
      res.set('Cache-Control', 'no-store').json({ root, path: relative, items });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/files/upload', express.raw({ type: 'application/octet-stream', limit: '50mb' }), async (req, res) => {
    try {
      const root = await rootFor(req.query.pane);
      if (req.query.root !== root) throw fail(409, '作業フォルダが変わりました。一覧を開き直してください');
      const directory = await resolveFile(root, req.query.path || '');
      const name = req.query.name;
      if (typeof name !== 'string' || !name || /[/\\\x00-\x1f\x7f]/.test(name) || hidden(name)) throw fail(400, '通常のファイル名を指定してください');
      if (!Buffer.isBuffer(req.body)) throw fail(400, 'ファイルがありません');
      if (!(await fsp.stat(directory)).isDirectory()) throw fail(400, 'アップロード先はフォルダを選んでください');
      let index = 1;
      while (true) {
        const saved = fitName(name, 240, index === 1 ? '' : `-${index}`);
        try {
          await fsp.writeFile(path.join(directory, saved), req.body, { flag: 'wx' });
          res.json({ name: saved }); return;
        } catch (error) { if (error.code !== 'EEXIST') throw error; index++; }
      }
    } catch (error) { handleError(res, error); }
  });
  // ブラウザで貼り付けた画像を一時フォルダに保存し、端末に貼れる絶対パスを返す
  app.post('/api/paste-image', express.raw({ type: 'image/*', limit: '20mb' }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail(400, '画像がありません');
      const mime = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[mime];
      if (!ext) throw fail(415, 'PNG / JPEG / GIF / WebP の画像だけ貼り付けできます');
      const dir = pasteDir;
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `paste-${Date.now()}-${randomBytes(3).toString('hex')}${ext}`);
      await fsp.writeFile(file, req.body, { flag: 'wx', mode: 0o600 });
      res.json({ path: file });
    } catch (error) { handleError(res, error); }
  });

  // スマホなどから添付したファイルを一時フォルダに保存し、端末に貼れる絶対パスを返す
  app.post('/api/paste-file', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw fail(400, 'ファイルがありません');
      const raw = path.basename(String(req.query.name || 'file')).replace(/[\x00-\x1f\x7f/\\]/g, '_').replace(/^\.+/, '');
      const name = fitName(raw || 'file', 200);
      const dir = pasteDir;
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${Date.now()}-${randomBytes(3).toString('hex')}-${name}`);
      await fsp.writeFile(file, req.body, { flag: 'wx', mode: 0o600 });
      res.json({ path: file });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/files/archive', async (req, res) => {
    try {
      const root = await rootFor(req.body?.pane);
      if (req.body?.root !== root) throw fail(409, '作業フォルダが変わりました。一覧を開き直してください');
      const relative = req.body?.path || '';
      const directory = await resolveFile(root, relative);
      if (!(await fsp.stat(directory)).isDirectory()) throw fail(400, 'フォルダを選んでください');
      res.json({ url: `/files/content?ticket=${issue({ root, path: relative, archive: true })}` });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/files/open', async (req, res) => {
    try {
      const root = await rootFor(req.body?.pane);
      if (req.body?.root !== root) throw fail(409, '作業フォルダが変わりました。一覧を開き直してください');
      const relative = req.body?.path;
      if (typeof relative !== 'string') throw fail(400, 'ファイルを選んでください');
      const file = await resolveFile(root, relative);
      if (!(await fsp.stat(file)).isFile()) throw fail(400, 'ファイルを選んでください');
      const ticket = issue({ root, path: relative });
      res.set('Cache-Control', 'no-store').json({ url: `/files/content?ticket=${ticket}` });
    } catch (error) { handleError(res, error); }
  });

  app.get('/files/content', async (req, res) => {
    let handle;
    try {
      const data = verify(req.query.ticket);
      const file = await resolveFile(data.root, data.path);
      if (data.archive) {
        if (!(await fsp.stat(file)).isDirectory()) throw fail(400, 'フォルダを選んでください');
        const child = spawn('tar', ['-czf', '-', '--exclude=*/.*', '--exclude=*/node_modules', '--exclude=*/__pycache__', '-C', path.dirname(file), '--', path.basename(file)], { stdio: ['ignore', 'pipe', 'pipe'] });
        res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}.tar.gz`, 'Cache-Control': 'private, no-store' });
        child.on('error', error => handleError(res, error));
        child.stderr.resume();
        child.stdout.pipe(res, { end: false });
        child.on('close', code => { if (code === 0) res.end(); else if (!res.destroyed) res.destroy(); });
        res.on('close', () => child.kill());
        return;
      }

      handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      // Linux: パス解決から open までにリンクが差し替わっても、実際の FD を確認する。
      if (process.platform === 'linux') {
        const opened = await fsp.realpath(`/proc/self/fd/${handle.fd}`);
        if (path.relative(data.root, opened).split(path.sep).some((part) => hidden(part))) throw fail(403, '隠しファイルは開けません');
        if (!inside(data.root, opened)) throw fail(403, '作業フォルダの外は開けません');
      }
      const stat = await handle.stat();
      if (!stat.isFile()) throw fail(400, '通常のファイルだけ開けます');
      const mime = TYPES[path.extname(data.path).toLowerCase()] || 'application/octet-stream';
      const download = req.query.download === '1' || mime === 'application/octet-stream';
      const filename = encodeURIComponent(path.basename(data.path)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
      res.set({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="download"; filename*=UTF-8''${filename}`,
        'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': mime === 'application/pdf' ? "frame-ancestors 'self'" : "sandbox; default-src 'none'", 'Accept-Ranges': 'bytes' });
      let start = 0;
      let end = stat.size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) {
          res.set('Content-Range', `bytes */${stat.size}`).status(416).end(); return;
        }
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Math.min(Number(match[2]), end);
        } else {
          start = Math.max(0, stat.size - Number(match[2]));
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          res.set('Content-Range', `bytes */${stat.size}`).status(416).end(); return;
        }
        res.status(206).set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      }
      res.set('Content-Length', String(Math.max(0, end - start + 1)));
      if (req.method === 'HEAD' || stat.size === 0) { res.end(); return; }
      const stream = handle.createReadStream({ start, end, autoClose: true });
      handle = null;
      res.on('close', () => stream.destroy());
      stream.on('error', (error) => handleError(res, error));
      stream.pipe(res);
    } catch (error) { handleError(res, error); }
    finally { await handle?.close().catch(() => {}); }
  });
}
