import { timingSafeEqual } from 'node:crypto';
import { getRequestListener } from '@hono/node-server';
import { projectsApp } from './server.js';

const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Mounted before express.json: Hono must read the original JSON/multipart stream. */
export function installProjects(app, token = process.env.TMUX_WEB_TOKEN || null) {
  const listener = getRequestListener((request, env) => projectsApp.fetch(request, { ...env, token }), { overrideGlobalObjects: false });
  app.use('/projects', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
      && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host || '')
      && !req.headers['x-forwarded-for'] && !req.headers['tailscale-user-login'];
    // Only the local askpass helper can register and claim requests without the UI token.
    const helper = local && !req.headers.origin && !req.headers['sec-fetch-site'] && ((req.method === 'POST' && url.pathname === '/api/askpass/request')
      || (req.method === 'GET' && url.pathname === '/api/askpass/wait'));
    let cookie = '';
    try { cookie = decodeURIComponent(/(?:^|;\s*)tmux_projects=([^;]*)/.exec(req.headers.cookie || '')?.[1] || ''); } catch { /* invalid cookie */ }
    const queryToken = url.searchParams.get('token');
    if (token && !helper && ![req.headers['x-tmux-web-token'], queryToken, cookie].some(value => equal(value, token))) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!['GET', 'HEAD'].includes(req.method) && !helper) {
      const site = req.headers['sec-fetch-site'];
      const origin = req.headers.origin;
      if ((site && site !== 'same-origin' && site !== 'none') || (origin && new URL(origin).host !== req.headers.host)) {
        return res.status(403).json({ error: '別サイトからは受け付けません' });
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (token && equal(queryToken, token)) {
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader('Set-Cookie', `tmux_projects=${encodeURIComponent(token)}; Path=/projects; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
      url.searchParams.delete('token');
      return res.redirect(303, `/projects${url.pathname === '/' ? '/' : url.pathname}${url.search}`);
    }
    if (req.originalUrl === '/projects') return res.redirect(308, '/projects/');
    void listener(req, res);
  });
}
