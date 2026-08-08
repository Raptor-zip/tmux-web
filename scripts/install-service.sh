#!/usr/bin/env bash
# tmux-web を systemd --user のサービスとして登録し、ログイン時／起動時に自動起動させる。
#
#   ./scripts/install-service.sh              # インストールして起動
#   PORT=8080 ./scripts/install-service.sh    # ポートを変えて登録
#   TMUX_WEB_TOKEN=xxx ./scripts/install-service.sh  # トークン認証を有効にして登録
#
# アンインストールは ./scripts/uninstall-service.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="tmux-web.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/$SERVICE_NAME"

PORT="${PORT:-7654}"
HOST="${HOST:-127.0.0.1}"

# 再実行でトークンを取りこぼすと認証なしで公開されてしまうので、
# 明示的に渡されなければ既存ユニットの値を引き継ぐ。
# 意図的に外したいときは TMUX_WEB_TOKEN= （空）を明示する。
if [ -z "${TMUX_WEB_TOKEN+x}" ] && [ -f "$UNIT_PATH" ]; then
  TMUX_WEB_TOKEN="$(sed -n 's/^Environment=TMUX_WEB_TOKEN=//p' "$UNIT_PATH" | tail -1)"
  [ -n "$TMUX_WEB_TOKEN" ] && echo "既存のトークンを引き継ぎます" >/dev/null
fi
TMUX_WEB_TOKEN="${TMUX_WEB_TOKEN:-}"

say() { printf '\033[36m[install]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[install] %s\033[0m\n' "$*" >&2; exit 1; }

# --- 前提チェック ------------------------------------------------------------
command -v systemctl >/dev/null || die "systemctl が見つかりません（systemd が必要です）"
command -v tmux >/dev/null || die "tmux が見つかりません"
systemctl --user show-environment >/dev/null 2>&1 || die "systemd --user セッションが使えません"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || die "node が見つかりません"
NODE_BIN="$(readlink -f "$NODE_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"

NPM_BIN="$(command -v npm || true)"
[ -n "$NPM_BIN" ] || die "npm が見つかりません"

say "リポジトリ : $REPO_DIR"
say "node       : $NODE_BIN ($("$NODE_BIN" -v))"
say "待ち受け   : http://$HOST:$PORT"

# --- 依存関係とフロントエンドのビルド ---------------------------------------
if [ ! -d "$REPO_DIR/node_modules" ]; then
  say "依存関係をインストールします (npm install)"
  (cd "$REPO_DIR" && "$NPM_BIN" install)
fi

say "フロントエンドをビルドします (npm run build)"
(cd "$REPO_DIR" && "$NPM_BIN" run build)
[ -f "$REPO_DIR/web/dist/index.html" ] || die "web/dist のビルドに失敗しました"

# --- ユニットファイルの生成 --------------------------------------------------
mkdir -p "$UNIT_DIR"

say "ユニットを書き出します : $UNIT_PATH"
cat > "$UNIT_PATH" <<UNIT
[Unit]
Description=tmux-web - ブラウザから tmux を操作する Web アプリ
Documentation=file://$REPO_DIR/README.md
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN $REPO_DIR/server/src/index.js
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=$HOST
Environment=TERM=xterm-256color
Environment=PATH=$NODE_DIR:$HOME/.local/bin:$HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=always
RestartSec=3
# KillMode=process は変えないこと。tmux サーバが動いていないときに tmux-web が
# セッションを作ると、tmux サーバがこのユニットの cgroup の中で起動する。
# control-group や mixed にすると、再起動のたびにユーザーの tmux セッションが
# 巻き添えで全部消える。残った tmux client は起動時のミラー掃除で片付く。
KillMode=process
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tmux-web

[Install]
WantedBy=default.target
UNIT

if [ -n "$TMUX_WEB_TOKEN" ]; then
  say "トークン認証を有効にします"
  sed -i "/^Environment=HOST=/a Environment=TMUX_WEB_TOKEN=$TMUX_WEB_TOKEN" "$UNIT_PATH"
  chmod 600 "$UNIT_PATH"
else
  say "警告: トークン未設定。tailnet に公開するなら TMUX_WEB_TOKEN を設定すること"
fi

# --- ログアウト後も動かすための linger -------------------------------------
if [ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || echo no)" != "yes" ]; then
  say "linger を有効化します（ログアウト後・再起動後も起動させるため）"
  loginctl enable-linger "$USER" || say "linger の有効化に失敗しました（sudo loginctl enable-linger $USER を手動で実行してください）"
fi

# --- 有効化と起動 ------------------------------------------------------------
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

sleep 2
if systemctl --user is-active --quiet "$SERVICE_NAME"; then
  say "起動しました -> http://$HOST:$PORT"
else
  systemctl --user status "$SERVICE_NAME" --no-pager -l || true
  die "起動に失敗しました。上のログを確認してください"
fi

cat <<EOS

  状態      : systemctl --user status tmux-web
  ログ      : journalctl --user -u tmux-web -f
  停止      : systemctl --user stop tmux-web
  自動起動解除 : systemctl --user disable tmux-web
  アンインストール : $REPO_DIR/scripts/uninstall-service.sh

  スマホなど tailnet 内の端末から使うなら:
    $REPO_DIR/scripts/tailscale-serve.sh

EOS
