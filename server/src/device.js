import os from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

function hexColor(hue, lightness) {
  const a = .7 * Math.min(lightness, 1 - lightness);
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function deviceIdentity(name = process.env.TMUX_WEB_DEVICE_NAME || os.hostname()) {
  const hash = createHash('sha256').update(name).digest();
  const hue = hash.readUInt16BE(0) % 360;
  return { name, color: hexColor(hue, .30), accent: hexColor(hue, .65), fingerprint: hash.toString('hex').slice(0, 8) };
}

function cells(device) {
  const bits = Number.parseInt(device.fingerprint, 16) >>> 0;
  const rects = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if ((bits >>> (y * 3 + Math.min(x, 4 - x))) & 1) rects.push({ x: 12 + x * 8, y: 12 + y * 8 });
  }
  // 中央の印で、偶然すべてのビットが 0 でもアイコンが空にならない。
  rects.push({ x: 28, y: 28 });
  return rects;
}

export function deviceSvg(device) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${device.color}"/>${cells(device).map(({x,y}) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1" fill="white"/>`).join('')}</svg>`;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
export function devicePng(device, size) {
  const rgb = [1, 3, 5].map(i => parseInt(device.color.slice(i, i + 2), 16));
  const marks = cells(device);
  const stride = size * 3 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = x * 64 / size, sy = y * 64 / size;
    const white = marks.some(r => sx >= r.x && sx < r.x + 7 && sy >= r.y && sy < r.y + 7);
    const at = y * stride + 1 + x * 3;
    for (let c = 0; c < 3; c++) pixels[at + c] = white ? 255 : rgb[c];
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export function installDevice(app) {
  const device = deviceIdentity();
  const images = new Map([180,192,512].map(size => [size, devicePng(device, size)]));
  app.get('/icon.svg', (_req, res) => res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(deviceSvg(device)));
  app.get('/icon-:size.png', (req, res, next) => {
    const icon = images.get(Number(req.params.size));
    if (!icon) return next();
    res.set('Cache-Control', 'no-cache').type('image/png').send(icon);
  });
  app.get('/manifest.webmanifest', (_req, res) => res.set('Cache-Control', 'no-cache').type('application/manifest+json').send(JSON.stringify({
    name: `tmux · ${device.name}`, short_name: device.name, display: 'standalone', orientation: 'any',
    background_color: '#1e1e1e', theme_color: device.color,
    icons: [192,512].map(size => ({src:`/icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png'})),
  })));
}
