#!/usr/bin/env bash
# tmux-web を Tailscale 経由（HTTPS）で tailnet 内の端末に公開する。
#
#   ./scripts/tailscale-serve.sh        # 公開して URL を表示
#   ./scripts/tailscale-serve.sh url    # URL だけ表示
#   ./scripts/tailscale-serve.sh off    # 公開をやめる
#
# アプリ自体は 127.0.0.1 のまま。tailscaled が TLS 終端して tailnet 内にだけ流す。
# インターネットには出ない（それをしたいなら tailscale funnel だが、非推奨）。

set -euo pipefail

UNIT_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/tmux-web.service"
TS_PORT="${TS_PORT:-8443}"

say() { printf '\033[36m[tailscale]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[tailscale] %s\033[0m\n' "$*" >&2; exit 1; }

command -v tailscale >/dev/null || die "tailscale が見つかりません"

# --- インストール済みユニットからポートを読む ----------------------
unit_env() { [ -f "$UNIT_PATH" ] && sed -n "s/^Environment=$1=//p" "$UNIT_PATH" | tail -1; }

PORT="${PORT:-$(unit_env PORT)}"
PORT="${PORT:-7654}"

# --- off ---------------------------------------------------------------------
if [ "${1:-}" = "off" ]; then
  tailscale serve --https="$TS_PORT" off
  say "公開を停止しました"
  exit 0
fi

DNS_NAME="$(tailscale status --json | sed -n 's/.*"DNSName": "\([^"]*\)".*/\1/p' | head -1)"
DNS_NAME="${DNS_NAME%.}"
[ -n "$DNS_NAME" ] || die "tailnet の DNS 名が取れません。tailscale up は済んでいますか？"

URL="https://$DNS_NAME:$TS_PORT/"

# --- url だけ表示 -------------------------------------------------------------
if [ "${1:-}" = "url" ]; then
  printf '%s\n' "$URL"
  exit 0
fi

# --- 公開 ---------------------------------------------------------------------
systemctl --user is-active --quiet tmux-web.service \
  || say "警告: tmux-web サービスが起動していません（./scripts/install-service.sh を先に）"

say "https://$DNS_NAME:$TS_PORT -> http://127.0.0.1:$PORT"
tailscale serve --bg --https="$TS_PORT" "http://127.0.0.1:$PORT" >/dev/null


cat <<EOS

  Tailscaleに接続したPC・スマホからこのURLを開く:

    $URL

  iOS/Android ならホーム画面に追加しておくとアプリとして起動できる。
  停止 : ./scripts/tailscale-serve.sh off

EOS
