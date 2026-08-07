#!/usr/bin/env bash
# tmux-web の systemd --user サービスを停止して削除する。
# リポジトリやビルド成果物はそのまま残す。

set -euo pipefail

SERVICE_NAME="tmux-web.service"
UNIT_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$SERVICE_NAME"

say() { printf '\033[36m[uninstall]\033[0m %s\n' "$*"; }

systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true

if [ -f "$UNIT_PATH" ]; then
  rm -f "$UNIT_PATH"
  say "削除しました : $UNIT_PATH"
else
  say "ユニットは見つかりませんでした : $UNIT_PATH"
fi

systemctl --user daemon-reload
systemctl --user reset-failed "$SERVICE_NAME" 2>/dev/null || true
say "完了"
