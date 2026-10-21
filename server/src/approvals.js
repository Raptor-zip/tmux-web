import { randomBytes, timingSafeEqual } from 'node:crypto';

function localTransport(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host || '')
    && !req.headers['x-forwarded-for'] && !req.headers['tailscale-user-login'];
}
const secureTransport = req => localTransport(req) || Boolean(req.socket.encrypted)
  || (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https');

export function createApprovals({ ttl = 150000 } = {}) {
  let request = null;
  function dispose() {
    if (!request) return;
    const p = request; request = null;
    clearTimeout(p.timer); p.secret?.fill(0); p.claim.fill(0); p.resolve(null);
  }
  function create(body) {
    dispose();
    const id = randomBytes(16).toString('base64url');
    const claim = randomBytes(32);
    let resolve;
    const result = new Promise(done => { resolve = done; });
    request = { id, claim, resolve, result, claimed: false, answered: false,
      cmd: String(body.cmd || '(コマンド不明)').slice(0, 4000),
      cwd: String(body.cwd || '').slice(0, 1000), detail: String(body.detail || '').slice(0, 8000),
      attempt: Math.max(1, Number(body.attempt) || 1), expiresAt: Date.now() + ttl,
      timer: setTimeout(dispose, ttl).unref() };
    return { id, claim: claim.toString('base64url'), expiresAt: request.expiresAt };
  }
  function view() {
    if (!request || request.answered) return null;
    const { id, cmd, cwd, detail, attempt, expiresAt } = request;
    return { id, cmd, cwd, detail, attempt, expiresAt };
  }
  function claim(id, value) {
    const p = request;
    const candidate = Buffer.from(typeof value === 'string' ? value : '', 'base64url');
    if (!p || p.claimed || p.id !== id || candidate.length !== p.claim.length || !timingSafeEqual(candidate, p.claim)) return null;
    p.claimed = true;
    return p.result;
  }
  function answer(id, password) {
    if (!request || request.answered || request.id !== id || typeof password !== 'string' || !password || password.length > 4096) return false;
    request.answered = true;
    request.secret = Buffer.from(password);
    request.resolve(request.secret);
    return true;
  }
  function cancel(id) { if (!request || request.id !== id) return false; dispose(); return true; }
  return {
    view, create, claim, answer, cancel, dispose,
    installHelpers(app) {
      const onlyLocal = (req, res, next) => localTransport(req) && !req.headers.origin && !req.headers['sec-fetch-site']
        ? next() : res.status(403).json({ error: 'このPCのsudoヘルパー専用です' });
      app.post('/api/approvals/request', onlyLocal, (req, res) => res.set('Cache-Control', 'no-store').json(create(req.body || {})));
      app.get('/api/approvals/wait', onlyLocal, async (req, res) => {
        const result = claim(req.query.id, req.query.claim);
        if (!result) return res.status(404).end();
        const secret = await result;
        if (!secret) return res.status(410).end();
        res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream' });
        res.end(secret, () => { secret.fill(0); cancel(req.query.id); });
      });
    },
    install(app) {
      app.get('/api/approvals', (req, res) => res.set('Cache-Control', 'no-store').json({ pending: view(), secure: secureTransport(req) }));
      app.post('/api/approvals/answer', (req, res) => {
        if (!secureTransport(req)) return res.status(403).json({ error: 'HTTPSで接続してから承認してください' });
        if ((req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
          || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`)) return res.status(403).json({ error: '別サイトからの承認はできません' });
        const ok = answer(req.body?.id, req.body?.password);
        res.set('Cache-Control', 'no-store').status(ok ? 200 : 409).json(ok ? { ok } : { error: '要求が終了したか、入力が空です。端末を確認してください' });
      });
      app.post('/api/approvals/cancel', (req, res) => res.json({ ok: cancel(req.body?.id) }));
    },
  };
}
