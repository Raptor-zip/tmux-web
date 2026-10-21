import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const normalize = value => value.trim().toLowerCase();

export async function tailscaleIdentity() {
  const { stdout } = await exec('tailscale', ['status', '--json'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  const status = JSON.parse(stdout);
  const hostname = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase();
  const owner = status.User?.[status.Self?.UserID]?.LoginName;
  if (status.BackendState !== 'Running' || !hostname) throw new Error('Tailscale is not connected');
  return { hostname, owner };
}

/** Serve のヘッダーを信頼する境界はループバックのみ。同じOSのローカルプロセスは信頼対象。 */
export function createTailscaleAuth({
  users = process.env.TMUX_WEB_ALLOWED_USERS,
  publicUrl = process.env.TMUX_WEB_PUBLIC_URL,
  identity,
  discover = tailscaleIdentity,
} = {}) {
  const configured = new Set((users || '').split(',').map(normalize).filter(Boolean));
  let current = identity;
  let pending;
  async function refresh() {
    if (pending) return pending;
    pending = discover().then(value => { current = value; }).catch(() => {
      // 接続情報を取得できないときに、認証を無効化したり全員を許可したりしない。
    }).finally(() => { pending = null; });
    return pending;
  }
  function publicURL() {
    return publicUrl || (current?.hostname ? `https://${current.hostname}:8443/` : null);
  }
  function authorize(req) {
    if (!loopback(req.socket?.remoteAddress)) return { status: 403, error: 'Tailscale Serve経由で接続してください' };
    const login = req.headers['tailscale-user-login'];
    if (typeof login !== 'string' || !login.trim()) return { status: 401, error: 'Tailscaleによる本人確認が必要です' };
    const allowed = configured.size ? configured : new Set(current?.owner ? [normalize(current.owner)] : []);
    if (!allowed.has(normalize(login))) return { status: 403, error: 'このTailscaleアカウントには操作権限がありません' };
    const host = req.headers.host;
    let url;
    try { url = new URL(`https://${host}`); } catch { return { status: 403, error: 'Invalid host' }; }
    const expectedHost = publicUrl ? new URL(publicUrl).hostname : current?.hostname;
    if (!expectedHost || url.hostname !== expectedHost || url.username || url.password || url.pathname !== '/' || req.headers['x-forwarded-proto'] !== 'https') return { status: 403, error: 'Tailscale ServeのHTTPS URLで接続してください' };
    const origin = req.headers.origin;
    // REST更新・WebSocketとも同じ検証を通す。マシン間通信にはOriginがない。
    if (origin !== undefined && origin !== url.origin) return { status: 403, error: '別サイトからの操作はできません' };
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return { status: 403, error: '別サイトからの操作はできません' };
    return { status: 200, user: { login: normalize(login), name: req.headers['tailscale-user-name'] || login } };
  }
  const middleware = (req, res, next) => {
    const result = authorize(req);
    res.set('Cache-Control', 'no-store');
    if (result.status !== 200) return res.status(result.status).json({ error: result.error, auth: 'tailscale', publicUrl: publicURL() });
    req.auth = result.user;
    next();
  };
  return { authorize, middleware, refresh, publicURL };
}

export function assertLoopbackHost(host) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Tailscale認証ではHOSTを127.0.0.1、::1、localhostのいずれかにしてください');
}
