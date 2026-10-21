import { createTailscaleAuth } from '../../src/auth.js';
export const headers = { host: 'pc.test.ts.net:8443', 'tailscale-user-login': 'owner@example.com', 'x-forwarded-proto': 'https' };
export const auth = () => createTailscaleAuth({ identity: { hostname: 'pc.test.ts.net', owner: 'owner@example.com' } });

// Node fetch drops a supplied Host header. Native HTTP lets these fixtures model
// the Host preserved by Serve without weakening the production hostname checks.
import http from 'node:http';
import { Readable } from 'node:stream';
export function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method || 'GET', headers: options.headers, signal: options.signal }, incoming => {
      const body = options.method === 'HEAD' || [204, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming);
      resolve(new Response(body, { status: incoming.statusCode, headers: incoming.headers }));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}
