#!/usr/bin/env bash
# ビルド後、既存の常駐サービスをTailscale認証へ移行する。
# tmuxや実行中のプロセスを終了せずにWebサーバーを再起動する。
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/tmux-web.service"
[ -f "$UNIT_PATH" ] || { echo '先に ./scripts/install-service.sh を実行してください' >&2; exit 1; }
cd "$REPO_DIR"
node --input-type=module - "$UNIT_PATH" <<'JS'
import fs from 'node:fs';
import { tailscaleIdentity } from './server/src/auth.js';
const identity = await tailscaleIdentity();
const file = process.argv[2];
let unit = fs.readFileSync(file, 'utf8');
const existing = /^Environment=TMUX_WEB_ALLOWED_USERS=(.+)$/m.exec(unit)?.[1];
const users = process.env.TMUX_WEB_ALLOWED_USERS || existing || identity.owner;
if (!users || !/^[A-Za-z0-9@._+,%-]+$/.test(users)) throw new Error('TMUX_WEB_ALLOWED_USERSにTailscaleのログイン名を指定してください');
unit = unit.replace(/^Environment=TMUX_WEB_TOKEN=.*\n/gm, '').replace(/^Environment=TMUX_WEB_ALLOWED_USERS=.*\n/gm, '');
unit = unit.replace(/^Environment=HOST=.*$/m, `Environment=HOST=127.0.0.1\nEnvironment=TMUX_WEB_ALLOWED_USERS=${users}`);
if (/^KillMode=/m.test(unit)) unit = unit.replace(/^KillMode=.*$/m, 'KillMode=process');
else unit = unit.replace(/^\[Service\]$/m, '[Service]\nKillMode=process');
fs.writeFileSync(file, unit, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log('固定トークンを削除し、Tailscale認証の許可ユーザーを設定しました');
JS
systemctl --user daemon-reload
systemctl --user restart tmux-web.service
./scripts/tailscale-serve.sh
