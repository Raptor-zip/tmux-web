#!/usr/bin/env bash
# tmux-web を systemd --user のサービスとして登録し、ログイン時／起動時に自動起動させる。
#
#   ./scripts/install-service.sh              # インストールして起動
#   PORT=8080 ./scripts/install-service.sh    # ポートを変えて登録
#   TMUX_WEB_ALLOWED_USERS=you@example.com ./scripts/install-service.sh  # 許可ユーザーを指定
#
# アンインストールは ./scripts/uninstall-service.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="tmux-web.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/$SERVICE_NAME"

# 更新時も、明示しなかった待ち受け設定は引き継ぐ。
unit_env() { sed -n "s/^Environment=$1=//p" "$UNIT_PATH" | tail -1; }
if [ -f "$UNIT_PATH" ]; then
  PORT="${PORT-$(unit_env PORT)}"
  HOST="${HOST-$(unit_env HOST)}"
fi
PORT="${PORT:-7654}"
HOST="${HOST:-127.0.0.1}"

# 更新時は許可ユーザーを維持。未指定なら起動時にTailscaleのデバイス所有者を確認する。
if [ -f "$UNIT_PATH" ]; then
  TMUX_WEB_ALLOWED_USERS="${TMUX_WEB_ALLOWED_USERS-$(unit_env TMUX_WEB_ALLOWED_USERS)}"
fi
TMUX_WEB_ALLOWED_USERS="${TMUX_WEB_ALLOWED_USERS:-}"
case "$HOST" in 127.0.0.1|::1|localhost) ;; *) echo "Tailscale認証ではHOSTをループバックにしてください" >&2; exit 1 ;; esac

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
"$NODE_BIN" -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' \
  || die "Node.js 20 以上が必要です"

NPM_BIN="$(command -v npm || true)"
[ -n "$NPM_BIN" ] || die "npm が見つかりません"

say "リポジトリ : $REPO_DIR"
say "node       : $NODE_BIN ($("$NODE_BIN" -v))"
say "待ち受け   : http://$HOST:$PORT"

# --- 依存関係とフロントエンドのビルド ---------------------------------------
say "ロックファイルに従って依存関係をインストールします (npm ci)"
(cd "$REPO_DIR" && "$NPM_BIN" ci)

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

if [ -n "$TMUX_WEB_ALLOWED_USERS" ]; then
  TMUX_WEB_ALLOWED_USERS="$TMUX_WEB_ALLOWED_USERS" "$NODE_BIN" -e 'if (!/^[A-Za-z0-9@._+,%-]+$/.test(process.env.TMUX_WEB_ALLOWED_USERS)) process.exit(1)' || die "許可ユーザーはログイン名をカンマ区切りで指定してください"
  sed -i "/^Environment=HOST=/a Environment=TMUX_WEB_ALLOWED_USERS=$TMUX_WEB_ALLOWED_USERS" "$UNIT_PATH"
fi
chmod 600 "$UNIT_PATH"
say "Tailscale認証を有効にします（未指定ならデバイス所有者だけを許可）"

# --- ログアウト後も動かすための linger -------------------------------------
if [ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || echo no)" != "yes" ]; then
  say "linger を有効化します（ログアウト後・再起動後も起動させるため）"
  loginctl enable-linger "$USER" || die "linger の有効化に失敗しました（sudo loginctl enable-linger $USER を実行してから再実行してください）"
fi

# デスクトップ画面の配信に使う。未ログイン・ヘッドレス環境でも通常機能は起動する。
if [ -n "${DISPLAY:-}" ]; then
  systemctl --user import-environment DISPLAY
fi
if [ -n "${XAUTHORITY:-}" ]; then
  systemctl --user import-environment XAUTHORITY
fi

# linger で GUI より先に起動したサービスにも、ログイン後に画面情報を渡す。
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/tmux-web-desktop.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=tmux-web desktop environment
Exec=/bin/bash "$REPO_DIR/scripts/import-desktop-environment.sh"
NoDisplay=true
X-GNOME-Autostart-enabled=true
DESKTOP

# --- 有効化と起動 ------------------------------------------------------------
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

sleep 2
if systemctl --user is-active --quiet "$SERVICE_NAME"; then
  say "起動しました。アクセスにはTailscale ServeのHTTPS URLを使ってください"
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

  再起動をまたいでセッションを残すなら:
    $REPO_DIR/scripts/install-persistence.sh

  スマホなど tailnet 内の端末から使うなら:
    $REPO_DIR/scripts/tailscale-serve.sh

EOS
